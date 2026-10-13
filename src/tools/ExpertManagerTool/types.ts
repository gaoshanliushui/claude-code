/**
 * Type definitions and Zod schemas for the ExpertManager tool.
 *
 * An "expert" is a directory:
 *   <root>/experts/<slug>/
 *   ├── .codebuddy-plugin/plugin.json     # identity card (WorkBuddy format)
 *   │       OR
 *   ├── plugin.json                       # legacy format (still supported)
 *   │
 *   ├── agents/<slug>.md                  # for agent-type: single .md
 *   │       OR
 *   ├── agents/<team-name>-team-lead.md   # for team-type: lead .md (WorkBuddy)
 *   ├── agents/<member1-slug>.md          # + one .md per member
 *   │
 *   ├── avatars/team.png                  # optional team avatar
 *   ├── avatars/<id>.png                  # optional per-member avatars
 *   └── README.md                         # optional human-readable doc
 *
 * Mirrors WorkBuddy's `plugin.json` schema (expertType, agentName, displayName,
 * profession, description, categoryId, tags, quickPrompts, defaultInitPrompt,
 * members, plus the full WorkBuddy field set: version, author, displayDescription,
 * avatar, plugin, teamInfo, agents[]).
 *
 * All i18n fields accept either a plain string (legacy) or a {en, zh} object
 * (WorkBuddy). This makes the schema backward-compatible: the 7 existing
 * experts using flat strings still parse without modification.
 */
import {z} from 'zod/v4'
import {
	EXPERT_CATEGORIES,
	EXPERT_SCOPES,
	EXPERT_SLUG_REGEX,
	EXPERT_TYPES,
} from './constants.js'

// ---------------------------------------------------------------------------
// i18n primitives
// ---------------------------------------------------------------------------

/** WorkBuddy's i18n pattern: accept either a plain string (legacy) or a
 *  {en?, zh?} object. At least one of en/zh must be present. */
export const i18nStringSchema = z
	.union([
		z.string().min(1),
		z
			.object({
				en: z.string().min(1).optional(),
				zh: z.string().min(1).optional(),
			})
			.refine(v => Boolean(v.en) || Boolean(v.zh), {
				message: 'i18n object must have at least one of en or zh',
			}),
	])
	.describe(
		'Localized string — either a plain string or {en?, zh?} object. ' +
			'WorkBuddy convention.',
	)
export type I18nString = string | {en?: string; zh?: string}

/** WorkBuddy requires both en and zh for tags/quickPrompts, but we accept
 *  a plain string as a legacy fallback (rendered as zh-only). */
export const i18nBilingualSchema = z
	.union([
		z.string().min(1),
		z.object({
			en: z.string().min(1).optional(),
			zh: z.string().min(1).optional(),
		}),
	])
	.describe('Localized tag/prompt — string or {en?, zh?}.')
export type I18nBilingual = I18nString

// Backward-compat aliases (existing code refers to these)
export const displayNameSchema = i18nStringSchema
export const professionSchema = i18nStringSchema
export type DisplayName = I18nString
export type Profession = I18nString

// ---------------------------------------------------------------------------
// member schema (WorkBuddy uses `id` + `role`; legacy uses `agentName`)
// ---------------------------------------------------------------------------

/** WorkBuddy's member shape. `id` is the slug used in the team's `agents/`
 *  directory (and in `teamInfo.memberAgents`). `agentName` is the legacy
 *  field that referenced a separate agent-type expert; we still accept it
 *  for backward compat with the 7 existing experts. */
export const teamMemberSchema = z
	.object({
		// WorkBuddy canonical field
		id: z
			.string()
			.regex(EXPERT_SLUG_REGEX)
			.optional()
			.describe('Member ID (slug, used in agents/<id>.md).'),
		// Legacy field — used to reference a separate agent-type expert
		agentName: z
			.string()
			.regex(EXPERT_SLUG_REGEX)
			.optional()
			.describe('Legacy: slug of a separate agent-type expert.'),
		// WorkBuddy full member metadata
		displayName: i18nStringSchema.optional(),
		profession: i18nStringSchema.optional(),
		avatar: z
			.string()
			.optional()
			.describe('Relative path under the expert dir, e.g. "avatars/foo.png".'),
		role: z
			.enum(['lead', 'member'])
			.optional()
			.describe('WorkBuddy role. "lead" for the team lead, "member" otherwise.'),
	})
	.refine(v => Boolean(v.id) || Boolean(v.agentName), {
		message: 'member must have at least one of id or agentName',
	})
