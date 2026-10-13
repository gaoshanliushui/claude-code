/**
 * Read-side expert discovery for the claude-code CLI.
 *
 * The CLI's expert pipeline is "skill-managed":
 *   - Experts are created/edited/validated by the `expert-manager` skill
 *     (~/.claude/skills/expert-manager/scripts/*).
 *   - The CLI's job is just to discover the resulting on-disk packages
 *     and bridge them into the Agent tool's subagent_type registry so
 *     they can be invoked.
 *
 * The on-disk format (WorkBuddy-compatible) is:
 *   <expertDir>/
 *     .codebuddy-plugin/plugin.json   ← identity
 *     agents/<team-name>-team-lead.md ← system prompt (team)
 *     agents/<member1>.md             ← system prompt (member)
 *     ...
 *
 * Two layouts are supported on read:
 *   1. WorkBuddy format: `.codebuddy-plugin/plugin.json`
 *   2. Legacy format:    root `plugin.json` (transparent backward compat)
 */
import {z} from 'zod/v4'

export type ExpertScope = 'user' | 'project' | 'all'
export type ExpertTypeFilter = 'agent' | 'team' | 'all'
export type ExpertRoot = 'managed' | 'user' | 'project'

export const EXPERTS_SUBDIR = 'experts'

export const EXPERT_SLUG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

// ---------------------------------------------------------------------------
// plugin.json shape (WorkBuddy-compatible)
// ---------------------------------------------------------------------------

const i18nStringSchema = z
	.union([z.string(), z.object({en: z.string().optional(), zh: z.string().optional()})])

const i18nBilingualSchema = i18nStringSchema

const displayNameSchema = i18nStringSchema.refine(v => {
	if (typeof v === 'string') return v.length > 0
	return Boolean(v.en ?? v.zh)
}, 'displayName cannot be empty')

const professionSchema = displayNameSchema

const categoryIdSchema = z.string().min(1)

const authorSchema = z
	.union([
		z.string(),
		z.object({name: z.string(), email: z.string().email().optional()}),
	])
	.optional()

const teamMemberSchema = z.object({
	id: z.string().regex(EXPERT_SLUG_REGEX).optional(),
	agentName: z.string().regex(EXPERT_SLUG_REGEX).optional(),
	displayName: i18nStringSchema.optional(),
	profession: i18nStringSchema.optional(),
	description: z.string().optional(),
	avatar: z.string().optional(),
	role: z.enum(['lead', 'member']).optional(),
})

const teamInfoSchema = z.object({
	leadAgent: z.string(),
	memberAgents: z.array(z.string()),
})

export const expertMetaSchema = z.object({
	name: z.string().regex(EXPERT_SLUG_REGEX),
	expertType: z.enum(['agent', 'team']),
	agentName: z.string().regex(EXPERT_SLUG_REGEX),
	displayName: displayNameSchema,
	profession: professionSchema,
	description: z.string().min(1),
	categoryId: categoryIdSchema,
	tags: z.array(i18nBilingualSchema).length(3),
	quickPrompts: z.array(i18nBilingualSchema).length(3),
	defaultInitPrompt: i18nStringSchema,
	members: z.array(teamMemberSchema).optional(),
	version: z.string().optional(),
	author: authorSchema,
	displayDescription: i18nStringSchema.optional(),
	avatar: z.string().optional(),
	plugin: z.string().regex(EXPERT_SLUG_REGEX).optional(),
	teamInfo: teamInfoSchema.optional(),
	agents: z.array(z.string()).optional(),
})

export type ExpertMeta = z.infer<typeof expertMetaSchema>

// ---------------------------------------------------------------------------
// Loaded Expert (plugin.json + per-member .md)
// ---------------------------------------------------------------------------

export type MemberAgentInfo = {
	id: string
	frontmatter: Record<string, unknown>
	body: string
	displayName?: string | {en?: string; zh?: string}
	profession?: string | {en?: string; zh?: string}
	description?: string
	maxTurns?: number
}

export type Expert = ExpertMeta & {
	prompt: string
	promptFrontmatter: Record<string, unknown>
	model?: string
	source: ExpertRoot
	path: string
	leadFile?: string
	agentFiles: Map<string, string>
	teamMemberMeta?: Map<string, MemberAgentInfo>
	avatarPath?: string
	readmePath?: string
}
