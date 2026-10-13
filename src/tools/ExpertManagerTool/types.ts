/**
 * Type definitions and Zod schemas for the ExpertManager tool.
 *
 * An "expert" is a directory:
 *   <root>/experts/<slug>/
 *   ├── plugin.json     # identity card (ExpertMeta)
 *   └── agents/<slug>.md  # YAML frontmatter + system prompt body
 *
 * Mirrors WorkBuddy's `plugin.json` schema (expertType, agentName,
 * displayName, profession, description, categoryId, tags, quickPrompts,
 * defaultInitPrompt, members).
 */
import {z} from 'zod/v4'
import {
	EXPERT_CATEGORIES,
	EXPERT_SCOPES,
	EXPERT_SLUG_REGEX,
	EXPERT_TYPES,
} from './constants.js'

/** Localized display name / profession. WorkBuddy uses {zh, en} objects; we
 *  accept either a plain string (use as both) or a {zh, en} object. */
export const displayNameSchema = z.union([
	z.string().min(1),
	z.object({
		zh: z.string().min(1),
		en: z.string().min(1).optional(),
	}),
])
export type DisplayName = z.infer<typeof displayNameSchema>

export const professionSchema = displayNameSchema
export type Profession = DisplayName

/** A single team member reference. Used only for expertType=team experts. */
export const teamMemberSchema = z.object({
	agentName: z
		.string()
		.regex(EXPERT_SLUG_REGEX)
		.describe('Slug of an existing agent-type expert to include as a team member.'),
	role: z
		.string()
		.optional()
		.describe('Optional human-readable role label for this member.'),
})
export type TeamMember = z.infer<typeof teamMemberSchema>

/**
 * The plugin.json shape (metadata only — the role prompt lives in the .md
 * file). All fields except `name`/`expertType`/`agentName` are required by
 * WorkBuddy's validator; we accept the minimum and validate strictly at
 * validate time.
 */
export const expertMetaSchema = z.object({
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
		.describe(
			'Short description of what the expert does. ' +
				'WorkBuddy requires 40-50 characters if it contains CJK characters.',
		),
	categoryId: z
		.enum(EXPERT_CATEGORIES)
		.or(z.string().min(1))
		.describe('Industry category id.'),
	tags: z
		.array(z.string().min(1))
		.length(3)
		.describe('Exactly 3 short tags.'),
	quickPrompts: z
		.array(z.string().min(1))
		.length(3)
		.describe('Exactly 3 recommended questions to start with this expert.'),
	defaultInitPrompt: z
		.string()
		.min(1)
		.describe('Default initialization prompt; should equal quickPrompts[0].'),
	members: z
		.array(teamMemberSchema)
		.optional()
		.describe('For expertType=team only: ordered list of member agent slugs.'),
})
export type ExpertMeta = z.infer<typeof expertMetaSchema>

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
}

export const expertScopeSchema = z.enum(EXPERT_SCOPES).optional()
export const expertTypeFilterSchema = z.enum(EXPERT_TYPES).optional()

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
		categoryId: z
			.enum(EXPERT_CATEGORIES)
			.or(z.string().min(1))
			.describe('Industry category id.'),
		tags: z
			.array(z.string().min(1))
			.length(3)
			.describe('Exactly 3 short tags.'),
		quickPrompts: z
			.array(z.string().min(1))
			.length(3)
			.describe('Exactly 3 recommended questions.'),
		prompt: z.string().min(1).describe(
			'The system-prompt body that defines the expert\'s role and behavior.',
		),
		model: z
			.string()
			.optional()
			.describe('Optional model alias for this expert (e.g. "haiku", "sonnet").'),
		defaultInitPrompt: z
			.string()
			.optional()
			.describe('Optional. Defaults to quickPrompts[0].'),
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
		categoryId: z.enum(EXPERT_CATEGORIES).or(z.string().min(1)),
		tags: z.array(z.string().min(1)).length(3),
		quickPrompts: z.array(z.string().min(1)).length(3),
		leader_agent: z
			.string()
			.regex(EXPERT_SLUG_REGEX)
			.describe('Slug of an existing agent-type expert that leads the team.'),
		member_agents: z
			.array(z.string().regex(EXPERT_SLUG_REGEX))
			.min(1)
			.describe('Slugs of additional agent-type experts in the team.'),
		scope: expertScopeSchema,
	}),
	z.object({
		action: z.literal('edit'),
		name: z.string().regex(EXPERT_SLUG_REGEX).describe('Expert slug to edit.'),
		scope: expertScopeSchema,
		displayName: displayNameSchema.optional(),
		profession: professionSchema.optional(),
		description: z.string().min(1).optional(),
		categoryId: z.enum(EXPERT_CATEGORIES).or(z.string().min(1)).optional(),
		tags: z.array(z.string().min(1)).length(3).optional(),
		quickPrompts: z.array(z.string().min(1)).length(3).optional(),
		prompt: z.string().min(1).optional().describe(
			'Replace the system-prompt body. Replaces the .md file content.',
		),
		defaultInitPrompt: z.string().min(1).optional(),
		members: z.array(teamMemberSchema).optional().describe(
			'Replace the team member list (team experts only).',
		),
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
				tags: z.array(z.string()),
				categoryId: z.string(),
				scope: z.enum(['managed', 'user', 'project']),
				path: z.string(),
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
