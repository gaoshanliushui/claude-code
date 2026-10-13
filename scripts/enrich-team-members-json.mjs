#!/usr/bin/env bun
/**
 * Enrich the `members` field of each team's plugin.json with
 * displayName/profession/role from the corresponding agents/<id>.md
 * frontmatter. Matches the WorkBuddy plugin.json shape:
 *
 *   "members": [
 *     {
 *       "id": "...",
 *       "displayName": {"en":"...","zh":"..."},
 *       "profession": {"en":"...","zh":"..."},
 *       "role": "lead" | "member"
 *     }
 *   ]
 *
 * Run:
 *   bun run scripts/enrich-team-members-json.mjs            # apply
 *   bun run scripts/enrich-team-members-json.mjs --dry-run  # preview
 */
import {existsSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join, basename} from 'node:path'

const ROOT = join(homedir(), '.claude', 'experts')
const DRY_RUN = process.argv.includes('--dry-run')
const VERBOSE = process.argv.includes('--verbose') || DRY_RUN

// Lightweight YAML frontmatter parser — only handles the simple `key: value`
// and `key:\n  subkey: value` shape used by the generator.
function parseFrontmatter(text) {
	const m = text.match(/^---\n([\s\S]*?)\n---/)
	if (!m) return {}
	const out = {}
	const lines = m[1].split('\n')
	let i = 0
	while (i < lines.length) {
		const line = lines[i]
		const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
		if (!kv) {
			i++
			continue
		}
		const [, key, rawValue] = kv
		if (rawValue === '') {
			// Nested object (displayName: \n  en: ... \n  zh: ...)
			const obj = {}
			i++
			while (i < lines.length) {
				const sub = lines[i].match(/^\s+([a-zA-Z_-]+):\s*(.*)$/)
				if (!sub) break
				obj[sub[1]] = sub[2].replace(/^["']|["']$/g, '')
				i++
			}
			out[key] = obj
		} else {
			out[key] = rawValue.replace(/^["']|["']$/g, '')
			i++
		}
	}
	return out
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

	let touched = 0
	for (const teamDir of allDirs) {
		const pluginPath = join(teamDir, '.codebuddy-plugin', 'plugin.json')
		if (!existsSync(pluginPath)) continue
		const meta = JSON.parse(await readFile(pluginPath, 'utf-8'))
		if (meta.expertType !== 'team') continue
		const agentsDir = join(teamDir, 'agents')
		if (!existsSync(agentsDir)) continue
		const teamName = basename(teamDir)
		if (!Array.isArray(meta.members) || meta.members.length === 0) {
			console.log(`  skip ${teamName}: no members array`)
			continue
		}
		// Determine role from teamInfo.leadAgent if member.role is missing
		const leadId = meta.teamInfo?.leadAgent
		const newMembers = []
		for (const m of meta.members) {
			const id = m.id ?? m.agentName
			if (!id) {
				newMembers.push(m)
				continue
			}
			const mdPath = join(agentsDir, `${id}.md`)
			let fm = {}
			if (existsSync(mdPath)) {
				fm = parseFrontmatter(await readFile(mdPath, 'utf-8'))
			}
			const role = m.role ?? (id === leadId ? 'lead' : 'member')
			const enriched = {
				id,
				...(fm.displayName ? {displayName: fm.displayName} : {}),
				...(fm.profession ? {profession: fm.profession} : {}),
				role,
			}
			// Preserve any extra fields already in m (like avatar)
			for (const k of Object.keys(m)) {
				if (!(k in enriched) && k !== 'agentName') {
					enriched[k] = m[k]
				}
			}
			newMembers.push(enriched)
		}
		const before = JSON.stringify(meta.members)
		const after = JSON.stringify(newMembers)
		if (before === after) {
			if (VERBOSE) console.log(`  unchanged: ${teamName}`)
			continue
		}
		meta.members = newMembers
		if (VERBOSE) {
			console.log(`  [enrich] ${teamName}: ${newMembers.length} members`)
			for (const m of newMembers) {
				const dn = m.displayName
				const name = dn ? (dn.zh || dn.en || '?') : '?'
				console.log(`    - ${m.id} (${m.role}) 花名=${name}`)
			}
		}
		if (!DRY_RUN) {
			await writeFile(pluginPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
		}
		touched++
	}
	console.log()
	console.log(
		`${DRY_RUN ? '[DRY-RUN] ' : ''}Done. ${touched} team(s) ${DRY_RUN ? 'would be ' : ''}enriched.`,
	)
}

main().catch(err => {
	console.error('Enrich failed:', err)
	process.exit(1)
})