export type TeamMember = z.infer<typeof teamMemberSchema>

// ---------------------------------------------------------------------------
// full expert meta — WorkBuddy-compatible + backward compat
// ---------------------------------------------------------------------------

/** Hierarchical category: WorkBuddy uses "06-ContentCreative" style IDs.
 *  We also accept the original flat enum for backward compat. */
const categoryIdSchema = z
	.union([
		z.enum(EXPERT_CATEGORIES),
		// WorkBuddy hierarchical format: two digits, dash, PascalCase
		z.string().regex(/^\d{2}-[A-Z][A-Za-z]+$/),
		// Free-form fallback
		z.string().min(1),
	])
	.describe('Industry category id (flat enum or WorkBuddy hierarchical like "06-ContentCreative").')

/** TeamInfo — WorkBuddy's explicit lead/member split. */
const teamInfoSchema = z
	.object({
		leadAgent: z
			.string()
			.regex(EXPERT_SLUG_REGEX)
			.describe('Slug of the lead agent (matches <filename> in agents/<id>.md).'),
		memberAgents: z
			.array(z.string().regex(EXPERT_SLUG_REGEX))
			.min(1)
			.describe('Slugs of member agents.'),
	})
	.optional()

/** Author — WorkBuddy format. */
const authorSchema = z
	.object({
		name: z.string().min(1),
		// Lenient: any non-empty string. WorkBuddy authors sometimes use
		// masked emails (e.g. "[email protected]") that fail strict RFC regex.
		email: z.string().min(1).optional(),
	})
	.optional()

/** Full expert meta — WorkBuddy-compatible. */
export const expertMetaSchema = z.object({
	// ---- required identity fields ----
	name: z
		.string()
		.regex(EXPERT_SLUG_REGEX)
		.describe('Unique slug for the expert.'),
	expertType: z
		.enum(['agent', 'team'])
		.describe('`agent` for a single expert, `team` for a multi-expert squad.'),
	agentName: z
		.string()
		.regex(EXPERT_SLUG_REGEX)
		.describe('Same as `name`; required by WorkBuddy schema.'),
	displayName: displayNameSchema.describe('Human-readable display name.'),
	profession: professionSchema.describe('Job-title / domain.'),
	description: z
		.string()
		.min(1)
		.describe(
			'Short description of what the expert does. ' +
				'WorkBuddy requires 40-50 characters if it contains CJK characters.',
		),
	categoryId: categoryIdSchema.describe('Industry category id.'),

	// ---- i18n-typed list fields (WorkBuddy shape) ----
	tags: z
		.array(i18nBilingualSchema)
		.length(3)
		.describe('Exactly 3 tags. Each may be a string or {en?, zh?}.'),
	quickPrompts: z
		.array(i18nBilingualSchema)
		.length(3)
		.describe('Exactly 3 recommended questions to start with this expert.'),
	defaultInitPrompt: i18nStringSchema.describe(
		'Default initialization prompt; should equal quickPrompts[0].',
	),

	// ---- team-specific ----
	members: z
		.array(teamMemberSchema)
		.optional()
		.describe('For expertType=team only: list of members.'),

	// ---- NEW WorkBuddy fields (all optional for backward compat) ----
	version: z
		.string()
		.regex(/^\d+\.\d+\.\d+/)
		.optional()
		.describe('Semver version, e.g. "1.0.0".'),
	author: authorSchema.describe('Plugin author info.'),
	displayDescription: i18nStringSchema
		.optional()
		.describe(
			'Long-form description (separate from `description`). ' +
				'Used in UI cards. WorkBuddy convention.',
		),
	avatar: z
		.string()
		.optional()
		.describe('Team avatar path relative to expert dir, e.g. "avatars/team.png".'),
	plugin: z
		.string()
		.regex(EXPERT_SLUG_REGEX)
		.optional()
		.describe('Plugin identifier (often same as name).'),
	teamInfo: teamInfoSchema.describe(
		'For expertType=team: explicit lead + member split. WorkBuddy convention.',
	),
	agents: z
		.array(z.string())
		.optional()
		.describe('Relative .md paths to all agent files in this expert.'),
})
export type ExpertMeta = z.infer<typeof expertMetaSchema>

