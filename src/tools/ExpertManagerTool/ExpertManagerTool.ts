/**
 * ExpertManagerTool — WorkBuddy-style expert / expert-team manager.
 *
 * Single tool with discriminated `action` parameter covering:
 *   list, view, create, create_team, edit, delete, validate, invoke
 *
 * Storage: `~/.claude/experts/<slug>/` (user) or `<cwd>/.claude/experts/<slug>/`
 * (project), with priority managed > user > project on read.
 *
 * Invoke: synthesizes a CustomAgentDefinition and runs via AgentTool's
 * `runAgent` primitive so permission semantics / progress reporting / MCP
 * / hooks are identical to a normal Agent sub-agent spawn.
 */
import type {CanUseToolFn} from '../../hooks/useCanUseTool.js'
import {logForDebugging} from '../../utils/debug.js'
import {lazySchema} from '../../utils/lazySchema.js'
import {isAgentSwarmsEnabled} from '../../utils/agentSwarmsEnabled.js'
import type {
	Tool,
	ToolResult,
	ToolUseContext,
	ValidationResult,
} from '../../Tool.js'
import {buildTool, type ToolDef} from '../../Tool.js'
import {EXPERT_MANAGER_TOOL_NAME, EXPERT_SLUG_REGEX} from './constants.js'
import {getPrompt} from './prompt.js'
import {
	type Expert,
	inputSchema,
	outputSchema,
	type ExpertManagerInput,
	type ExpertManagerOutput,
	type TeamMember,
} from './types.js'
import {
	clearExpertsCache,
	deleteExpert as storageDeleteExpert,
	expertExists,
	listExperts,
	readExpert,
	writeExpert,
} from './expertStorage.js'
import {validateExpertObject} from './expertValidator.js'
import {runExpert, runExpertTeam, runExpertTeamReal, cleanupTeamIfPresent} from './expertRunner.js'
import {
	renderToolUseErrorMessage,
	renderToolUseMessage,
	renderToolResultMessage,
} from './UI.js'

type InputSchema = typeof inputSchema
type OutputSchema = typeof outputSchema

const expertActionSet = new Set([
	'list',
	'view',
	'create',
	'create_team',
	'edit',
	'delete',
	'validate',
	'invoke',
] as const)

function assertValidSlug(slug: string): ValidationResult | null {
	if (!EXPERT_SLUG_REGEX.test(slug)) {
		return {
			result: false,
			message: `Invalid expert slug "${slug}". Must match ${EXPERT_SLUG_REGEX.toString()}.`,
			errorCode: 1,
		}
	}
	return null
}

function getScope(input: ExpertManagerInput): 'user' | 'project' | 'all' | undefined {
	return (input as {scope?: 'user' | 'project' | 'all'}).scope
}

export const ExpertManagerTool: Tool<
	InputSchema,
	OutputSchema,
	never
