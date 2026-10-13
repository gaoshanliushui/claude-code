/**
 * Parse an expert directory on disk into a fully-assembled Expert object.
 *
 * An expert dir contains:
 *   plugin.json     — metadata
 *   agents/<slug>.md — YAML frontmatter + body
 *
 * Mirrors the loader shape used by AgentTool (parseAgentFromMarkdown in
 * loadAgentsDir.ts) but is independent — experts are not agents and don't
 * share their frontmatter schema.
 */
import {existsSync} from 'fs'
import {readFile, readdir} from 'fs/promises'
import {join} from 'path'
import {parseFrontmatter} from '../../../utils/frontmatterParser.js'
import {logForDebugging} from '../../../utils/debug.js'
import type {Expert, ExpertMeta} from '../types.js'
import {expertMetaSchema} from '../types.js'

/** Read and JSON-parse plugin.json (returning a partial meta on failure). */
async function readPluginJson(
	pluginPath: string,
): Promise<ExpertMeta | null> {
	if (!existsSync(pluginPath)) return null
	try {
		const raw = await readFile(pluginPath, 'utf-8')
		const parsed = JSON.parse(raw)
		// Use the schema to coerce / validate. We accept any extra fields but
		// strip to known ones so the consumer has a stable shape.
		const meta = expertMetaSchema.parse(parsed)
		return meta
	} catch (err) {
		logForDebugging(
			`Expert plugin.json failed to parse at ${pluginPath}: ${
				err instanceof Error ? err.message : String(err)
			}`,
			{level: 'warn'},
		)
		return null
	}
}

/** Read agents/<slug>.md; return the body + frontmatter. The agentName
 *  field in frontmatter is required by WorkBuddy's validator. */
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

/** Discover the .md filename inside an expert dir's `agents/` subdir. The
 *  WorkBuddy convention is `<slug>.md`, but we accept any single .md file
 *  if there's exactly one (avoid surprises if user hand-creates files). */
async function findAgentMarkdown(
	expertDir: string,
	slug: string,
): Promise<string | null> {
	const agentsDir = join(expertDir, 'agents')
	if (!existsSync(agentsDir)) return null
	try {
		const entries = await readdir(agentsDir)
		const mdFiles = entries.filter(f => f.endsWith('.md'))
		if (mdFiles.includes(`${slug}.md`)) return join(agentsDir, `${slug}.md`)
		if (mdFiles.length === 1 && mdFiles[0]) return join(agentsDir, mdFiles[0])
		return null
	} catch {
		return null
	}
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
	const pluginPath = join(expertDir, 'plugin.json')
	const meta = await readPluginJson(pluginPath)
	if (!meta) return null

	const mdPath = await findAgentMarkdown(expertDir, slug)
	if (!mdPath) {
		logForDebugging(
			`Expert ${slug} (${expertDir}) has no agents/<slug>.md`,
			{level: 'warn'},
		)
		return null
	}
	const md = await readAgentMarkdown(mdPath)
	if (!md) return null

	const modelRaw = md.frontmatter['model']
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
		...restFrontmatter
	} = md.frontmatter

	return {
		...meta,
		prompt: md.body.trim(),
		promptFrontmatter: restFrontmatter,
		...(model ? {model} : {}),
		source,
		path: expertDir,
	}
}
