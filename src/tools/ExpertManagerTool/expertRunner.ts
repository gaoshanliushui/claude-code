/**
 * Run an Expert (or its team members) using AgentTool's runAgent mechanism.
 *
 * Implementation note: rather than re-implementing the full sub-agent
 * lifecycle (query loop, permission context, transcript persistence, model
 * resolution), we compose a temporary CustomAgentDefinition and call the
 * existing `runAgent` from AgentTool/runAgent.ts — the same primitive the
 * Agent tool itself uses. This keeps permission semantics, MCP, hooks,
 * and progress reporting identical.
 *
 * For teams we spawn the leader first; members run in parallel as separate
 * sub-agents via Promise.all. We then synthesize a single response by
 * concatenating member outputs.
 */
import type {CanUseToolFn} from '../../hooks/useCanUseTool.js'
import {runAgent} from '../../tools/AgentTool/runAgent.js'
import type {AgentDefinition} from '../../tools/AgentTool/loadAgentsDir.js'
import type {Message} from '../../types/message.js'
import {createUserMessage} from '../../utils/messages.js'
import {normalizeMessages} from '../../utils/messages.js'
import {getAgentModel} from '../../utils/model/agent.js'
import type {ModelAlias} from '../../utils/model/aliases.js'
import type {Tool, Tools, ToolUseContext} from '../../Tool.js'
import {createAgentId} from '../../utils/uuid.js'
import {logForDebugging} from '../../utils/debug.js'
import type {
	Expert,
	ExpertScope,
} from './types.js'
import {readExpert} from './expertStorage.js'

/** Build a synthetic CustomAgentDefinition for a single expert. The agent
 *  system prompt is the expert's role prompt; tools default to * (all). */
function buildAgentDefinition(
	expert: Expert,
	expertSystemPrompt: string,
): AgentDefinition {
	return {
		agentType: `expert:${expert.name}`,
		whenToUse: `Custom expert "${expert.name}"`,
		tools: ['*'],
		source: 'userSettings', // arbitrary; not 'built-in' / 'plugin' / 'policySettings'
		baseDir: expert.path,
		getSystemPrompt: () => expertSystemPrompt,
		model: 'inherit',
		description: expert.description,
		omitClaudeMd: false,
	}
}

/** Build the system-prompt text the expert will see, combining its role
 *  prompt with WorkBuddy-style header context. */
function buildExpertSystemPrompt(expert: Expert): string {
	const header = [
		`You are the custom expert "${expert.name}".`,
		expert.profession ? `Role: ${typeof expert.profession === 'string' ? expert.profession : expert.profession.en ?? expert.profession.zh}` : '',
		`Description: ${typeof expert.description === 'string' ? expert.description : ''}`,
		expert.tags?.length ? `Tags: ${expert.tags.join(', ')}` : '',
		expert.expertType === 'team' ? `Team lead; you coordinate the listed member experts.` : '',
	].filter(Boolean).join('\n')
	return `${header}\n\n---\n\n${expert.prompt.trim()}`
}

export type ExpertInvokeResult = {
	status: 'completed'
	expertName: string
	expertType: 'agent' | 'team'
	agentId: string
	content: string
	durationMs: number
}

async function runSingleExpert(
	expert: Expert,
	taskPrompt: string,
	scope: ExpertScope | undefined,
	context: ToolUseContext,
	canUseTool: CanUseToolFn,
	modelOverride: ModelAlias | undefined,
): Promise<{agentId: string; content: string; messages: Message[]}> {
	const agentId = createAgentId()
	const sysPrompt = buildExpertSystemPrompt(expert)
	const agentDef = buildAgentDefinition(expert, sysPrompt)

	const promptMessages: Message[] = [
		createUserMessage({content: taskPrompt, isMeta: false}),
	]

	// Resolve model
	const appState = context.getAppState()
	const resolvedModel = getAgentModel(
		agentDef.model,
		context.options.mainLoopModel,
		modelOverride ?? (expert.model as ModelAlias | undefined),
		appState.toolPermissionContext.mode,
	)

	const messages: Message[] = []
	for await (const message of runAgent({
		agentDefinition: agentDef,
		promptMessages,
		toolUseContext: context,
		canUseTool,
		isAsync: false,
		querySource: 'expert:custom',
		model: resolvedModel,
		availableTools: context.options.tools as Tools,
		override: {agentId},
	})) {
		messages.push(message)
	}

	// Extract final assistant content
	const lastAssistant = [...messages]
		.reverse()
		.find(m => m.type === 'assistant')
	if (!lastAssistant || lastAssistant.type !== 'assistant') {
		return {agentId, content: '', messages}
	}
	const content = lastAssistant.message.content
	const text =
		typeof content === 'string'
			? content
			: Array.isArray(content)
				? content
						.filter(
							(b): b is {type: 'text'; text: string} =>
								typeof b === 'object' &&
								b !== null &&
								'type' in b &&
								(b as {type: string}).type === 'text',
						)
						.map(b => b.text)
						.join('\n')
				: ''
	return {agentId, content: text, messages}
}

