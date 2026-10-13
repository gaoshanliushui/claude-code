/**
 * Parse an expert directory on disk into a fully-assembled Expert object.
 *
 * Two on-disk layouts are supported:
 *
 *   1. WorkBuddy format (preferred):
 *        <expertDir>/
 *        ├── .codebuddy-plugin/plugin.json
 *        ├── agents/<team-name>-team-lead.md    (team)
 *        ├── agents/<member1-slug>.md           (team)
 *        ├── agents/<member2-slug>.md           (team)
 *        ├── agents/<slug>.md                   (agent)
 *        ├── avatars/team.png                   (optional)
 *        ├── avatars/<id>.png                   (optional)
 *        └── README.md                          (optional)
 *
 *   2. Legacy format (backward compat):
 *        <expertDir>/
 *        ├── plugin.json
 *        └── agents/<slug>.md
 *
 * The reader picks WorkBuddy format if `.codebuddy-plugin/plugin.json`
 * exists, otherwise falls back to legacy. Both produce the same Expert
 * object.
 *
 * For team experts, every member's .md is discovered and mapped by `id`.
 * The lead's path is also surfaced as `leadFile` for the runtime (which
 * uses it to register the expert as an `expert:<slug>` agent type).
 *
 * Mirrors the loader shape used by AgentTool (parseAgentFromMarkdown in
 * loadAgentsDir.ts) but is independent — experts are not agents and don't
 * share their frontmatter schema.
 */
import {existsSync} from 'fs'
import {readFile, readdir, stat} from 'fs/promises'
import {join} from 'path'
import {parseFrontmatter, parsePositiveIntFromFrontmatter, coerceDescriptionToString} from '../../../utils/frontmatterParser.js'
import {logForDebugging} from '../../../utils/debug.js'
import type {Expert, ExpertMeta, MemberAgentInfo} from '../types.js'
import {expertMetaSchema} from '../types.js'

/** Read and JSON-parse plugin.json. Tries `.codebuddy-plugin/plugin.json`
 *  first (WorkBuddy), falls back to root `plugin.json` (legacy). */
async function readPluginJson(
	expertDir: string,
): Promise<{meta: ExpertMeta; path: string} | null> {
	const wbPath = join(expertDir, '.codebuddy-plugin', 'plugin.json')
	const legacyPath = join(expertDir, 'plugin.json')
	const path = existsSync(wbPath) ? wbPath : existsSync(legacyPath) ? legacyPath : null
	if (!path) return null
	try {
		const raw = await readFile(path, 'utf-8')
		const parsed = JSON.parse(raw)
		const meta = expertMetaSchema.parse(parsed)
		return {meta, path}
	} catch (err) {
		logForDebugging(
			`Expert plugin.json failed to parse at ${path}: ${
				err instanceof Error ? err.message : String(err)
			}`,
			{level: 'warn'},
		)
		return null
	}
}

/** Read a .md file and return its parsed frontmatter + body. */
async function readAgentMarkdown(
	mdPath: string,
): Promise<{frontmatter: Record<string, unknown>; body: string} | null> {
	if (!existsSync(mdPath)) return null
	try {
		const raw = await readFile(mdPath, 'utf-8')
		const {frontmatter, content} = parseFrontmatter(raw, mdPath)
		return {frontmatter: frontmatter as Record<string, unknown>, body: content}
	} catch (err) {
		logForDebugging(
			`Expert agent markdown failed to read at ${mdPath}: ${
				err instanceof Error ? err.message : String(err)
			}`,
			{level: 'warn'},
		)
		return null
	}
}

/** Extract MemberAgentInfo from a member's .md frontmatter. */
function extractMemberInfo(
	id: string,
	frontmatter: Record<string, unknown>,
	body: string,
): MemberAgentInfo {
	const displayName = frontmatter['displayName']
	const profession = frontmatter['profession']
	const descriptionRaw = frontmatter['description']
	const maxTurns = parsePositiveIntFromFrontmatter(frontmatter['maxTurns'])

	return {
		id,
		frontmatter,
		body,
		displayName:
			typeof displayName === 'string'
				? displayName
				: (displayName as {en?: string; zh?: string} | undefined),
		profession:
			typeof profession === 'string'
				? profession
				: (profession as {en?: string; zh?: string} | undefined),
		description: coerceDescriptionToString(descriptionRaw) ?? undefined,
		...(maxTurns !== undefined ? {maxTurns} : {}),
	}
}