// ---------------------------------------------------------------------------
// Expert (loaded) — same as ExpertMeta + runtime fields + member file map
// ---------------------------------------------------------------------------

/** Frontmatter + body for a team member's .md file (lazily loaded). */
export type MemberAgentInfo = {
	id: string
	frontmatter: Record<string, unknown>
	body: string
	displayName?: I18nString
	profession?: I18nString
	description?: string
	maxTurns?: number
}

/** The complete expert, assembled from plugin.json + agents/<slug>.md. */
export type Expert = ExpertMeta & {
	/** Prompt body (markdown after YAML frontmatter). The frontmatter itself
	 *  is reconstructed from ExpertMeta + the .md frontmatter below. */
	prompt: string
	/** Frontmatter keys from agents/<slug>.md beyond the standard fields.
	 *  Stored verbatim so round-trips don't lose unknown keys. */
	promptFrontmatter: Record<string, unknown>
	/** Optional model override declared in the .md frontmatter. */
	model?: string
	/** Storage source — which root it was loaded from. */
	source: 'managed' | 'user' | 'project'
	/** Absolute path to the expert directory on disk. */
	path: string
	// ---- WorkBuddy structure extensions ----
	/** Path to the lead's .md file (WorkBuddy naming: `<team-name>-team-lead.md`).
	 *  For agent-type experts, this is the single .md. */
	leadFile?: string
	/** Map of member id → .md file path (populated for team experts with
	 *  per-member files). */
	agentFiles?: Map<string, string>
	/** Lazily-loaded frontmatter+body for each member's .md. */
	teamMemberMeta?: Map<string, MemberAgentInfo>
	/** Absolute path to the avatar file (if `avatar` field is set and file exists). */
	avatarPath?: string
	/** Absolute path to README.md (if present). */
	readmePath?: string
}

export const expertScopeSchema = z.enum(EXPERT_SCOPES).optional()
export const expertTypeFilterSchema = z.enum(EXPERT_TYPES).optional()

// ---------------------------------------------------------------------------
// Discriminated input schema
// ---------------------------------------------------------------------------

/** A i18n list of exactly 3 entries, each a string or {en?, zh?}. */
const i18nBilingualArray3 = z
	.array(i18nBilingualSchema)
	.length(3)
	.describe('Exactly 3 entries, each a string or {en?, zh?}.')
const i18nStringNonEmpty = i18nStringSchema