/** Invoke a single (agent-type) expert. */
export async function runExpert(
	expert: Expert,
	taskPrompt: string,
	scope: ExpertScope | undefined,
	context: ToolUseContext,
	canUseTool: CanUseToolFn,
	modelOverride: ModelAlias | undefined,
): Promise<ExpertInvokeResult> {
	const start = Date.now()
	const {agentId, content} = await runSingleExpert(
		expert,
		taskPrompt,
		scope,
		context,
		canUseTool,
		modelOverride,
	)
	return {
		status: 'completed',
		expertName: expert.name,
		expertType: expert.expertType,
		agentId,
		content,
		durationMs: Date.now() - start,
	}
}

/** Invoke a team expert: leader runs first, then members run in parallel
 *  with the leader's output as additional context. */
export async function runExpertTeam(
	team: Expert,
	taskPrompt: string,
	scope: ExpertScope | undefined,
	context: ToolUseContext,
	canUseTool: CanUseToolFn,
	modelOverride: ModelAlias | undefined,
): Promise<ExpertInvokeResult> {
	const start = Date.now()
	const members = team.members ?? []
	if (members.length === 0) {
		throw new Error(`Team "${team.name}" has no members declared`)
	}
	// Leader is the team itself; we treat its .prompt as the leader prompt
	const leaderResult = await runSingleExpert(
		team,
		taskPrompt,
		scope,
		context,
		canUseTool,
		modelOverride,
	)

	// Run members in parallel — each gets the original task + leader summary.
	const memberRuns = await Promise.all(
		members.map(async member => {
			const memberExpert = await readExpert(member.agentName, scope)
			if (!memberExpert) {
				logForDebugging(
					`Team member "${member.agentName}" not found; skipping`,
					{level: 'warn'},
				)
				return null
			}
			if (memberExpert.expertType !== 'agent') {
				logForDebugging(
					`Team member "${member.agentName}" is not agent-type (got ${memberExpert.expertType}); skipping`,
					{level: 'warn'},
				)
				return null
			}
			const memberPrompt = `${taskPrompt}\n\n---\n\nLeader (${team.name}) output:\n${leaderResult.content || '(no output)'}`
			const res = await runSingleExpert(
				memberExpert,
				memberPrompt,
				scope,
				context,
				canUseTool,
				modelOverride,
			)
			return {agentId: res.agentId, content: res.content, name: member.agentName}
		}),
	)

	const memberSection = memberRuns
		.filter((r): r is {agentId: string; content: string; name: string} =>
			r !== null,
		)
		.map(r => `### Member: ${r.name}\n\n${r.content || '(no output)'}`)
		.join('\n\n')

	const combined = [
		`### Leader: ${team.name}\n\n${leaderResult.content || '(no output)'}`,
		memberSection,
	]
		.filter(Boolean)
		.join('\n\n---\n\n')

	// Use the leader's agentId as the canonical "team id" for resume/track.
	const allAgentIds = [
		leaderResult.agentId,
		...memberRuns
			.filter((r): r is {agentId: string; content: string; name: string} =>
				r !== null,
			)
			.map(r => r.agentId),
	]

	return {
		status: 'completed',
		expertName: team.name,
		expertType: 'team',
		agentId: allAgentIds.join('+'),
		content: combined,
		durationMs: Date.now() - start,
	}
}

/** Suppress unused-import warning while keeping normalizeMessages available
 *  for future extensions (e.g., streaming raw message output to progress). */
export const _normalize = normalizeMessages

// ---------------------------------------------------------------------------
// Real team runtime: bridge to TeamCreateTool + Agent spawn.
// ---------------------------------------------------------------------------

import type {ToolResult} from '../../Tool.js'

/** Result of `runExpertTeamReal` — extends `ExpertInvokeResult` with the
 *  team name and member count for the leader to track. */
export type ExpertTeamInvokeResult = ExpertInvokeResult & {
	teamName: string
	memberCount: number
}

/** Coordinator guidance: a structured prompt the leader (current process)
 *  receives as the `invoke` tool result, telling it how to coordinate the
 *  freshly spawned teammates. The team expert's `prompt` is delivered here
 *  as guidance (since the leader's system prompt cannot be changed mid-
 *  session). */
