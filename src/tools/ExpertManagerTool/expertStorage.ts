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
 *
 * Two on-disk layouts are supported (see parseExpert.ts):
 *   1. WorkBuddy format (`.codebuddy-plugin/plugin.json` + per-member .md in
 *      `agents/`) — written for newly created team experts.
 *   2. Legacy format (root `plugin.json` + `agents/<slug>.md`) — written for
 *      newly created agent experts. Read transparently for backward compat.
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
import type {Expert, ExpertMeta, I18nString} from './types.js'
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
					.filter(e => e.isDirectory() || e.isSymbolicLink())
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
export function serializePluginJson(meta: ExpertMeta): string {
	return JSON.stringify(meta, null, 2) + '\n'
}

/** Serialize an i18n value to YAML frontmatter value. WorkBuddy's {en, zh}
 *  objects become flow-style YAML. A plain string is emitted unquoted if
 *  safe, otherwise quoted. */
function serializeI18nYaml(value: I18nString | undefined): string | undefined {
	if (value === undefined || value === null) return undefined
	if (typeof value === 'string') return quoteYamlString(value)
	const lines: string[] = []
	if (value.en !== undefined) lines.push(`en: ${quoteYamlString(value.en)}`)
	if (value.zh !== undefined) lines.push(`zh: ${quoteYamlString(value.zh)}`)
	return lines.length > 0 ? lines.join('\n  ') : undefined
}

/** Serialize an array of i18n values into a YAML list (with multiline entries
 *  as flow-style {en, zh} blocks). */
function serializeI18nListYaml(
	values: ReadonlyArray<I18nString> | undefined,
): string {
	if (!values) return ''
	const lines: string[] = []
	for (const v of values) {
		if (typeof v === 'string') {
			lines.push(`  - ${quoteYamlString(v)}`)
		} else {
			const parts: string[] = []
			if (v.en !== undefined) parts.push(`en: ${quoteYamlString(v.en)}`)
			if (v.zh !== undefined) parts.push(`zh: ${quoteYamlString(v.zh)}`)
			lines.push(`  - {${parts.join(', ')}}`)
		}
	}
	return lines.join('\n')
}

