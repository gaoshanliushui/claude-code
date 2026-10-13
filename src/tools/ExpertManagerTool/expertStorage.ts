/**
 * Storage layer for experts.
 *
 * Three roots, searched in priority order: managed → user → project. The
 * project root is itself multiple directories (one per .claude/ found
 * walking from cwd up to git root), matching
 * `markdownConfigLoader.getProjectDirsUpToHome`. Within a single expert
 * lookup, project shadows user shadows managed (later wins on conflict).
 *
 * Reads are memoized per (slug, scope) pair; writes invalidate the cache.
 */
import {existsSync, statSync} from 'fs'
import {mkdir, rm, writeFile} from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import {homedir} from 'os'
import {dirname, join, resolve, sep} from 'path'
import {clearAgentDefinitionsCache} from '../AgentTool/loadAgentsDir.js'
import {getClaudeConfigHomeDir} from '../../utils/envUtils.js'
import {getManagedFilePath} from '../../utils/settings/managedPath.js'
import {getCwd} from '../../utils/cwd.js'
import {logForDebugging} from '../../utils/debug.js'
import {findGitRoot} from '../../utils/git.js'
import {normalizePathForComparison} from '../../utils/file.js'
import {
	EXPERT_AGENT_FILENAME,
	EXPERT_PLUGIN_FILENAME,
	EXPERT_PROMPT_FILENAME_SUFFIX,
	EXPERTS_SUBDIR,
	EXPERT_SCOPES,
	type ExpertScope,
} from './constants.js'
import type {Expert} from './types.js'
import {parseExpertDir} from './src/parseExpert.js'

export type ExpertRoot = 'managed' | 'user' | 'project'

/** Path to the experts dir for a given root. */
export function getExpertRootDir(root: ExpertRoot): string {
	switch (root) {
		case 'managed':
			return join(getManagedFilePath(), '.claude', EXPERTS_SUBDIR)
		case 'user':
			return join(getClaudeConfigHomeDir(), EXPERTS_SUBDIR)
		case 'project':
			return EXPERTS_SUBDIR // base name; project is multi-dir
	}
}

/** All project-level experts dirs (from cwd up to git root). Cached because
 *  the projectDirs walk is moderately expensive and is called per read.
 *
 *  Mirrors the logic in `markdownConfigLoader.getProjectDirsUpToHome` but
 *  is independent (the loader's `ClaudeConfigDirectory` union doesn't
 *  include `experts`). */
const projectDirsCache = new Map<string, string[]>()

function getProjectExpertDirs(cwd: string): string[] {
	const cached = projectDirsCache.get(cwd)
	if (cached) return cached
	const home = resolve(homedir()).normalize('NFC')
	const gitRoot = findGitRoot(cwd)
	let current = resolve(cwd)
	const dirs: string[] = []

	while (true) {
		if (normalizePathForComparison(current) === normalizePathForComparison(home)) {
			break
		}
		const claudeSubdir = join(current, '.claude', EXPERTS_SUBDIR)
		try {
			statSync(claudeSubdir)
			dirs.push(claudeSubdir)
		} catch {
			// ENOENT or inaccessible — skip
		}
		if (
			gitRoot &&
			normalizePathForComparison(current) === normalizePathForComparison(gitRoot)
		) {
			break
		}
		const parent = dirname(current)
		if (parent === current) break
		current = parent
	}

	projectDirsCache.set(cwd, dirs)
	return dirs
}

/** Invalidate the project dirs cache (e.g., after a project-level write). */
export function clearProjectDirsCache(): void {
	projectDirsCache.clear()
}

/** Resolve which experts dir to use for a write operation. The model picks
 *  scope=user (default) or scope=project; we return the canonical base
 *  directory and let the caller decide whether to disambiguate further. */
export function resolveWriteRoot(scope: 'user' | 'project' | undefined): {
	root: ExpertRoot
	dir: string
} {
	const effective: 'user' | 'project' = scope ?? 'user'
	return {
		root: effective,
		dir: getExpertRootDir(effective),
	}
}