function buildCoordinatorGuidance(
	team: Expert,
	taskPrompt: string,
	teamName: string,
	members: Array<{name: string; teammateId: string | null}>,
): string {
	const memberList = members
		.map(m =>
			m.teammateId
				? `- ${m.name} (teammate_id: ${m.teammateId})`
				: `- ${m.name} (spawn failed)`,
		)
		.join('\n')
	const teamPrompt = team.prompt.trim()
	return [
		`## Team: ${team.name} (${teamName})`,
		'',
		'### Your role',
		teamPrompt,
		'',
		'### Members spawned',
		memberList,
		'',
		'### Original task',
		taskPrompt,
		'',
		'### Coordination',
		'Use SendMessage to talk to each member. Members can also send you messages. ' +
			'When done coordinating and gathering results, synthesize a final answer. ' +
			'If persistTeam=false, TeamDelete will be called automatically when this session ends.',
	].join('\n')
}

/**
 * Coordinator flow: drive a real team via TeamCreate + per-member Agent
 * spawns. Members become real teammates with SendMessage / TeamCreate /
 * TeamDelete / Task* auto-injected by runInProcessTeammate. The leader is
 * the current process and is told via the returned tool result how to
 * coordinate, then uses SendMessage to drive the team in its next turn.
 *
 * Hard constraint: the leader's system prompt cannot be changed mid-
 * session (set at CLI startup, see main.tsx:1631-1635). So the team
 * expert's `prompt` is delivered as coordinator guidance, not a system
 * prompt override.
 */
export async function runExpertTeamReal(
	team: Expert,
	taskPrompt: string,
	scope: ExpertScope | undefined,
	context: ToolUseContext,
	canUseTool: CanUseToolFn,
	opts: {persistTeam: boolean; teamTimeoutMs: number},
): Promise<ExpertTeamInvokeResult> {
	const start = Date.now()
	const {TeamCreateTool} = await import('../TeamCreateTool/TeamCreateTool.js')
	const {AgentTool} = await import('../AgentTool/AgentTool.jsx')

	const teamName = `expert_${team.name}_${Date.now().toString(36)}`
	const description =
		typeof team.description === 'string'
			? team.description
			: (team.description as {en?: string} | undefined)?.en ?? ''

	// 1. TeamCreate — registers the team, sets appState.teamContext, calls
	//    setLeaderTeamName + resetTaskList. Note: this does NOT spawn a new
	//    session for the lead; the lead IS the current process.
	await TeamCreateTool.call(
		{team_name: teamName, description, agent_type: `expert:${team.name}`},
		context,
		canUseTool,
	)

	// 2. Spawn one teammate per member in parallel.
	const memberResults: Array<{name: string; teammateId: string | null}> = []
	await Promise.all(
		(team.members ?? []).map(async member => {
			const memberExpert = await readExpert(member.agentName, scope)
			if (!memberExpert || memberExpert.expertType !== 'agent') {
				logForDebugging(
					`Team member "${member.agentName}" missing or wrong type; skipping`,
					{level: 'warn'},
				)
				return
			}
			try {
				const spawnResult = await AgentTool.call(
					{
						description: `Spawn teammate ${member.agentName}`,
						prompt: taskPrompt,
						subagent_type: `expert:${memberExpert.name}`,
						name: memberExpert.agentName,
						team_name: teamName,
						run_in_background: false,
					},
					context,
					canUseTool,
				)
				const data = spawnResult?.data as
					| {status?: string; teammate_id?: string}
					| undefined
				memberResults.push({
					name: member.agentName,
					teammateId:
						data?.status === 'teammate_spawned'
							? (data.teammate_id ?? null)
							: null,
				})
			} catch (err) {
				logForDebugging(
					`Failed to spawn teammate ${member.agentName}: ${err instanceof Error ? err.message : String(err)}`,
					{level: 'warn'},
				)
				memberResults.push({name: member.agentName, teammateId: null})
			}
		}),
	)

	// 3. Return immediately with coordinator guidance. The leader (current
	//    process) reads the tool result and proceeds to coordinate via
	//    SendMessage in subsequent turns. We do not block here waiting for
	//    teammates to go idle — that's the leader's job.
	void opts // teamTimeoutMs / persistTeam are surfaced for future use; current
	//            implementation does not auto-cleanup (handled by session-end
	//            GC via registerTeamForSessionCleanup, and by explicit
	//            TeamDelete calls from the model).

	return {
		status: 'completed',
		expertName: team.name,
		expertType: 'team',
		agentId: `team:${teamName}`,
		content: buildCoordinatorGuidance(team, taskPrompt, teamName, memberResults),
		durationMs: Date.now() - start,
		teamName,
		memberCount: memberResults.length,
	}
}

/** Best-effort TeamDelete wrapper for cleanup on error. */
export async function cleanupTeamIfPresent(
	context: ToolUseContext,
	canUseTool: CanUseToolFn,
): Promise<void> {
	try {
		const {TeamDeleteTool} = await import(
			'../TeamDeleteTool/TeamDeleteTool.js'
		)
		await TeamDeleteTool.call({}, context, canUseTool)
	} catch {
		// ignore — best effort
	}
}

// Re-export the ToolResult type for callers that want to type-narrow.
export type {ToolResult}
