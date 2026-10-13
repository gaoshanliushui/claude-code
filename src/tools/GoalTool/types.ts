/**
 * Type definitions for GoalTool — the goal-driven automation mechanism.
 *
 * Goals live across sessions as JSON files; attempts[] is the audit trail
 * produced by the independent evaluator LLM call after each iteration.
 *
 * Status semantics:
 *   - active:     the hook in query.ts will keep evaluating and auto-continuing
 *   - completed:  all criteria verified by evaluator → no further auto-continues
 *   - failed:     budget exhausted OR stagnation detected → no further auto-continues
 *   - aborted:    user/agent explicitly aborted → no further auto-continues
 */

export type GoalStatus = 'active' | 'completed' | 'failed' | 'aborted'

export type Criterion = {
	/** Stable id used as key in `criterionEvidence` from the evaluator. */
	id: string
	/** Human-readable success condition — what would count as satisfied. */
	description: string
}

export type GoalBudget = {
	/** Hard cap on auto-continue iterations. */
	maxIterations: number
	/** Wall-clock budget in ms (since goal.createdAt). Optional. */
	maxWallMs?: number
	/** Soft cost budget in USD. Reserved — not enforced in v1. */
	maxCostUsd?: number
}

export type AttemptRecord = {
	/** Iteration index when this attempt was evaluated (matches query.ts turnCount). */
	iteration: number
	/** ISO timestamp of the evaluation. */
	ts: string
	/** Did the evaluator say the goal is met? */
	met: boolean
	/** Free-text reasoning from the evaluator. */
	reason: string
	/** Per-criterion evidence: { [criterionId]: true if satisfied }. */
	criterionEvidence: Record<string, boolean>
	/** Reserved for future cost tracking. Always 0 in v1. */
	evaluatorCostUsd: number
}

export type Goal = {
	id: string
	objective: string
	successCriteria: Criterion[]
	budget: GoalBudget
	status: GoalStatus
	attempts: AttemptRecord[]
	createdAt: string
	updatedAt: string
	/** ISO timestamp when status transitioned to 'completed'. */
	goalCompletedAt?: string
	/** ISO timestamp when status transitioned to 'failed'. */
	failedAt?: string
	/** Free-form agent-reported notes (from `goal({action:'report', note})`). */
	notes?: string
}

/** Result of one independent-evaluator LLM call. */
export type GoalEvaluation = {
	met: boolean
	reason: string
	criterionEvidence: Record<string, boolean>
	evaluatorCostUsd: number
}