/** Discriminated input schema for the ExpertManager tool. */
export const inputSchema = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('list'),
		scope: expertScopeSchema.describe(
			'Where to look: `user` (only ~/.claude/experts), `project` (only project-level), or `all` (default — both, with project shadowing user).',
		),
		type: expertTypeFilterSchema.describe(
			'Filter by expert type: `agent`, `team`, or `all` (default).',
		),
	}),
	z.object({
		action: z.literal('view'),
		name: z.string().regex(EXPERT_SLUG_REGEX).describe('Expert slug to view.'),
		scope: expertScopeSchema,
	}),
	z.object({
		action: z.literal('create'),
		name: z.string().regex(EXPERT_SLUG_REGEX).describe('Unique slug for the new expert.'),
		displayName: displayNameSchema,
		profession: professionSchema,
		description: z.string().min(1).describe(
			'Short description. If it contains CJK characters, WorkBuddy requires 40-50 chars.',
		),
		categoryId: categoryIdSchema,
		tags: i18nBilingualArray3,
		quickPrompts: i18nBilingualArray3,
		prompt: z.string().min(1).describe(
			'The system-prompt body that defines the expert\'s role and behavior.',
		),
		model: z
			.string()
			.optional()
			.describe('Optional model alias for this expert (e.g. "haiku", "sonnet").'),
		defaultInitPrompt: i18nStringNonEmpty.optional().describe(
			'Optional. Defaults to quickPrompts[0].',
		),
		// WorkBuddy optional fields
		version: z.string().regex(/^\d+\.\d+\.\d+/).optional(),
		author: authorSchema,
		displayDescription: i18nStringNonEmpty.optional(),
		avatar: z.string().optional(),
		plugin: z.string().regex(EXPERT_SLUG_REGEX).optional(),
		scope: expertScopeSchema.describe(
			'Where to store: `user` (default — global ~/.claude/experts) or `project` (<cwd>/.claude/experts).',
		),
	}),
	z.object({
		action: z.literal('create_team'),
		name: z.string().regex(EXPERT_SLUG_REGEX).describe('Unique slug for the team.'),
		displayName: displayNameSchema,
		profession: professionSchema,
		description: z.string().min(1),
		displayDescription: i18nStringNonEmpty.optional(),
		categoryId: categoryIdSchema,
		tags: i18nBilingualArray3,
		quickPrompts: i18nBilingualArray3,
		defaultInitPrompt: i18nStringNonEmpty.optional(),
		// Team structure: legacy `leader_agent`+`member_agents` is still accepted
		leader_agent: z
			.string()
			.regex(EXPERT_SLUG_REGEX)
			.describe('Slug of an existing agent-type expert that leads the team.'),
		member_agents: z
			.array(z.string().regex(EXPERT_SLUG_REGEX))
			.min(1)
			.describe('Slugs of additional agent-type experts in the team.'),
		// WorkBuddy optional fields
		version: z.string().regex(/^\d+\.\d+\.\d+/).optional(),
		author: authorSchema,
		avatar: z.string().optional(),
		plugin: z.string().regex(EXPERT_SLUG_REGEX).optional(),
		workflows: z
			.array(
				z.object({
					id: z.string().min(1),
					name: i18nStringNonEmpty.optional(),
					phases: z.array(z.string()).min(1),
					description: z.string().optional(),
				}),
			)
			.optional()
			.describe(
				'Optional Workflow A/B/C/D entries. WorkBuddy convention. The lead\'s prompt ' +
					'body describes how to apply each workflow.',
			),
		scope: expertScopeSchema,
	}),
	z.object({
		action: z.literal('edit'),
		name: z.string().regex(EXPERT_SLUG_REGEX).describe('Expert slug to edit.'),
		scope: expertScopeSchema,
		displayName: displayNameSchema.optional(),
		profession: professionSchema.optional(),
		description: z.string().min(1).optional(),
		displayDescription: i18nStringNonEmpty.optional(),
		categoryId: categoryIdSchema.optional(),
		tags: i18nBilingualArray3.optional(),
		quickPrompts: i18nBilingualArray3.optional(),
		prompt: z.string().min(1).optional().describe(
			'Replace the system-prompt body. Replaces the .md file content.',
		),
		defaultInitPrompt: i18nStringNonEmpty.optional(),
		members: z.array(teamMemberSchema).optional().describe(
			'Replace the team member list (team experts only).',
		),
		// WorkBuddy fields
		version: z.string().regex(/^\d+\.\d+\.\d+/).optional(),
		author: authorSchema,
		avatar: z.string().optional(),
		teamInfo: teamInfoSchema,
	}),
	z.object({
		action: z.literal('delete'),
		name: z.string().regex(EXPERT_SLUG_REGEX).describe('Expert slug to delete.'),
		scope: expertScopeSchema,
	}),
	z.object({
		action: z.literal('validate'),
		name: z.string().regex(EXPERT_SLUG_REGEX).describe('Expert slug to validate.'),
		scope: expertScopeSchema,
	}),
	z.object({
		action: z.literal('invoke'),
		name: z.string().regex(EXPERT_SLUG_REGEX).describe(
			'Expert slug to activate.',
		),
		prompt: z
			.string()
			.min(1)
			.describe('The task / question to give the expert.'),
		scope: expertScopeSchema,
		model: z
			.string()
			.optional()
			.describe('Override the expert\'s default model for this invocation.'),
		runtime: z
			.enum(['auto', 'single', 'team'])
			.default('auto')
			.describe(
				"Execution mode. 'auto' picks by expertType (team→team if swarms enabled, else single). " +
					"'single' always uses the in-process runAgent path (no real teammates). " +
					"'team' uses TeamCreate + real teammates with SendMessage. Requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 (or USER_TYPE=ant).",
			),
		persistTeam: z
			.boolean()
			.default(false)
			.describe(
				'If true, do not call TeamDelete when invoke finishes. Useful for inspection / further coordination.',
			),
		teamTimeoutMs: z
			.number()
			.int()
			.positive()
			.optional()
			.describe('Per-invocation idle timeout in ms. Default 600000 (10 min).'),
	}),
])
export type ExpertManagerInput = z.infer<typeof inputSchema>