/** Quote a YAML scalar if it contains special characters. */
function quoteYamlString(s: string): string {
	const needsQuotes = /[:#{}\[\]\&*!|>%@`]/.test(s) || s === ''
	if (!needsQuotes) return s
	return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Build the YAML frontmatter + body for an agent .md file. */
function buildAgentMarkdown(args: {
	id: string
	prompt: string
	promptFrontmatter: Record<string, unknown>
	model?: string
	displayName?: I18nString
	profession?: I18nString
	description?: string
	maxTurns?: number
}): string {
	const lines: string[] = ['---']
	// WorkBuddy uses `name` (matches the agentType lookup). We also write
	// `agentName` for backward compat with the legacy `agentName` field.
	lines.push(`name: ${args.id}`)
	lines.push(`agentName: ${args.id}`)
	if (args.displayName !== undefined) {
		const dn = serializeI18nYaml(args.displayName)
		if (dn) lines.push(`displayName:\n  ${dn}`)
	}
	if (args.profession !== undefined) {
		const p = serializeI18nYaml(args.profession)
		if (p) lines.push(`profession:\n  ${p}`)
	}
	if (args.description) {
		lines.push(`description: ${quoteYamlString(args.description)}`)
	}
	if (args.model) lines.push(`model: ${args.model}`)
	if (args.maxTurns !== undefined) lines.push(`maxTurns: ${args.maxTurns}`)

	// Append unknown frontmatter keys
	for (const [k, v] of Object.entries(args.promptFrontmatter)) {
		if (v === undefined) continue
		if (typeof v === 'string') {
			lines.push(`${k}: ${quoteYamlString(v)}`)
		} else if (typeof v === 'number' || typeof v === 'boolean') {
			lines.push(`${k}: ${v}`)
		}
		// Skip arrays/objects in legacy frontmatter — schema migration is
		// out of scope for the writer.
	}
	lines.push('---')
	lines.push('')
	lines.push(args.prompt.trim())
	lines.push('')
	return lines.join('\n')
}

/** Write an expert to disk. Creates the dir tree on demand.
 *
 *  - Team experts are written in WorkBuddy format:
 *      <expertDir>/.codebuddy-plugin/plugin.json
 *      <expertDir>/agents/<team-name>-team-lead.md
 *      <expertDir>/agents/<member1>.md
 *      <expertDir>/agents/<member2>.md
 *      ...
 *  - Agent experts are written in legacy format:
 *      <expertDir>/plugin.json
 *      <expertDir>/agents/<slug>.md
 */
export async function writeExpert(
	expert: Expert,
	scope: 'user' | 'project' | undefined,
): Promise<{root: ExpertRoot; dir: string; path: string}> {
	const {root, dir} = resolveWriteRoot(scope)
	const expertDir = join(dir, expert.name)

	if (expert.expertType === 'team') {
		await writeTeamExpert(expert, expertDir)
	} else {
		await writeAgentExpert(expert, expertDir)
	}

	clearExpertsCache()
	// Invalidate the agent-definitions memo so newly written experts appear in
	// `activeAgents` (used by AgentTool / spawnTeammate for subagent_type
	// resolution). Without this, a freshly created expert wouldn't be visible
	// to the Agent tool until the next process restart.
	clearAgentDefinitionsCache()
	return {root, dir, path: expertDir}
}

/** Write a team expert in WorkBuddy format. */
async function writeTeamExpert(expert: Expert, expertDir: string): Promise<void> {
	// Layout: <expertDir>/.codebuddy-plugin/plugin.json
	//         <expertDir>/agents/<team-name>-team-lead.md
	//         <expertDir>/agents/<member1>.md
	//         <expertDir>/agents/<member2>.md
	await mkdir(join(expertDir, '.codebuddy-plugin'), {recursive: true})
	await mkdir(join(expertDir, 'agents'), {recursive: true})

	// Build the lead's .md body
	const leadName = `${expert.name}-team-lead`
	const leadId = expert.teamInfo?.leadAgent ?? leadName

	// Per-member .md (one per member, including the lead)
	const memberDirs = expert.agentFiles ?? new Map<string, string>()

	// Lead .md
	const leadMd = buildAgentMarkdown({
		id: leadId,
		prompt: expert.prompt,
		promptFrontmatter: expert.promptFrontmatter,
		...(expert.model ? {model: expert.model} : {}),
		// The lead's i18n metadata comes from its own teamMemberMeta entry if
		// present, otherwise from the team's metadata.
		displayName: expert.teamMemberMeta?.get(leadId)?.displayName,
		profession: expert.teamMemberMeta?.get(leadId)?.profession,
		description: expert.teamMemberMeta?.get(leadId)?.description,
		maxTurns: expert.teamMemberMeta?.get(leadId)?.maxTurns,
	})
	await writeFile(join(expertDir, 'agents', `${leadId}.md`), leadMd, 'utf-8')

	// Member .md (one per non-lead member). For each member, look up the
	// member's body in teamMemberMeta (loaded by parseExpert) or fall back
	// to a stub from the teamMembers reference.
	for (const member of expert.members ?? []) {
		if (member.id === leadId || member.agentName === leadId) continue
		const memberId = member.id ?? member.agentName ?? ''
		if (!memberId) continue

		// Prefer the loaded body (this expert's stored member file) over a
		// separate agent-type expert's prompt. teamMemberMeta[memberId].body
		// is the actual stored prompt for that member.
		const memberInfo = expert.teamMemberMeta?.get(memberId)
		const body = memberInfo?.body?.trim() || `# ${memberId}\n\nMember prompt not yet authored.`

		const memberMd = buildAgentMarkdown({
			id: memberId,
			prompt: body,
			promptFrontmatter: {},
			displayName: member.displayName ?? memberInfo?.displayName,
			profession: member.profession ?? memberInfo?.profession,
			description: member.description ?? memberInfo?.description,
			...(memberInfo?.maxTurns !== undefined ? {maxTurns: memberInfo.maxTurns} : {}),
		})
		await writeFile(join(expertDir, 'agents', `${memberId}.md`), memberMd, 'utf-8')
	}

	// plugin.json — write the meta, with teamInfo/agents[] filled in if not set
	const meta: ExpertMeta = {
		...expert,
		// Strip runtime-only fields that don't belong in plugin.json
		prompt: undefined as never,
		promptFrontmatter: undefined as never,
		source: undefined as never,
		path: undefined as never,
		leadFile: undefined as never,
		agentFiles: undefined as never,
		teamMemberMeta: undefined as never,
		avatarPath: undefined as never,
		readmePath: undefined as never,
		// Ensure teamInfo is set
		teamInfo:
			expert.teamInfo ??
			({
				leadAgent: leadId,
				memberAgents: (expert.members ?? [])
					.map(m => m.id ?? m.agentName)
					.filter((id): id is string => Boolean(id) && id !== leadId),
			} as ExpertMeta['teamInfo']),
		// Ensure agents[] is set (relative paths to all .md files)
		agents:
			expert.agents ?? [
				`./agents/${leadId}.md`,
				...((expert.members ?? [])
					.map(m => m.id ?? m.agentName)
					.filter((id): id is string => Boolean(id) && id !== leadId)
					.map(id => `./agents/${id}.md`)),
			],
	}
	await writeFile(
		join(expertDir, '.codebuddy-plugin', EXPERT_PLUGIN_FILENAME),
		serializePluginJson(meta),
		'utf-8',
	)
}

/** Write an agent expert in legacy format. */
async function writeAgentExpert(expert: Expert, expertDir: string): Promise<void> {
	await mkdir(join(expertDir, EXPERT_AGENT_FILENAME), {recursive: true})

	// plugin.json (root, legacy)
	await writeFile(
		join(expertDir, EXPERT_PLUGIN_FILENAME),
		serializePluginJson(expert as unknown as ExpertMeta),
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
		buildAgentMarkdown({
			id: expert.agentName,
			prompt: expert.prompt,
			promptFrontmatter: expert.promptFrontmatter,
			...(expert.model ? {model: expert.model} : {}),
		}),
		'utf-8',
	)
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