/** All roots that should be searched for an expert read. */
function getSearchRoots(
	scope: ExpertScope | undefined,
): Array<{root: ExpertRoot; dir: string}> {
	const effective: ExpertScope = scope ?? 'all'
	const roots: Array<{root: ExpertRoot; dir: string}> = []

	if (effective === 'managed' || effective === 'all') {
		roots.push({root: 'managed', dir: getExpertRootDir('managed')})
	}
	if (effective === 'user' || effective === 'all') {
		roots.push({root: 'user', dir: getExpertRootDir('user')})
	}
	if (effective === 'project' || effective === 'all') {
		for (const dir of getProjectExpertDirs(getCwd())) {
			roots.push({root: 'project', dir})
		}
	}
	return roots
}

/** Internal: read a single expert from one specific root dir. */
async function readExpertFromRoot(
	dir: string,
	slug: string,
	root: ExpertRoot,
): Promise<Expert | null> {
	const expertDir = join(dir, slug)
	if (!existsSync(expertDir)) return null
	return parseExpertDir(expertDir, slug, root)
}

/** Read a single expert by slug. Project shadows user shadows managed. */
export const readExpert = memoize(
	async (
		slug: string,
		scope: ExpertScope | undefined,
	): Promise<Expert | null> => {
		const roots = getSearchRoots(scope)
		// Iterate managed → user → project; first hit wins.
		for (const {root, dir} of roots) {
			const expert = await readExpertFromRoot(dir, slug, root)
			if (expert) return expert
		}
		return null
	},
	(slug, scope) => `${slug}::${scope ?? 'all'}`,
)

/** List all experts. Project experts shadow user experts of the same name;
 *  user experts shadow managed experts. */
export const listExperts = memoize(
	async (
		scope: ExpertScope | undefined,
		typeFilter: 'agent' | 'team' | 'all' | undefined,
	): Promise<Expert[]> => {
		const roots = getSearchRoots(scope)
		const byName = new Map<string, Expert>()

		// managed first, then user, then project — later (higher priority) overwrites.
		for (const {root, dir} of roots) {
			if (!existsSync(dir)) continue
			let entries: string[]
			try {
				const dirEntries = await import('fs/promises').then(m =>
					m.readdir(dir, {withFileTypes: true}),
				)
				entries = dirEntries
					.filter(e => e.isDirectory())
					.map(e => e.name)
			} catch {
				continue
			}
			for (const slug of entries) {
				if (byName.has(slug)) continue // higher-priority root already won
				const expert = await readExpertFromRoot(dir, slug, root)
				if (!expert) continue
				if (typeFilter && typeFilter !== 'all' && expert.expertType !== typeFilter) {
					continue
				}
				byName.set(slug, expert)
			}
		}
		return Array.from(byName.values()).sort((a, b) =>
			a.name.localeCompare(b.name),
		)
	},
	(scope, type) => `${scope ?? 'all'}::${type ?? 'all'}`,
)

/** Invalidate the read cache (call after every write). */
export function clearExpertsCache(): void {
	// lodash-es memoize exposes cache.clear()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cache = (readExpert as any).cache
	if (cache && typeof cache.clear === 'function') cache.clear()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const listCache = (listExperts as any).cache
	if (listCache && typeof listCache.clear === 'function') listCache.clear()
	clearProjectDirsCache()
}

/** Serialize an ExpertMeta to plugin.json content. */
export function serializePluginJson(meta: Expert['meta'] extends never
	? never
	: import('./types.js').ExpertMeta): string {
	return JSON.stringify(meta, null, 2) + '\n'
}

/** Build the YAML frontmatter + body for agents/<slug>.md.
 *
 *  The .md frontmatter is intentionally minimal: agentName + any extras
 *  the caller passed via promptFrontmatter. The role prompt body goes
 *  below the second `---` delimiter. We keep this simple and stable —
 *  WorkBuddy allows rich frontmatter but the model only consumes body. */
