#!/usr/bin/env bun
/**
 * Import a WorkBuddy plugin team into the local experts dir.
 *
 * Usage:
 *   bun run scripts/import-workbuddy-team.mjs <workbuddy-plugin-dir>
 *   bun run scripts/import-workbuddy-team.mjs <workbuddy-plugin-dir> --copy
 *
 * By default, the WorkBuddy dir is symlinked under
 * `~/.claude/experts/<slug>/`, so future updates in WorkBuddy are
 * automatically visible. Pass `--copy` to instead recursively copy.
 *
 * The script:
 *  1. Validates that the input dir contains `.codebuddy-plugin/plugin.json`.
 *  2. Reads the team's name from the plugin.json.
 *  3. Symlinks (or copies) the dir to `~/.claude/experts/<slug>/`.
 *  4. Reports the lead, members, avatar presence, and README presence.
 */
import {existsSync, lstatSync, readlinkSync, symlinkSync} from 'node:fs'
import {mkdir, readFile, stat} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join, basename, resolve} from 'node:path'

const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')))
const COPY_MODE = flags.has('--copy')

if (args.length < 1) {
	console.error('Usage: bun run scripts/import-workbuddy-team.mjs <workbuddy-plugin-dir> [--copy]')
	process.exit(1)
}

const SRC = resolve(args[0])
const EXPERTS_ROOT = join(homedir(), '.claude', 'experts')

if (!existsSync(SRC)) {
	console.error(`Source dir not found: ${SRC}`)
	process.exit(1)
}
const pluginJsonPath = join(SRC, '.codebuddy-plugin', 'plugin.json')
if (!existsSync(pluginJsonPath)) {
	console.error(`No .codebuddy-plugin/plugin.json in ${SRC}`)
	console.error('Is this a WorkBuddy plugin?')
	process.exit(1)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const raw = await readFile(pluginJsonPath, 'utf-8')
	const meta = JSON.parse(raw)
	const slug = meta.name
	if (!slug) {
		console.error('plugin.json has no `name` field')
		process.exit(1)
	}

	const target = join(EXPERTS_ROOT, slug)

	if (existsSync(target)) {
		const isLink = lstatSync(target).isSymbolicLink()
		if (isLink) {
			const link = readlinkSync(target)
			if (link === SRC) {
				console.log(`Already linked: ${target} → ${SRC}`)
			} else {
				console.error(`Target already exists as a different symlink: ${target} → ${link}`)
				process.exit(1)
			}
		} else {
			console.error(`Target already exists (not a symlink): ${target}`)
			console.error('Remove it first or pick a different name.')
			process.exit(1)
		}
	} else {
		await mkdir(EXPERTS_ROOT, {recursive: true})
		if (COPY_MODE) {
			// Recursive copy using Bun's native API
			const {spawnSync} = await import('node:child_process')
			const result = spawnSync('cp', ['-R', SRC, target], {stdio: 'inherit'})
			if (result.status !== 0) {
				console.error('Copy failed')
				process.exit(1)
			}
			console.log(`Copied: ${SRC} → ${target}`)
		} else {
			symlinkSync(SRC, target)
			console.log(`Linked: ${target} → ${SRC}`)
		}
	}

	// Report team structure
	const leadId = meta.teamInfo?.leadAgent ?? `${slug}-team-lead`
	const memberIds = meta.teamInfo?.memberAgents ?? []
	const hasLeadMd = existsSync(join(SRC, 'agents', `${leadId}.md`))
	const hasAvatar = meta.avatar
		? existsSync(join(SRC, meta.avatar))
		: false
	const hasReadme = existsSync(join(SRC, 'README.md'))
	const allAgentsDir = join(SRC, 'agents')
	let agentsCount = 0
	try {
		const s = await stat(allAgentsDir)
		if (s.isDirectory()) {
			const {readdir} = await import('node:fs/promises')
			const entries = await readdir(allAgentsDir)
			agentsCount = entries.filter(f => f.endsWith('.md')).length
		}
	} catch {
		/* no agents dir */
	}

	console.log()
	console.log(`Imported: ${slug}`)
	console.log(`  displayName: ${formatI18n(meta.displayName)}`)
	console.log(`  profession:  ${formatI18n(meta.profession)}`)
	console.log(`  expertType:  ${meta.expertType}`)
	console.log(`  version:     ${meta.version ?? '(unset)'}`)
	console.log(`  author:      ${meta.author?.name ?? '(unset)'}${meta.author?.email ? ` <${meta.author.email}>` : ''}`)
	console.log(`  lead:        ${leadId}${hasLeadMd ? ' ✓' : ' (no .md)'}`)
	console.log(`  members:     ${memberIds.length > 0 ? memberIds.join(', ') : '(none declared)'}`)
	console.log(`  agents/:     ${agentsCount} .md file(s)`)
	console.log(`  avatar:      ${hasAvatar ? meta.avatar : '(none)'}`)
	console.log(`  README:      ${hasReadme ? 'yes' : 'no'}`)
	console.log()
	console.log(`Try it:  /expert ${slug}`)
	console.log(`Or view: bun run dev  →  ExpertManager: view "${slug}"`)
}

function formatI18n(d) {
	if (typeof d === 'string') return d
	if (!d) return '(unset)'
	const zh = d.zh
	const en = d.en
	if (zh && en) return `${zh} / ${en}`
	return zh ?? en ?? '(unset)'
}

main().catch(err => {
	console.error('Import failed:', err)
	process.exit(1)
})
