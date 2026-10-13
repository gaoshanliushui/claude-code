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
	type I18nString,
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
import {
	buildLeadSOPBody,
	buildMemberBody,
	type LeadSOPBodyInput,
	type LeadSOPMember,
	type LeadSOPWorkflow,
	resolveFlowname,
} from './sopTemplate.js'
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
			// `leader_agent` is now optional. If provided, it must exist.
			if (input.leader_agent) {
				const leaderExists = await expertExists(input.leader_agent, getScope(input))
				if (!leaderExists) {
					return {
						result: false,
						message: `Team leader "${input.leader_agent}" does not exist.`,
						errorCode: 3,
					}
				}
			}
			// Each member must either be an existing expert (string form) or
			// reference one via agentName (object form). The `id` form (no
			// agentName) is valid — it just creates a new internal member.
			for (const m of input.member_agents) {
				if (typeof m === 'string') {
					const ok = await expertExists(m, getScope(input))
					if (!ok) {
						return {
							result: false,
							message: `Team member "${m}" does not exist.`,
							errorCode: 4,
						}
					}
				} else if (m.agentName) {
					const ok = await expertExists(m.agentName, getScope(input))
					if (!ok) {
						return {
							result: false,
							message: `Team member agentName "${m.agentName}" does not exist.`,
							errorCode: 4,
						}
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
							...(e.version ? {version: e.version} : {}),
							...(e.avatar ? {avatar: e.avatar} : {}),
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
								// WorkBuddy optional fields
								...(expert.version ? {version: expert.version} : {}),
								...(expert.author ? {author: expert.author} : {}),
								...(expert.displayDescription
									? {displayDescription: expert.displayDescription}
									: {}),
								...(expert.avatar ? {avatar: expert.avatar} : {}),
								...(expert.plugin ? {plugin: expert.plugin} : {}),
								...(expert.teamInfo ? {teamInfo: expert.teamInfo} : {}),
								...(expert.agents ? {agents: expert.agents} : {}),
							},
							prompt: expert.prompt,
							...(expert.model ? {model: expert.model} : {}),
							scope: expert.source,
							path: expert.path,
							// WorkBuddy file metadata
							...(expert.leadFile ? {leadFile: expert.leadFile} : {}),
							...(expert.agentFiles
								? {
										agentFiles: Array.from(expert.agentFiles.entries()).map(
											([id, path]) => ({id, path}),
										),
									}
								: {}),
							...(expert.avatarPath ? {avatarPath: expert.avatarPath} : {}),
							...(expert.readmePath ? {readmePath: expert.readmePath} : {}),
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
					// WorkBuddy optional fields
					...(input.version ? {version: input.version} : {}),
					...(input.author ? {author: input.author} : {}),
					...(input.displayDescription
						? {displayDescription: input.displayDescription}
						: {}),
					...(input.avatar ? {avatar: input.avatar} : {}),
					...(input.plugin ? {plugin: input.plugin} : {}),
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
				// WorkBuddy naming convention: lead's slug is `<team-name>-team-lead`.
				// The lead's .md file in agents/ is `<leadId>.md`.
				const leadId = `${input.name}-team-lead`

				// ---- Resolve lead metadata ----
				// `leader_agent` is optional. If provided, seed defaults from it;
				// `leadDisplayName` / `leadProfession` / `leadDescription` /
				// `leadFlowname` / `leadMaxTurns` override those.
				const leadExpert = input.leader_agent
					? await readExpert(input.leader_agent, scope)
					: null
				const leadFlowname =
					input.leadFlowname ??
					resolveFlowname(input.leadDisplayName) ??
					resolveFlowname(leadExpert?.displayName) ??
					'主理人'
				const leadDisplayName: I18nString =
					input.leadDisplayName ??
					leadExpert?.displayName ??
					({zh: leadFlowname, en: 'Team Lead'} as I18nString)
				const leadProfession: I18nString =
					input.leadProfession ??
					leadExpert?.profession ??
					({zh: '主理人', en: 'Team Lead'} as I18nString)
				const leadDescription =
					input.leadDescription ??
					(typeof leadExpert?.description === 'string'
						? leadExpert.description
						: (leadExpert?.description as {zh?: string; en?: string} | undefined)?.zh ??
							(leadExpert?.description as {zh?: string; en?: string} | undefined)?.en ??
							`Lead orchestrator for the ${input.name} expert team. Coordinates team members, signs off on final delivery.`)
				const leadMaxTurns = input.leadMaxTurns ?? 200

				// ---- Resolve each member ----
				// Two input forms:
				//   - string: existing agent-type expert slug — pull metadata from it
				//   - object: rich inline spec — use provided fields, fall back to agentName
				type ResolvedMember = {
					id: string
					agentName?: string
					displayName?: I18nString
					profession?: I18nString
					description?: string
					maxTurns: number
					avatar?: string
					role: 'member'
					flowname: string
					roleTitle: string
					body: string // just the body (NOT including frontmatter)
				}
				const resolvedMembers: ResolvedMember[] = []
				for (const m of input.member_agents) {
					if (typeof m === 'string') {
						const expert = await readExpert(m, scope)
						const flowname = resolveFlowname(expert?.displayName) || m
						const roleTitle =
							(typeof expert?.profession === 'string'
								? expert.profession
								: (expert?.profession as {zh?: string; en?: string} | undefined)?.zh ??
									(expert?.profession as {zh?: string; en?: string} | undefined)?.en) ||
							m
						const description =
							(typeof expert?.description === 'string'
								? expert.description
								: (expert?.description as {zh?: string; en?: string} | undefined)?.zh ??
									(expert?.description as {zh?: string; en?: string} | undefined)?.en) ||
							`Member of the ${input.name} team. References ${m} for the full role definition.`
						resolvedMembers.push({
							id: m,
							agentName: m,
							displayName: expert?.displayName,
							profession: expert?.profession,
							description,
							maxTurns: 50,
							role: 'member',
							flowname,
							roleTitle,
							body: buildMemberBody({
								roleTitle,
								flowname,
								identity: [
									`${flowname}是本团队的${roleTitle}。`,
									`本成员引用已存在的 agent-type 专家「${m}」的 prompt 作为完整工作流定义。`,
								],
								capabilities: [
									'对应领域的专业能力(由被引用的 expert 提供)',
									'独立完成主理人派发的子任务',
									'按规范产出并通过 SendMessage 回传给主理人',
								],
								workflow: [
									'接收主理人派单: 输入 / 产出 / 验收标准',
									'按被引用 expert 的 prompt 执行子任务',
									'通过 SendMessage 将完整产出回传给主理人',
								],
								outputStandards: [
									'产出格式遵循被引用 expert 的规范',
									'关键决策点附理由说明',
									'风险点显式标注',
								],
							}),
						})
					} else {
						const expert = m.agentName ? await readExpert(m.agentName, scope) : null
						const flowname =
							resolveFlowname(m.displayName) ??
							resolveFlowname(expert?.displayName) ??
							m.id
						const roleTitle =
							(typeof m.profession === 'string'
								? m.profession
								: m.profession?.zh ?? m.profession?.en) ??
							(typeof expert?.profession === 'string'
								? expert.profession
								: expert?.profession?.zh ?? expert?.profession?.en) ??
							m.id
						const description =
							m.description ??
							(typeof expert?.description === 'string'
								? expert.description
								: expert?.description?.zh ?? expert?.description?.en) ??
							`${roleTitle} of the ${input.name} team.`
						const maxTurns = m.maxTurns ?? 50
						const displayName: I18nString =
							m.displayName ?? expert?.displayName ?? {zh: flowname, en: flowname}
						const profession: I18nString =
							m.profession ?? expert?.profession ?? {zh: roleTitle, en: roleTitle}
						resolvedMembers.push({
							id: m.id,
							agentName: m.agentName,
							displayName,
							profession,
							description,
							maxTurns,
							avatar: m.avatar,
							role: 'member',
							flowname,
							roleTitle,
							body: buildMemberBody({
								roleTitle,
								flowname,
								identity: [
									`${flowname}是本团队的${roleTitle},负责对应领域的专业产出。`,
									m.agentName
										? `本成员参考 agent-type 专家「${m.agentName}」的 prompt 作为完整工作流定义。`
										: '本成员是团队内部角色,完整 prompt 待主理人后续通过 `edit` 完善。',
								],
								capabilities: [
									`${roleTitle}领域的专业能力(详见 prompt 内容)`,
									'独立完成主理人派发的子任务',
									'按规范产出并通过 SendMessage 回传给主理人',
								],
								workflow: [
									'接收主理人派单: 输入 / 产出 / 验收标准',
									'独立完成子任务,按工作流程执行',
									'通过 SendMessage 将完整产出回传给主理人',
								],
								outputStandards: [
									'产出格式遵循团队统一规范',
									'关键决策点附理由说明',
									'风险点显式标注',
								],
							}),
						})
					}
				}

				// ---- Build the lead .md body ----
				const teamDisplayZh = resolveFlowname(input.displayName) || input.name
				// memberTable rows: lead first, then members
				const leadMemberRow: LeadSOPMember = {
					id: leadId,
					flowname: leadFlowname,
					duty: '需求拆解 + 调度 + 终审签发',
				}
				const memberRows: LeadSOPMember[] = resolvedMembers.map(m => ({
					id: m.id,
					flowname: m.flowname,
					duty: m.roleTitle,
				}))
				const allMemberRows: LeadSOPMember[] = [leadMemberRow, ...memberRows]

				// If the model provided sopPhases, normalize them to the
				// LeadSOPPhase type. Default otherwise.
				const sopPhases = input.sopPhases as
					| LeadSOPBodyInput['sopPhases']
					| undefined

				// If the model provided workflows, normalize. Default otherwise.
				const workflows: LeadSOPWorkflow[] | undefined = input.workflows
					? input.workflows.map(w => ({
							id: w.id,
							name: w.name ?? w.id,
							trigger: w.trigger,
							scope: w.scope,
						}))
					: undefined

				// Lead .md body (just the body, not frontmatter)
				const leadBody =
					input.leadPrompt ??
					buildLeadSOPBody({
						teamDisplay: teamDisplayZh,
						leadFlowname,
						members: allMemberRows,
						sopPhases,
						routingTable: input.routingTable,
						workflows,
					})

				// ---- Build the rich members[] array ----
				const leadMemberEntry: TeamMember = {
					id: leadId,
					agentName: input.leader_agent ?? leadId,
					displayName: leadDisplayName,
					profession: leadProfession,
					role: 'lead',
				}
				const memberEntries: TeamMember[] = resolvedMembers.map(m => ({
					id: m.id,
					agentName: m.agentName,
					displayName: m.displayName,
					profession: m.profession,
					avatar: m.avatar,
					role: 'member' as const,
				}))
				const members: TeamMember[] = [leadMemberEntry, ...memberEntries]

				// ---- Pre-populate teamMemberMeta so writeTeamExpert writes
				// full WorkBuddy-format .md files (with frontmatter + body). ----
				const teamMemberMeta = new Map<
					string,
					{
						id: string
						frontmatter: Record<string, unknown>
						body: string
						displayName?: I18nString
						profession?: I18nString
						description?: string
						maxTurns?: number
					}
				>()
				teamMemberMeta.set(leadId, {
					id: leadId,
					frontmatter: {maxTurns: leadMaxTurns},
					body: leadBody,
					displayName: leadDisplayName,
					profession: leadProfession,
					description: leadDescription,
					maxTurns: leadMaxTurns,
				})
				for (const m of resolvedMembers) {
					teamMemberMeta.set(m.id, {
						id: m.id,
						frontmatter: {maxTurns: m.maxTurns},
						body: m.body,
						displayName: m.displayName,
						profession: m.profession,
						description: m.description,
						maxTurns: m.maxTurns,
					})
				}

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
					// `expert.prompt` is the lead's body. The runtime uses it as
					// the lead's "Your role" guidance. writeTeamExpert writes it
					// as the lead .md body (with frontmatter added by
					// buildAgentMarkdown from teamMemberMeta).
					prompt: leadBody,
					// maxTurns flows through teamMemberMeta (writeTeamExpert
					// pulls it as an explicit arg to buildAgentMarkdown), so
					// leave promptFrontmatter empty to avoid duplicates.
					promptFrontmatter: {},
					members,
					teamMemberMeta,
					// WorkBuddy fields
					teamInfo: {
						leadAgent: leadId,
						memberAgents: resolvedMembers.map(m => m.id),
					},
					agents: [
						`./agents/${leadId}.md`,
						...resolvedMembers.map(m => `./agents/${m.id}.md`),
					],
					...(input.version ? {version: input.version} : {}),
					...(input.author ? {author: input.author} : {}),
					...(input.displayDescription
						? {displayDescription: input.displayDescription}
						: {}),
					...(input.avatar ? {avatar: input.avatar} : {}),
					...(input.plugin ? {plugin: input.plugin} : {}),
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
				if (input.displayDescription !== undefined) {
					existing.displayDescription = input.displayDescription
					changedFields.push('displayDescription')
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
				// WorkBuddy fields
				if (input.version !== undefined) {
					existing.version = input.version
					changedFields.push('version')
				}
				if (input.author !== undefined) {
					existing.author = input.author
					changedFields.push('author')
				}
				if (input.avatar !== undefined) {
					existing.avatar = input.avatar
					changedFields.push('avatar')
				}
				if (input.teamInfo !== undefined) {
					existing.teamInfo = input.teamInfo
					changedFields.push('teamInfo')
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