export function serializeAgentMarkdown(args: {
	slug: string
	agentName: string
	prompt: string
	promptFrontmatter: Record<string, unknown>
	model?: string
}): string {
	const fm: Record<string, unknown> = {agentName: args.agentName}
	if (args.model) fm['model'] = args.model
	for (const [k, v] of Object.entries(args.promptFrontmatter)) {
		if (v === undefined) continue
		fm[k] = v
	}

	// Simple YAML emitter (one-line scalars only — supports strings, numbers,
	// booleans, and arrays of strings). For richer frontmatter we'd need
	// `js-yaml`, but experts round-trip through our own writer so the loss is
	// acceptable.
	const lines: string[] = ['---']
	for (const [key, value] of Object.entries(fm)) {
		if (value === null || value === undefined) continue
		if (Array.isArray(value)) {
			lines.push(`${key}:`)
			for (const item of value) {
				const s = String(item)
				lines.push(
					s.includes(':') || s.includes('#') || s.startsWith('"')
						? `  - "${s.replace(/"/g, '\\"')}"`
						: `  - ${s}`,
				)
			}
		} else if (typeof value === 'string') {
			const s = value
			const needsQuotes = /[:#{}\[\]\&*!|>%@`]/.test(s) || s === ''
			lines.push(
				needsQuotes ? `${key}: "${s.replace(/"/g, '\\"')}"` : `${key}: ${s}`,
			)
		} else if (typeof value === 'number' || typeof value === 'boolean') {
			lines.push(`${key}: ${value}`)
		} else {
			lines.push(`${key}: ${JSON.stringify(value)}`)
		}
	}
	lines.push('---')
	lines.push('')
	lines.push(args.prompt.trim())
	lines.push('')
	return lines.join('\n')
}

/** Write an expert to disk. Creates the dir tree on demand. */
export async function writeExpert(
	expert: Expert,
	scope: 'user' | 'project' | undefined,
): Promise<{root: ExpertRoot; dir: string; path: string}> {
	const {root, dir} = resolveWriteRoot(scope)
	const expertDir = join(dir, expert.name)
	await mkdir(join(expertDir, EXPERT_AGENT_FILENAME), {recursive: true})

	// plugin.json
	await writeFile(
		join(expertDir, EXPERT_PLUGIN_FILENAME),
		serializePluginJson(expert as unknown as import('./types.js').ExpertMeta),
		'utf-8',
	)

	// agents/<slug>.md
	const mdPath = join(
		expertDir,
		EXPERT_AGENT_FILENAME,
		`${expert.name}${EXPERT_PROMPT_FILENAME_SUFFIX}`,
	)
	await writeFile(
		mdPath,
		serializeAgentMarkdown({
			slug: expert.name,
			agentName: expert.agentName,
			prompt: expert.prompt,
			promptFrontmatter: expert.promptFrontmatter,
			...(expert.model ? {model: expert.model} : {}),
		}),
		'utf-8',
	)

	clearExpertsCache()
	// Invalidate the agent-definitions memo so newly written experts appear in
	// `activeAgents` (used by AgentTool / spawnTeammate for subagent_type
	// resolution). Without this, a freshly created expert wouldn't be visible
	// to the Agent tool until the next process restart.
	clearAgentDefinitionsCache()
	return {root, dir, path: expertDir}
}

/** Delete an expert by name. Looks across the requested scope's roots and
 *  removes the first match (project > user > managed). */
export async function deleteExpert(
	slug: string,
	scope: ExpertScope | undefined,
): Promise<{root: ExpertRoot; path: string} | null> {
	const roots = getSearchRoots(scope)
	// Reverse iteration: project first (highest priority), then user, then
	// managed — this matches the read semantics so deletes target the same
	// copy the user is "looking at".
	const reversed = [...roots].reverse()
	for (const {root, dir} of reversed) {
		const expertDir = join(dir, slug)
		if (!existsSync(expertDir)) continue
		await rm(expertDir, {recursive: true, force: true})
		clearExpertsCache()
		clearAgentDefinitionsCache()
		return {root, path: expertDir}
	}
	return null
}

/** Whether a slug exists at a given scope (used by validateInput). */
export async function expertExists(
	slug: string,
	scope: ExpertScope | undefined,
): Promise<boolean> {
	return (await readExpert(slug, scope)) !== null
}

// Re-export for completeness.
export {EXPERT_SCOPES, EXPERTS_SUBDIR}