/** Resolve a member id from a .md file's frontmatter.
 *  WorkBuddy uses `name`; legacy uses `agentName`; otherwise fall back to
 *  the file basename. */
function resolveMemberIdFromFrontmatter(
	frontmatter: Record<string, unknown>,
	fileBase: string,
): string {
	const name = frontmatter['name']
	if (typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) {
		return name
	}
	const agentName = frontmatter['agentName']
	if (
		typeof agentName === 'string' &&
		/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(agentName)
	) {
		return agentName
	}
	return fileBase
}

/** Discover all .md files for an expert and return id→path map.
 *  - For team experts with teamInfo: prefer files matching teamInfo.leadAgent
 *    and teamInfo.memberAgents, then fall back to scanning the dir.
 *  - For simple agents: return the single file matching <slug>.md (legacy),
 *    or any single .md in the dir. */
async function findAgentFiles(
	expertDir: string,
	slug: string,
	meta: ExpertMeta,
): Promise<Map<string, string>> {
	const agentsDir = join(expertDir, 'agents')
	if (!existsSync(agentsDir)) return new Map()

	let entries: string[]
	try {
		entries = await readdir(agentsDir)
	} catch {
		return new Map()
	}
	const mdFiles = entries.filter(f => f.endsWith('.md'))
	const out = new Map<string, string>()

	if (meta.expertType === 'team') {
		// WorkBuddy: try teamInfo first
		if (meta.teamInfo) {
			const leadPath = join(agentsDir, `${meta.teamInfo.leadAgent}.md`)
			if (existsSync(leadPath)) out.set(meta.teamInfo.leadAgent, leadPath)
			for (const memberId of meta.teamInfo.memberAgents) {
				const p = join(agentsDir, `${memberId}.md`)
				if (existsSync(p)) out.set(memberId, p)
			}
		}
		// Fallback: scan all .md files
		if (out.size === 0) {
			for (const f of mdFiles) {
				const id = f.replace(/\.md$/, '')
				out.set(id, join(agentsDir, f))
			}
		}
	} else {
		// Simple agent: <slug>.md (legacy)
		const simplePath = join(agentsDir, `${slug}.md`)
		if (existsSync(simplePath)) {
			out.set(slug, simplePath)
		} else if (mdFiles.length === 1 && mdFiles[0]) {
			out.set(mdFiles[0].replace(/\.md$/, ''), join(agentsDir, mdFiles[0]))
		}
	}
	return out
}

/** Pick the lead .md file from agentFiles. Convention: filename matches
 *  `<team-name>-team-lead.md` (WorkBuddy). Fallback: the entry in
 *  teamInfo.leadAgent, or any .md with `role: lead` in frontmatter,
 *  or the first entry. */
function findLeadFile(
	expertDir: string,
	slug: string,
	meta: ExpertMeta,
	agentFiles: Map<string, string>,
): string | undefined {
	// 1. WorkBuddy convention: <team-name>-team-lead.md (the team's own
	//    lead prompt, separate from any separate-expert lead).
	const expectedLeadName = `${slug}-team-lead`
	const direct = join(expertDir, 'agents', `${expectedLeadName}.md`)
	if (existsSync(direct)) return direct

	// 2. teamInfo.leadAgent — could be a separate expert's slug.
	if (meta.teamInfo) {
		const fromInfo = agentFiles.get(meta.teamInfo.leadAgent)
		if (fromInfo) return fromInfo
	}

	// 3. Any .md whose id matches <team-name>-team-lead (already covered by 1)
	//    or whose frontmatter has role: lead. Done lazily via filename match.
	for (const [id, p] of agentFiles) {
		if (id === `${slug}-team-lead`) return p
	}

	// 4. Default: first .md
	return agentFiles.values().next().value
}

