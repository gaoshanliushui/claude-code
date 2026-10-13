#!/usr/bin/env bun
/**
 * Migrate the 7 existing legacy-format experts to the new WorkBuddy-compatible
 * format.
 *
 * Legacy format:
 *   <expertDir>/
 *   ├── plugin.json        # flat tags/quickPrompts/defaultInitPrompt strings
 *   └── agents/<slug>.md   # only one .md, even for team experts
 *
 * WorkBuddy format (target):
 *   <expertDir>/
 *   ├── .codebuddy-plugin/plugin.json    # i18n tags/quickPrompts, version, author, ...
 *   ├── agents/<team-name>-team-lead.md   # lead's prompt body
 *   ├── agents/<member1>.md               # one per non-lead member
 *   └── README.md                         # not auto-generated; left absent
 *
 * The migration:
 *  - Converts flat strings to {en, zh} objects (en = original).
 *  - Adds version: "1.0.0", author: {name: "Claude Code"}, displayDescription.
 *  - For team experts, extracts each member's prompt body from the current
 *    team .md file. We don't have separate member bodies in legacy format,
 *    so we synthesize stub bodies like "Member '<id>' of team '<team>'." and
 *    rely on the team's overall prompt to guide the lead. (For full
 *    WorkBuddy compliance, users would hand-author per-member .md files
 *    separately — this script just unblocks the structural migration.)
 *  - Writes .codebuddy-plugin/plugin.json. The legacy root plugin.json is
 *    left in place as a fallback reader; future reads prefer the new path.
 *
 * Run:
 *   bun run scripts/migrate-experts-to-workbuddy.mjs          # apply
 *   bun run scripts/migrate-experts-to-workbuddy.mjs --dry-run # preview
 */
import {existsSync} from 'node:fs'
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

const ROOT = join(homedir(), '.claude', 'experts')
const DRY_RUN = process.argv.includes('--dry-run')
const VERBOSE = process.argv.includes('--verbose') || DRY_RUN

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a flat string to an i18n object: en = original, zh = original. */
function toI18n(s) {
	if (s === undefined || s === null) return s
	if (typeof s === 'object') return s // already i18n
	return {en: s, zh: s}
}

/** Convert an array of strings to an array of {en, zh} objects. */
function toI18nArray(arr) {
	if (!Array.isArray(arr)) return arr
	return arr.map(toI18n)
}

/** Add WorkBuddy fields to a meta object. */
function withWorkBuddyFields(meta, expertType) {
	const out = {...meta}
	out.version = out.version ?? '1.0.0'
	out.author = out.author ?? {name: 'Claude Code'}
	out.displayDescription = out.displayDescription ?? toI18n(out.description)
	out.plugin = out.plugin ?? out.name
	if (expertType === 'team' && !out.teamInfo && Array.isArray(out.members)) {
		// Build teamInfo from the legacy members list
		const leadMember = out.members.find(m => m.role === 'lead' || m.role === 'leader')
		const leadId = leadMember
			? (leadMember.id ?? leadMember.agentName)
			: `${out.name}-team-lead`
		const memberIds = out.members
			.filter(m => m !== leadMember)
			.map(m => m.id ?? m.agentName)
			.filter(Boolean)
		out.teamInfo = {
			leadAgent: leadId,
			memberAgents: memberIds,
		}
	}
	// Normalize role: 'leader' → 'lead' (WorkBuddy convention)
	// Also ensure `id` is set (WorkBuddy canonical), falling back to
	// `agentName` (legacy). Without `id`, the runtime can't register the
	// member as `expert:<team>:<member>`.
	if (Array.isArray(out.members)) {
		out.members = out.members.map(m => ({
			...m,
			id: m.id ?? m.agentName,
			role: m.role === 'leader' ? 'lead' : m.role ?? 'member',
		}))
	}
	// i18n-ify the list fields
	out.tags = toI18nArray(out.tags)
	out.quickPrompts = toI18nArray(out.quickPrompts)
	out.defaultInitPrompt = toI18n(toI18nArray([out.defaultInitPrompt])[0])
	out.displayName = toI18n(out.displayName)
	out.profession = toI18n(out.profession)
	return out
}

/** Read and parse a JSON file. */
async function readJson(path) {
	const raw = await readFile(path, 'utf-8')
	return JSON.parse(raw)
}