/** Output schema — discriminated by action. */
export const outputSchema = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('list'),
		scope: z.enum(EXPERT_SCOPES),
		experts: z.array(
			z.object({
				name: z.string(),
				expertType: z.enum(['agent', 'team']),
				displayName: displayNameSchema,
				profession: professionSchema,
				description: z.string(),
				tags: z.array(z.union([z.string(), z.object({en: z.string().optional(), zh: z.string().optional()})])),
				categoryId: z.string(),
				scope: z.enum(['managed', 'user', 'project']),
				path: z.string(),
				// New optional fields exposed in list view
				version: z.string().optional(),
				avatar: z.string().optional(),
			}),
		),
	}),
	z.object({
		action: z.literal('view'),
		expert: z.object({
			meta: expertMetaSchema,
			prompt: z.string(),
			model: z.string().optional(),
			scope: z.enum(['managed', 'user', 'project']),
			path: z.string(),
			// New optional fields
			leadFile: z.string().optional(),
			agentFiles: z.array(z.object({id: z.string(), path: z.string()})).optional(),
			avatarPath: z.string().optional(),
			readmePath: z.string().optional(),
		}),
	}),
	z.object({
		action: z.literal('create'),
		created: z.object({
			name: z.string(),
			expertType: z.literal('agent'),
			scope: z.enum(['managed', 'user', 'project']),
			path: z.string(),
		}),
	}),
	z.object({
		action: z.literal('create_team'),
		created: z.object({
			name: z.string(),
			expertType: z.literal('team'),
			scope: z.enum(['managed', 'user', 'project']),
			path: z.string(),
			members: z.array(teamMemberSchema),
		}),
	}),
	z.object({
		action: z.literal('edit'),
		updated: z.object({
			name: z.string(),
			scope: z.enum(['managed', 'user', 'project']),
			path: z.string(),
			changedFields: z.array(z.string()),
		}),
	}),
	z.object({
		action: z.literal('delete'),
		deleted_name: z.string(),
		scope: z.enum(['managed', 'user', 'project']),
		path: z.string(),
	}),
	z.object({
		action: z.literal('validate'),
		name: z.string(),
		scope: z.enum(['managed', 'user', 'project']),
		valid: z.boolean(),
		errors: z.array(
			z.object({
				field: z.string(),
				message: z.string(),
			}),
		),
	}),
	z.object({
		action: z.literal('invoke'),
		status: z.enum(['completed', 'rejected']),
		expertName: z.string(),
		expertType: z.enum(['agent', 'team']),
		agentId: z.string(),
		content: z.string(),
		durationMs: z.number(),
		// Populated when runtime='team':
		teamName: z.string().optional(),
		memberCount: z.number().optional(),
		// Populated when status='rejected':
		reason: z.string().optional(),
	}),
])
export type ExpertManagerOutput = z.infer<typeof outputSchema>

/** Validation result for an expert. */
export type ValidationError = {
	field: string
	message: string
}

export type ValidationResult = {
	valid: boolean
	errors: ValidationError[]
}