> = buildTool({
	name: EXPERT_MANAGER_TOOL_NAME,
	searchHint: 'manage and invoke custom AI experts / expert teams',
	maxResultSizeChars: 100_000,
	shouldDefer: false,
	strict: false, // discriminatedUnion + .optional() for fields doesn't strictly type-check

	userFacingName() {
		return 'Expert Manager'
	},
	userFacingNameBackgroundColor() {
		return 'magenta'
	},

	get inputSchema() {
		return inputSchema
	},
	get outputSchema() {
		return outputSchema
	},

	async description({action}) {
		switch (action) {
			case 'list':
				return 'List custom AI experts / expert teams.'
			case 'view':
				return 'View an expert definition.'
			case 'create':
				return 'Create a new agent-type expert.'
			case 'create_team':
				return 'Create a new expert team.'
			case 'edit':
				return 'Edit an existing expert.'
			case 'delete':
				return 'Delete an expert (irreversible).'
			case 'validate':
				return 'Validate an expert definition.'
			case 'invoke':
				return 'Activate an expert on a task.'
		}
	},

	async prompt() {
		return getPrompt()
	},

	isConcurrencySafe(input) {
		if (!expertActionSet.has(input.action as never)) return false
		const action = input.action
		return action === 'list' || action === 'view' || action === 'validate' || action === 'invoke'
	},
	isReadOnly(input) {
		const action = input.action
		return action === 'list' || action === 'view' || action === 'validate'
	},
	isDestructive(input) {
		return input.action === 'delete'
	},

	toAutoClassifierInput(input) {
		return `${input.action} ${(input as {name?: string}).name ?? ''}`.trim()
	},

	async validateInput(input): Promise<ValidationResult> {
		// Action-specific sanity checks not covered by the schema.
		if (input.action === 'view' || input.action === 'delete' || input.action === 'validate' || input.action === 'edit' || input.action === 'invoke') {
			const invalid = assertValidSlug(input.name)
			if (invalid) return invalid
		}
		if (input.action === 'create' || input.action === 'create_team') {
			const invalid = assertValidSlug(input.name)
			if (invalid) return invalid
		}

		if (input.action === 'create') {
			const exists = await expertExists(input.name, getScope(input))
			if (exists) {
				return {
					result: false,
					message: `Expert "${input.name}" already exists. Use edit instead.`,
					errorCode: 2,
				}
			}
		}

		if (input.action === 'create_team') {
			// Each member agent must exist.
			const leaderExists = await expertExists(input.leader_agent, getScope(input))
			if (!leaderExists) {
				return {
					result: false,
					message: `Team leader "${input.leader_agent}" does not exist.`,
					errorCode: 3,
				}
			}
			for (const m of input.member_agents) {
				const ok = await expertExists(m, getScope(input))
				if (!ok) {
					return {
						result: false,
						message: `Team member "${m}" does not exist.`,
						errorCode: 4,
					}
				}
			}
		}

		return {result: true}
	},

	async checkPermissions(input, context): Promise<import('../../utils/permissions/PermissionResult.js').PermissionResult> {
		const action = input.action
		// Read-only operations auto-allow (matches SkillTool/BashTool conventions).
		if (action === 'list' || action === 'view' || action === 'validate' || action === 'invoke') {
			return {
				behavior: 'allow',
				updatedInput: input,
			}
		}

		// For destructive mutations, request user permission via the standard
		// Write permission path. checkWritePermissionForTool requires getPath();
		// we don't expose one because experts live under fixed roots, so we
		// emit a clear ask and let the user grant explicitly.
		return {
			behavior: 'ask',
			message: `Claude wants to ${action} expert "${(input as {name?: string}).name ?? ''}".`,
			decisionReason: undefined,
			updatedInput: input,
		}
	},

	renderToolUseMessage,
	renderToolUseErrorMessage,
	renderToolResultMessage,

	mapToolResultToToolResultBlockParam(out, toolUseID) {
		const text = JSON.stringify(out)
		return {
			type: 'tool_result' as const,
			tool_use_id: toolUseID,
			content: [
				{
					type: 'text' as const,
					text,
				},
			],
		}
	},

	async call(
		input: ExpertManagerInput,
		context: ToolUseContext,
		canUseTool: CanUseToolFn,
		_parentMessage,
		_onProgress,
	): Promise<ToolResult<ExpertManagerOutput>> {
		const scope = getScope(input)

		switch (input.action) {
			case 'list': {
				const type = (input as {type?: 'agent' | 'team' | 'all'}).type
				const experts = await listExperts(scope, type)
				return {
					data: {
						action: 'list',
						scope: scope ?? 'all',
						experts: experts.map(e => ({
							name: e.name,
							expertType: e.expertType,
							displayName: e.displayName,
							profession: e.profession,
							description: e.description,
							tags: e.tags,
							categoryId: e.categoryId,
							scope: e.source,
							path: e.path,
						})),
					},
				}
			}

			case 'view': {
				const expert = await readExpert(input.name, scope)
				if (!expert) {
					throw new Error(`Expert "${input.name}" not found.`)
				}
				return {
					data: {
						action: 'view',
						expert: {
							meta: {
								name: expert.name,
								expertType: expert.expertType,
								agentName: expert.agentName,
								displayName: expert.displayName,
								profession: expert.profession,
								description: expert.description,
								categoryId: expert.categoryId,
								tags: expert.tags,
								quickPrompts: expert.quickPrompts,
								defaultInitPrompt: expert.defaultInitPrompt,
								...(expert.members ? {members: expert.members} : {}),
							},
							prompt: expert.prompt,
							...(expert.model ? {model: expert.model} : {}),
							scope: expert.source,
							path: expert.path,
						},
					},
				}
			}

			case 'create': {
				const defaultInitPrompt = input.defaultInitPrompt ?? input.quickPrompts[0] ?? ''
				const expert: Expert = {
					name: input.name,
					expertType: 'agent',
					agentName: input.name,
					displayName: input.displayName,
					profession: input.profession,
					description: input.description,
					categoryId: input.categoryId,
					tags: input.tags,
					quickPrompts: input.quickPrompts,
					defaultInitPrompt,
					prompt: input.prompt,
					promptFrontmatter: {},
					...(input.model ? {model: input.model} : {}),
					// These get overwritten by writeExpert, but TS requires them.
					source: 'user',
					path: '',
				}
				// Validate before write to surface user-facing errors.
				const validation = validateExpertObject(expert)
				if (!validation.valid) {
					throw new Error(
						`Expert validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join('; ')}`,
					)
				}
				const writeScope = scope === 'project' ? 'project' : 'user'
				const {path} = await writeExpert(expert, writeScope)
				logForDebugging(`ExpertManager created expert ${input.name} at ${path}`)
				return {
					data: {
						action: 'create',
						created: {
							name: input.name,
							expertType: 'agent',
							scope: writeScope,
							path,
						},
					},
				}
			}

			case 'create_team': {
				const defaultInitPrompt = input.quickPrompts[0] ?? ''
				const members: TeamMember[] = [
					{agentName: input.leader_agent, role: 'leader'},
					...input.member_agents.map(m => ({agentName: m})),
				]
				const leader = await readExpert(input.leader_agent, scope)
				const prompt = leader?.prompt ?? 'You are the team lead.'
				const expert: Expert = {
					name: input.name,
					expertType: 'team',
					agentName: input.name,
					displayName: input.displayName,
					profession: input.profession,
					description: input.description,
					categoryId: input.categoryId,
					tags: input.tags,
					quickPrompts: input.quickPrompts,
					defaultInitPrompt,
					prompt,
					promptFrontmatter: {},
					members,
					source: 'user',
					path: '',
				}
				const validation = validateExpertObject(expert)
				if (!validation.valid) {
					throw new Error(
						`Team validation failed: ${validation.errors.map(e => `${e.field}: ${e.message}`).join('; ')}`,
					)
				}
				const writeScope = scope === 'project' ? 'project' : 'user'
				const {path} = await writeExpert(expert, writeScope)
				logForDebugging(`ExpertManager created team ${input.name} at ${path}`)
				return {
					data: {
						action: 'create_team',
						created: {
							name: input.name,
							expertType: 'team',
							scope: writeScope,
							path,
							members,
						},
					},
				}
			}

			case 'edit': {
				const existing = await readExpert(input.name, scope)
				if (!existing) {
					throw new Error(`Expert "${input.name}" not found.`)
				}
				const changedFields: string[] = []

				if (input.displayName !== undefined) {
					existing.displayName = input.displayName
					changedFields.push('displayName')
				}
				if (input.profession !== undefined) {
					existing.profession = input.profession
					changedFields.push('profession')
				}
				if (input.description !== undefined) {
					existing.description = input.description
					changedFields.push('description')
				}
				if (input.categoryId !== undefined) {
					existing.categoryId = input.categoryId
					changedFields.push('categoryId')
				}
				if (input.tags !== undefined) {
					existing.tags = input.tags
					changedFields.push('tags')
				}
				if (input.quickPrompts !== undefined) {
					existing.quickPrompts = input.quickPrompts
					changedFields.push('quickPrompts')
				}
				if (input.prompt !== undefined) {
					existing.prompt = input.prompt
					changedFields.push('prompt')
				}
				if (input.defaultInitPrompt !== undefined) {
					existing.defaultInitPrompt = input.defaultInitPrompt
					changedFields.push('defaultInitPrompt')
				}
				if (input.members !== undefined) {
					existing.members = input.members
					changedFields.push('members')
				}

				const validation = validateExpertObject(existing)
				if (!validation.valid) {
					throw new Error(
						`Edit would produce an invalid expert: ${validation.errors.map(e => `${e.field}: ${e.message}`).join('; ')}`,
					)
				}
				const writeScope = existing.source === 'managed'
					? 'user' // managed experts are read-only; fall back to user copy
					: (existing.source as 'user' | 'project')
				const {path} = await writeExpert(existing, writeScope)
				// In case the existing was 'managed' but we wrote to user, clear
				// the cache so reads pick the new copy.
				if (existing.source === 'managed') clearExpertsCache()
				return {
					data: {
						action: 'edit',
						updated: {
							name: existing.name,
							scope: existing.source === 'managed' ? 'user' : existing.source,
							path,
							changedFields,
						},
					},
				}
			}

			case 'delete': {
				const result = await storageDeleteExpert(input.name, scope)
				if (!result) {
					throw new Error(`Expert "${input.name}" not found.`)
				}
				return {
					data: {
						action: 'delete',
						deleted_name: input.name,
						scope: result.root,
						path: result.path,
					},
				}
			}

			case 'validate': {
				const expert = await readExpert(input.name, scope)
				if (!expert) {
					return {
						data: {
							action: 'validate',
							name: input.name,
							scope: 'user',
							valid: false,
							errors: [{field: 'name', message: `expert "${input.name}" not found`}],
						},
					}
				}
				const result = validateExpertObject(expert)
				return {
					data: {
						action: 'validate',
						name: expert.name,
						scope: expert.source,
						valid: result.valid,
						errors: result.errors,
					},
				}
			}

			case 'invoke': {
				const expert = await readExpert(input.name, scope)
				if (!expert) {
					throw new Error(`Expert "${input.name}" not found.`)
				}
				const modelOverride = (input as {model?: string}).model
				const runtime = (input as {runtime?: 'auto' | 'single' | 'team'})
					.runtime ?? 'auto'
				const resolvedRuntime: 'single' | 'team' =
					runtime === 'auto'
						? expert.expertType === 'team'
							? 'team'
							: 'single'
						: runtime

				// Fail fast when team runtime is requested but swarms are off.
				if (resolvedRuntime === 'team' && !isAgentSwarmsEnabled()) {
					return {
						data: {
							action: 'invoke',
							status: 'rejected',
							expertName: expert.name,
							expertType: expert.expertType,
							agentId: '',
							content: '',
							durationMs: 0,
							reason:
								'Team runtime requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 or --agent-teams (USER_TYPE=ant always on). ' +
								'Set runtime="single" to fall back to the in-process runAgent path.',
						},
					}
				}

				if (resolvedRuntime === 'single') {
					if (expert.expertType === 'team') {
						const teamResult = await runExpertTeam(
							expert,
							input.prompt,
							scope,
							context,
							canUseTool,
							modelOverride as never,
						)
						return {data: teamResult}
					}
					const singleResult = await runExpert(
						expert,
						input.prompt,
						scope,
						context,
						canUseTool,
						modelOverride as never,
					)
					return {data: singleResult}
				}

				// resolvedRuntime === 'team' — drive a real team via
				// TeamCreate + per-member Agent spawn. Members become real
				// teammates with SendMessage auto-injected. The leader (the
				// current process) is told via the returned tool result how
				// to coordinate, then uses SendMessage in subsequent turns.
				const persistTeam =
					(input as {persistTeam?: boolean}).persistTeam ?? false
				const teamTimeoutMs =
					(input as {teamTimeoutMs?: number}).teamTimeoutMs ?? 600_000
				try {
					const teamResult = await runExpertTeamReal(
						expert,
						input.prompt,
						scope,
						context,
						canUseTool,
						{persistTeam, teamTimeoutMs},
					)
					return {data: teamResult}
				} catch (err) {
					// Best-effort TeamDelete on any failure to avoid leaking
					// team state. Swallow the cleanup error and rethrow the
					// original so the user sees the real cause.
					await cleanupTeamIfPresent(context, canUseTool)
					throw err
				}
			}
		}
	},
} satisfies ToolDef<InputSchema, OutputSchema, never>)

// Re-export for tests / external consumers.
export {inputSchema, outputSchema}