/** Read a .md file and return frontmatter + body. Minimal YAML parser. */
async function readMd(path) {
	const raw = await readFile(path, 'utf-8')
	const match = raw.match(/^---\s*\n([\s\S]*?)---\s*\n?/)
	if (!match) return {frontmatter: {}, body: raw}
	const frontmatter = {}
	const lines = match[1].split('\n')
	for (const line of lines) {
		const m = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
		if (!m) continue
		const [, key, value] = m
		if (!key || !value) continue
		frontmatter[key] = value.replace(/^["']|["']$/g, '')
	}
	return {frontmatter, body: raw.slice(match[0].length)}
}

/** Write a .md file with frontmatter + body. */
function writeMd({frontmatter, body, id}) {
	const lines = ['---', `name: ${id}`, `agentName: ${id}`]
	for (const [k, v] of Object.entries(frontmatter)) {
		if (k === 'name' || k === 'agentName') continue
		if (v === undefined || v === null) continue
		const s = String(v)
		const needsQuotes = /[:#{}\[\]\&*!|>%@`]/.test(s) || s === ''
		lines.push(needsQuotes ? `${k}: "${s.replace(/"/g, '\\"')}"` : `${k}: ${s}`)
	}
	lines.push('---', '', body.trim(), '')
	return lines.join('\n')
}

/** Migrate a single agent-type expert. */
async function migrateAgent(slug, expertDir) {
	const pluginPath = join(expertDir, 'plugin.json')
	if (!existsSync(pluginPath)) {
		return {slug, status: 'skipped', reason: 'no plugin.json'}
	}
	const meta = await readJson(pluginPath)
	const mdPath = join(expertDir, 'agents', `${slug}.md`)
	if (!existsSync(mdPath)) {
		return {slug, status: 'skipped', reason: 'no agents/<slug>.md'}
	}
	const md = await readMd(mdPath)

	const newMeta = withWorkBuddyFields({...meta, expertType: 'agent'}, 'agent')

	// Write the new layout
	const newPluginPath = join(expertDir, '.codebuddy-plugin', 'plugin.json')
	const newMdPath = join(expertDir, 'agents', `${slug}.md`) // same path; .md has name=slug anyway

	if (VERBOSE) {
		console.log(`  [agent] ${slug}`)
		console.log(`    meta:`, JSON.stringify(newMeta, null, 2).split('\n').slice(0, 8).join('\n'))
	}

	if (!DRY_RUN) {
		await mkdir(join(expertDir, '.codebuddy-plugin'), {recursive: true})
		await writeFile(newPluginPath, JSON.stringify(newMeta, null, 2) + '\n', 'utf-8')
		// Re-write the .md with the new frontmatter (preserves body)
		const mergedFm = {...md.frontmatter, name: slug, agentName: slug}
		await writeFile(newMdPath, writeMd({frontmatter: mergedFm, body: md.body, id: slug}), 'utf-8')
	}
	return {slug, status: 'migrated', type: 'agent'}
}

/** Migrate a team expert. */
async function migrateTeam(slug, expertDir) {
	const pluginPath = join(expertDir, 'plugin.json')
	if (!existsSync(pluginPath)) {
		return {slug, status: 'skipped', reason: 'no plugin.json'}
	}
	const meta = await readJson(pluginPath)
	const mdPath = join(expertDir, 'agents', `${slug}.md`)
	if (!existsSync(mdPath)) {
		return {slug, status: 'skipped', reason: 'no agents/<slug>.md'}
	}
	const md = await readMd(mdPath)

	const newMeta = withWorkBuddyFields({...meta, expertType: 'team'}, 'team')

	// Build lead + member .md paths
	const leadId = newMeta.teamInfo?.leadAgent ?? `${slug}-team-lead`
	const memberIds = (newMeta.teamInfo?.memberAgents ?? []).filter(Boolean)

	// Check if the lead is also a separate agent-type expert (e.g.,
	// toutiao-ops-team's lead is toutiao-ops-director, which is its own
	// expert under a sibling dir). If so, we don't write a new lead .md
	// here — the separate expert's .md serves the lead. We still update
	// teamInfo.leadAgent to reference it.
	const usersExpertsRoot = join(homedir(), '.claude', 'experts')
	const leadIsSeparateExpert = leadId !== slug && existsSync(join(usersExpertsRoot, leadId, 'plugin.json'))

	// Synthesize lead body from the legacy team .md (the legacy file IS the
	// team's prompt in this format). If the lead is a separate expert, we
	// DON'T overwrite the separate expert's .md; the team's body stays in
	// <slug>.md or is moved to <team-name>-team-lead.md.
	const teamNameLeadId = `${slug}-team-lead`
	const teamNameLeadPath = join(expertDir, 'agents', `${teamNameLeadId}.md`)
	const teamBody = md.body
	const memberStub = (memberId) =>
		`# ${memberId}\n\nMember "${memberId}" of team "${slug}".\n\n` +
		`(Stub body — original legacy format had no per-member prompt. Edit ` +
		`this file to give the member its own expertise and workflow.)`

	if (VERBOSE) {
		console.log(`  [team] ${slug}`)
		console.log(`    teamInfo.leadAgent: ${leadId} ${leadIsSeparateExpert ? '(separate expert)' : '(internal)'}`)
		console.log(`    members: ${memberIds.join(', ')}`)
	}

	if (!DRY_RUN) {
		await mkdir(join(expertDir, '.codebuddy-plugin'), {recursive: true})

		// Lead .md
		// - If lead is a separate expert: leave the separate expert's .md
		//   alone. We do write `<team-name>-team-lead.md` with the team's
		//   body for the parser to pick up. This is what teamInContext will
		//   use as the lead's prompt.
		// - If lead is internal: write to `<team-name>-team-lead.md`.
		if (!leadIsSeparateExpert) {
			await writeFile(
				join(expertDir, 'agents', `${leadId}.md`),
				writeMd({frontmatter: {name: leadId, agentName: leadId}, body: teamBody, id: leadId}),
				'utf-8',
			)
		} else {
			// Write team's body to <team-name>-team-lead.md (the team-level prompt)
			await writeFile(
				teamNameLeadPath,
				writeMd({frontmatter: {name: teamNameLeadId, agentName: teamNameLeadId}, body: teamBody, id: teamNameLeadId}),
				'utf-8',
			)
		}

		// Member .md (stub)
		for (const memberId of memberIds) {
			const memberMdPath = join(expertDir, 'agents', `${memberId}.md`)
			// If a separate expert already has its own .md, leave it alone.
			const memberIsSeparateExpert = memberId !== slug && existsSync(join(usersExpertsRoot, memberId, 'plugin.json'))
			if (memberIsSeparateExpert) continue
			await writeFile(
				memberMdPath,
				writeMd({frontmatter: {name: memberId, agentName: memberId}, body: memberStub(memberId), id: memberId}),
				'utf-8',
			)
		}
		// Delete the legacy team .md if it has a different name than the lead
		if (slug !== leadId && slug !== teamNameLeadId) {
			try {
				const fs = await import('node:fs/promises')
				await fs.unlink(mdPath)
			} catch {
				/* ignore */
			}
		}
		// Write the new plugin.json
		await writeFile(
			join(expertDir, '.codebuddy-plugin', 'plugin.json'),
			JSON.stringify(newMeta, null, 2) + '\n',
			'utf-8',
		)
	}
	return {slug, status: 'migrated', type: 'team', memberCount: memberIds.length}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	if (!existsSync(ROOT)) {
		console.error(`No experts root at ${ROOT}`)
		process.exit(1)
	}
	const entries = await readdir(ROOT, {withFileTypes: true})
	const expertDirs = entries
		.filter(e => e.isDirectory())
		.map(e => join(ROOT, e.name))

	console.log(`${DRY_RUN ? '[DRY-RUN] ' : ''}Migrating experts in ${ROOT}`)
	console.log()

	const results = []
	for (const expertDir of expertDirs) {
		const slug = expertDir.split('/').pop()
		try {
			// Quick peek at plugin.json to determine type
			const pluginPath = join(expertDir, 'plugin.json')
			if (!existsSync(pluginPath)) {
				results.push({slug, status: 'skipped', reason: 'no plugin.json'})
				continue
			}
			const meta = await readJson(pluginPath)
			if (meta.expertType === 'team') {
				results.push(await migrateTeam(slug, expertDir))
			} else {
				results.push(await migrateAgent(slug, expertDir))
			}
		} catch (err) {
			results.push({
				slug,
				status: 'error',
				reason: err instanceof Error ? err.message : String(err),
			})
		}
	}

	console.log()
	console.log('Results:')
	for (const r of results) {
		const extra = r.memberCount !== undefined ? ` (${r.memberCount} members)` : ''
		console.log(`  ${r.status.padEnd(10)} ${r.slug}${extra}${r.reason ? ` — ${r.reason}` : ''}`)
	}

	const errors = results.filter(r => r.status === 'error')
	if (errors.length > 0) {
		process.exit(1)
	}
}

main().catch(err => {
	console.error('Migration failed:', err)
	process.exit(1)
})