/** Lazily read and cache frontmatter+body for each member's .md. */
async function readTeamMemberMeta(
	agentFiles: Map<string, string>,
): Promise<Map<string, MemberAgentInfo>> {
	const out = new Map<string, MemberAgentInfo>()
	for (const [id, p] of agentFiles) {
		const md = await readAgentMarkdown(p)
		if (!md) continue
		out.set(id, extractMemberInfo(id, md.frontmatter, md.body))
	}
	return out
}

/** Try to resolve an avatar file (PNG). Returns absolute path if it exists. */
async function findAvatar(
	expertDir: string,
	relativePath: string | undefined,
): Promise<string | undefined> {
	if (!relativePath) return undefined
	const abs = join(expertDir, relativePath)
	try {
		const s = await stat(abs)
		if (s.isFile()) return abs
	} catch {
		/* ENOENT */
	}
	return undefined
}

/** Try to resolve README.md at the expert root. */
async function findReadme(expertDir: string): Promise<string | undefined> {
	const p = join(expertDir, 'README.md')
	try {
		const s = await stat(p)
		if (s.isFile()) return p
	} catch {
		/* ENOENT */
	}
	return undefined
}

/**
 * Parse a single expert directory. Returns null if plugin.json is missing
 * or invalid — callers should treat that as "skip".
 */
export async function parseExpertDir(
	expertDir: string,
	slug: string,
	source: 'managed' | 'user' | 'project',
): Promise<Expert | null> {
	const result = await readPluginJson(expertDir)
	if (!result) return null
	const {meta} = result

	const agentFiles = await findAgentFiles(expertDir, slug, meta)
	if (agentFiles.size === 0) {
		logForDebugging(
			`Expert ${slug} (${expertDir}) has no agents/*.md`,
			{level: 'warn'},
		)
		return null
	}

	// Pick the lead .md
	const leadFile = findLeadFile(expertDir, slug, meta, agentFiles)
	if (!leadFile) {
		logForDebugging(
			`Expert ${slug} (${expertDir}) found ${agentFiles.size} agent file(s) but could not pick a lead`,
			{level: 'warn'},
		)
		return null
	}

	// Read the lead .md
	const leadMd = await readAgentMarkdown(leadFile)
	if (!leadMd) return null

	const modelRaw = leadMd.frontmatter['model']
	const model =
		typeof modelRaw === 'string' && modelRaw.trim().length > 0
			? modelRaw.trim()
			: undefined

	// Extract the standard WorkBuddy fields from the frontmatter so we can
	// round-trip without them being duplicated.
	const {
		name: _fName,
		description: _fDescription,
		model: _fModel,
		agentName: _fAgentName,
		displayName: _fDisplayName,
		profession: _fProfession,
		maxTurns: _fMaxTurns,
		...restFrontmatter
	} = leadMd.frontmatter

	// Lazily read all team member metas (only for team experts with multiple files)
	let teamMemberMeta: Map<string, MemberAgentInfo> | undefined
	if (meta.expertType === 'team' && agentFiles.size > 1) {
		teamMemberMeta = await readTeamMemberMeta(agentFiles)
	}

	// Resolve optional WorkBuddy files
	const avatarPath = await findAvatar(expertDir, meta.avatar)
	const readmePath = await findReadme(expertDir)

	// Safety net: legacy plugin.json files used `agentName` only on members
	// (no `id`). Populate `id` from `agentName` if missing so downstream
	// code (`m.id ?? m.agentName`) always finds a usable id.
	const normalizedMembers = Array.isArray(meta.members)
		? meta.members.map(m => ({
				...m,
				id: m.id ?? m.agentName,
			}))
		: meta.members

	return {
		...meta,
		members: normalizedMembers,
		prompt: leadMd.body.trim(),
		promptFrontmatter: restFrontmatter,
		...(model ? {model} : {}),
		source,
		path: expertDir,
		leadFile,
		agentFiles,
		...(teamMemberMeta ? {teamMemberMeta} : {}),
		...(avatarPath ? {avatarPath} : {}),
		...(readmePath ? {readmePath} : {}),
	}
}
