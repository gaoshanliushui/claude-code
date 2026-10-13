#!/usr/bin/env bun
/**
 * Merge top-level expert dirs that are members/leads of a team INTO the team
 * directory, matching WorkBuddy's on-disk layout where each team plugin holds
 * its members as .md files under agents/.
 *
 * Before:
 *   ~/.claude/experts/
 *   ├── software-dev-team/
 *   │   ├── .codebuddy-plugin/plugin.json   (teamInfo.memberAgents=[backend-engineer,...])
 *   │   └── agents/
 *   │       ├── software-dev-team-team-lead.md   (stub)
 *   │       ├── backend-engineer.md              (stub)
 *   │       └── ...
 *   ├── backend-engineer/                  (full agent dir)
 *   │   ├── plugin.json
 *   │   └── agents/backend-engineer.md
 *   ├── frontend-engineer/                 (full agent dir)
 *   └── ...
 *
 * After:
 *   ~/.claude/experts/
 *   ├── software-dev-team/
 *   │   ├── .codebuddy-plugin/plugin.json
 *   │   └── agents/
 *   │       ├── software-dev-team-team-lead.md   (full content, copied)
 *   │       ├── backend-engineer.md              (full content, copied)
 *   │       ├── frontend-engineer.md
 *   │       └── ...
 *   # No more top-level backend-engineer/, frontend-engineer/, etc.
 *
 * Special handling:
 *  - Lead case: if a team's leadAgent slug (e.g. "software-architect") differs
 *    from the team-lead.md filename (e.g. "software-dev-team-team-lead"), the
 *    full lead .md content is copied into the team-lead.md file. The lead's
 *    top-level dir is also removed.
 *  - Standalone agents (not referenced by any team) are left alone.
 *  - Members whose team dir already has a non-stub .md (e.g. WorkBuddy teams)
 *    are skipped — we never overwrite real content with stubs.
 *
 * Run:
 *   bun run scripts/merge-team-members.mjs          # apply
 *   bun run scripts/merge-team-members.mjs --dry-run # preview
 *   bun run scripts/merge-team-members.mjs --force  # overwrite non-stub team .md
 */
import {existsSync} from 'node:fs'
import {readFile, rm, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join, basename} from 'node:path'

const ROOT = join(homedir(), '.claude', 'experts')
const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const VERBOSE = process.argv.includes('--verbose') || DRY_RUN

// Detect stub .md (looks for "Member prompt not yet authored" or empty body)
function isStubMd(content) {
	const fmEnd = content.indexOf('\n---\n', 4)
	const body = fmEnd > 0 ? content.slice(fmEnd + 5).trim() : content.trim()
	if (!body) return true
	if (body.length < 80) return true
	if (/Member prompt not yet authored/i.test(body)) return true
	return false
}

// Read .md content, preserving YAML frontmatter verbatim. Returns
// { frontmatter, body } strings (we treat frontmatter as opaque).
function splitMd(content) {
	const m = content.match(/^---\n([\s\S]*?)\n---\n?/)
	if (!m) return {frontmatter: '', body: content}
	return {frontmatter: m[1], body: content.slice(m[0].length)}
}

// Find the canonical .md inside a top-level expert dir. Legacy format is
// <slug>.md in agents/, but the file might be at the root too. We try
// <expertDir>/agents/<slug>.md first, then <expertDir>/<slug>.md.
async function findSourceMd(expertDir, slug) {
	const candidates = [
		join(expertDir, 'agents', `${slug}.md`),
		join(expertDir, `${slug}.md`),
		// Lead case: team's leadAgent is a separate expert. Try by original name.
		join(expertDir, 'agents', basename(expertDir) + '.md'),
	]
	for (const p of candidates) {
		if (existsSync(p)) return p
	}
	// Last resort: any single .md in agents/
	try {
		const {readdir} = await import('node:fs/promises')
		const files = await readdir(join(expertDir, 'agents'))
			.then(arr => arr.filter(f => f.endsWith('.md')))
		if (files.length === 1 && files[0]) {
			return join(expertDir, 'agents', files[0])
		}
	} catch {
		/* ignore */
	}
	return null
}

// Merge one team's members into its agents/ dir
async function mergeTeam(teamSlug) {
	const teamDir = join(ROOT, teamSlug)
	if (!existsSync(teamDir)) {
		return {team: teamSlug, status: 'skipped', reason: 'no team dir'}
	}
	const pluginJsonPath = join(teamDir, '.codebuddy-plugin', 'plugin.json')
	if (!existsSync(pluginJsonPath)) {
		return {team: teamSlug, status: 'skipped', reason: 'no .codebuddy-plugin/plugin.json'}
	}
	let meta
	try {
		meta = JSON.parse(await readFile(pluginJsonPath, 'utf-8'))
	} catch (err) {
		return {team: teamSlug, status: 'error', reason: 'parse plugin.json: ' + err.message}
	}

	const leadId = meta.teamInfo?.leadAgent
	const memberIds = meta.teamInfo?.memberAgents ?? []
	// For the lead case, the lead's separate-expert dir may use the lead's
	// "agentName" rather than the team-lead id. We check both.
	const leadMemberEntry = (meta.members ?? []).find(
		m => m.id === leadId || m.agentName === leadId,
	)
	const leadOriginalSlug = leadMemberEntry?.agentName ?? leadId
	// Treat the lead's original slug as a separate merge target when it
	// differs from the team-lead id. The team-lead.md keeps the 5-Phase SOP;
	// the lead's individual prompt goes to its own file inside the team.
	const allMemberSlugs = [...memberIds.filter(Boolean)]
	const leadTargets = []
	if (leadId) {
		// Always also write the team-lead.md if a separate-expert lead exists
		// whose slug matches leadId.
		leadTargets.push({dest: leadId, srcSlugs: [leadId]})
		if (leadOriginalSlug && leadOriginalSlug !== leadId) {
			// Additional file: lead's individual prompt under its own slug
			leadTargets.push({dest: leadOriginalSlug, srcSlugs: [leadOriginalSlug, leadId]})
		}
	}

	const actions = []
	// Process lead targets first
	for (const {dest, srcSlugs} of leadTargets) {
		await mergeOne(teamDir, teamSlug, dest, srcSlugs, actions)
	}
	// Then member targets
	for (const memberSlug of allMemberSlugs) {
		await mergeOne(teamDir, teamSlug, memberSlug, [memberSlug], actions)
	}

	return {team: teamSlug, status: 'processed', actions}
}

