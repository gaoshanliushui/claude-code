/**
 * GoalTool — the agent-facing interface for goal-driven automation.
 *
 * Six actions, all routed through a discriminated union on `action`:
 *
 *   create   — define a new goal and activate it (single active goal).
 *   status   — return the current state of an active or named goal.
 *   list     — enumerate all goals on disk.
 *   attach   — re-bind an existing on-disk goal as the active one.
 *   abort    — terminate the active (or named) goal with a reason.
 *   report   — append a free-text progress note (informational; the
 *              evaluator LLM is the actual source of truth for completion).
 *
 * All writes go through `setActiveGoal` / `saveGoal`, which are the only
 * paths that touch persistence. No raw file IO happens in this file.
 */

import {randomUUID} from 'crypto'
import {z} from 'zod/v4'
import {buildTool} from '../../Tool.js'
import {
	DEFAULT_MAX_ITERATIONS,
	DEFAULT_MAX_WALL_MS,
	GOAL_TOOL_NAME,
} from './constants.js'
import {isBudgetExhausted, listGoals, loadGoal, saveGoal} from './storage.js'
import {
	clearActiveGoal,
	getActiveGoal,
	setActiveGoal,
} from './activeGoal.js'
import type {Goal} from './types.js'
import {
	GOAL_TOOL_DESCRIPTION,
	GOAL_TOOL_PROMPT,
} from './prompt.js'

const Input = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('create'),
		objective: z.string().min(1),
		success_criteria: z.array(z.string().min(1)).min(1).max(20),
		max_iterations: z.number().int().positive().max(1000).optional(),
		max_wall_ms: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
		max_cost_usd: z.number().positive().optional(),
	}),
	z.object({
		action: z.literal('status'),
		id: z.string().min(1).optional(),
	}),
	z.object({
		action: z.literal('list'),
	}),
	z.object({
		action: z.literal('attach'),
		id: z.string().min(1),
	}),
	z.object({
		action: z.literal('abort'),
		id: z.string().min(1).optional(),
		reason: z.string().min(1),
	}),
	z.object({
		action: z.literal('report'),
		note: z.string().min(1),
	}),
])

type Input = z.infer<typeof Input>

export const GoalTool = buildTool({
	name: GOAL_TOOL_NAME,
	searchHint: 'goal-driven automation',
	strict: true,
	input: Input,
	isConcurrencySafe: () => false,
	isReadOnly: () => false,
	isDestructive: input => input.action === 'abort',
	async description() {
		return GOAL_TOOL_DESCRIPTION
	},
	async prompt() {
		return GOAL_TOOL_PROMPT
	},
	userFacingName: () => 'goal',
	async checkPermissions(input) {
		return {behavior: 'allow', updatedInput: input}
	},
	async call(args) {
		switch (args.action) {
			case 'create': {
				const now = new Date().toISOString()
				const goal: Goal = {
					id: randomUUID(),
					objective: args.objective,
					successCriteria: args.success_criteria.map((desc, i) => ({
						id: `c${i}`,
						description: desc,
					})),
					budget: {
						maxIterations: args.max_iterations ?? DEFAULT_MAX_ITERATIONS,
						maxWallMs: args.max_wall_ms ?? DEFAULT_MAX_WALL_MS,
						maxCostUsd: args.max_cost_usd,
					},
					status: 'active',
					attempts: [],
					createdAt: now,
					updatedAt: now,
				}
				await setActiveGoal(goal)
				return {
					data: {
						id: goal.id,
						status: goal.status,
						maxIterations: goal.budget.maxIterations,
						criteria: goal.successCriteria.length,
					},
					resultText:
						`Goal ${goal.id} created and now active.\n` +
						`Objective: ${goal.objective}\n` +
						`Criteria: ${goal.successCriteria.length}\n` +
						`Iteration budget: ${goal.budget.maxIterations}\n\n` +
						`The auto-continue hook will run after each turn until criteria are met, ` +
						`the budget is exhausted, or you call goal({action:'abort'}).`,
				}
			}

			case 'status': {
				const id = args.id ?? getActiveGoal()?.id
				if (!id) {
					return {
						data: {active: null},
						resultText: 'No active goal. Create one with goal({action:"create", ...}).',
					}
				}
				const g = await loadGoal(id)
				if (!g) {
					return {
						data: {id, found: false},
						resultText: `Goal ${id} not found on disk.`,
					}
				}
				return {
					data: {
						id: g.id,
						status: g.status,
						objective: g.objective,
						attempts: g.attempts.length,
						lastAttempt: g.attempts[g.attempts.length - 1] ?? null,
						budget: g.budget,
						isBudgetExhausted: isBudgetExhausted(g),
					},
					resultText:
						`Goal ${g.id}: status=${g.status}, attempts=${g.attempts.length}/${g.budget.maxIterations}, ` +
						`last=${g.attempts[g.attempts.length - 1]?.reason ?? 'none'}`,
				}
			}

			case 'list': {
				const all = await listGoals()
				const summary = all.map(g => ({
					id: g.id,
					status: g.status,
					objective: g.objective,
					attempts: g.attempts.length,
					createdAt: g.createdAt,
				}))
				return {
					data: {goals: summary, count: all.length},
					resultText: `${all.length} goal(s) on disk.`,
				}
			}

			case 'attach': {
				const g = await loadGoal(args.id)
				if (!g) {
					return {
						data: {id: args.id, found: false},
						resultText: `Goal ${args.id} not found.`,
					}
				}
				if (g.status !== 'active') {
					return {
						data: {id: g.id, status: g.status},
						resultText: `Goal ${g.id} is ${g.status} and cannot be re-attached.`,
					}
				}
				await setActiveGoal(g)
				return {
					data: {id: g.id, status: g.status},
					resultText: `Attached to active goal ${g.id}. Loop will resume from next iteration.`,
				}
			}

			case 'abort': {
				const g = args.id ? await loadGoal(args.id) : getActiveGoal()
				if (!g) {
					return {
						data: {aborted: false},
						resultText: 'No goal to abort.',
					}
				}
				const wasActive = g.id === getActiveGoal()?.id
				g.status = 'aborted'
				g.updatedAt = new Date().toISOString()
				g.notes = (g.notes ?? '') + `\n[abort] ${args.reason}\n`
				await saveGoal(g)
				if (wasActive) clearActiveGoal()
				return {
					data: {id: g.id, status: g.status, wasActive},
					resultText: `Goal ${g.id} aborted: ${args.reason}`,
				}
			}

			case 'report': {
				const a = getActiveGoal()
				if (!a) {
					return {
						data: {recorded: false},
						resultText: 'No active goal to report against.',
					}
				}
				a.notes =
					(a.notes ?? '') +
					`\n[report iter ${a.attempts.length}] ${args.note}\n`
				a.updatedAt = new Date().toISOString()
				await saveGoal(a)
				return {
					data: {id: a.id, recorded: true},
					resultText: 'Note recorded on active goal. (Evaluator is still the source of truth.)',
				}
			}
		}
	},
})