async function mergeOne(teamDir, teamSlug, destSlug, srcSlugCandidates, actions) {
	let sourceExpertDir = null
	let sourceSlug = null
	for (const slug of srcSlugCandidates) {
		const dir = join(ROOT, slug)
		if (existsSync(dir) && slug !== teamSlug) {
			sourceExpertDir = dir
			sourceSlug = slug
			break
		}
	}
	if (!sourceExpertDir) {
		actions.push({member: destSlug, status: 'no-source'})
		return
	}
	const srcMd = await findSourceMd(sourceExpertDir, sourceSlug)
	if (!srcMd) {
		actions.push({member: destSlug, status: 'no-md', source: sourceSlug})
		return
	}
	const srcContent = await readFile(srcMd, 'utf-8')
	const destMd = join(teamDir, 'agents', `${destSlug}.md`)
	let shouldWrite = true
	if (existsSync(destMd)) {
		const destContent = await readFile(destMd, 'utf-8')
		if (!isStubMd(destContent) && !FORCE) {
			actions.push({
				member: destSlug,
				status: 'kept-existing',
				note: 'destination has real content, not a stub (use --force to overwrite)',
			})
			shouldWrite = false
		}
	}
	if (shouldWrite) {
		const {body} = splitMd(srcContent)
		const outFm = `name: ${destSlug}\nagentName: ${destSlug}`
		const out = `---\n${outFm}\n---\n\n${body.trim()}\n`
		if (VERBOSE) {
			console.log(
				`  [copy] ${sourceSlug}/agents/${basename(srcMd)} → ${teamSlug}/agents/${destSlug}.md (${body.length} bytes)`,
			)
		}
		if (!DRY_RUN) {
			await writeFile(destMd, out, 'utf-8')
		}
		actions.push({member: destSlug, status: 'copied', source: sourceSlug, destBytes: body.length})
	}
	actions[actions.length - 1].removeSource = sourceExpertDir
}

async function main() {
	if (!existsSync(ROOT)) {
		console.error(`No experts root at ${ROOT}`)
		process.exit(1)
	}
	const {readdir} = await import('node:fs/promises')
	const entries = await readdir(ROOT, {withFileTypes: true})
	const allDirs = entries
		.filter(e => e.isDirectory() || e.isSymbolicLink())
		.map(e => join(ROOT, e.name))

	console.log(`${DRY_RUN ? '[DRY-RUN] ' : ''}Merging team members into team dirs in ${ROOT}`)
	console.log()

	const results = []
	for (const dir of allDirs) {
		const slug = basename(dir)
		const pluginJsonPath = join(dir, '.codebuddy-plugin', 'plugin.json')
		if (!existsSync(pluginJsonPath)) continue
		let meta
		try {
			meta = JSON.parse(await readFile(pluginJsonPath, 'utf-8'))
		} catch {
			continue
		}
		if (meta.expertType !== 'team') continue
		results.push(await mergeTeam(slug))
	}

	// Collect all source dirs to remove (deduplicated)
	const toRemove = new Set()
	for (const r of results) {
		for (const a of r.actions ?? []) {
			if (a.status === 'copied' && a.removeSource) {
				toRemove.add(a.removeSource)
			}
		}
	}

	// Print per-team summary
	for (const r of results) {
		console.log(`Team: ${r.team}`)
		for (const a of r.actions ?? []) {
			console.log(`  ${a.status.padEnd(15)} ${a.member}${a.source ? ` (← ${a.source})` : ''}${a.note ? ` — ${a.note}` : ''}`)
		}
		console.log()
	}

	if (toRemove.size > 0) {
		console.log(`Top-level expert dirs to remove (${toRemove.size}):`)
		for (const dir of toRemove) {
			console.log(`  ${basename(dir)}`)
		}
		if (!DRY_RUN) {
			for (const dir of toRemove) {
				await rm(dir, {recursive: true, force: true})
				console.log(`  removed: ${basename(dir)}`)
			}
		}
	}

	console.log()
	console.log(DRY_RUN ? '[DRY-RUN] ' : '' + 'Done.')
}

main().catch(err => {
	console.error('Merge failed:', err)
	process.exit(1)
})
