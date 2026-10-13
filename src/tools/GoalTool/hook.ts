/**
 * The GoalTool auto-continue hook — extracted as a pure function for
 * testability.
 *
 * `query.ts` calls this once per recursive iteration (top-level only —
 * gated on `!toolUseContext.agentId`). The hook decides:
 *   - "no-op" — no active goal, or evaluator errored; loop continues normally.
 *   - "continue" — meta message to inject, status unchanged.
 *   - "complete" — meta message to inject, status='completed', clearActiveGoal().
 *   - "fail" — meta message to inject, status='failed', clearActiveGoal().
 *
 * Side-effects (saveGoal, clearActiveGoal, persistence) live in the caller
 * wrapper, NOT in `decideNextStep` — keeping `decideNextStep` pure makes
 * it trivially unit-testable.
 *
 * Stagnation heuristic: if the last STAGNATION_LIMIT non-met attempts all
 * have the same `reason`, fail early instead of waiting for maxIterations.
 * This catches the "loop is just spinning" failure mode cheaply.
 */

import {STAGNATION_LIMIT} from './constants.js'
import type {Goal, GoalEvaluation} from './types.js'

export type GoalHookOutcome =
  | {kind: 'noop'}
  | {kind: 'continue'; metaMessage: string}
  | {kind: 'complete'; metaMessage: string}
  | {kind: 'fail'; reason: string; metaMessage: string}

/**
 * Pure decision function: given a goal and its most-recent evaluation,
 * decide what should happen next. NO side effects.
 *
 * Caller responsibilities:
 *   1. Persist the new attempt onto goal.attempts before calling this.
 *   2. After calling this, update goal.status / saveGoal / clearActiveGoal
 *      based on the returned outcome.
 *   3. Inject `metaMessage` as the LAST element of `messagesForQuery`.
 */
export function decideNextStep(
  goal: Goal,
  evaluation: GoalEvaluation,
  isBudgetExhausted: (g: Goal, now?: number) => boolean,
  iterationCount: number,
  now: number = Date.now(),
): GoalHookOutcome {
  const allCriteriaVerified = goal.successCriteria.every(
    c => evaluation.criterionEvidence[c.id] === true,
  )
  const met = evaluation.met && allCriteriaVerified
  const exhausted = isBudgetExhausted(goal, now)

  // Stagnation check: last N non-met attempts share the same reason.
  const recentAttempts = goal.attempts.slice(-STAGNATION_LIMIT)
  const stagnant =
    recentAttempts.length >= STAGNATION_LIMIT &&
    recentAttempts.every(a => !a.met) &&
    recentAttempts.every(
      (a, i, arr) => i === 0 || a.reason === arr[i - 1]!.reason,
    )

  if (met) {
    return {
      kind: 'complete',
      metaMessage:
        `[GoalTool] Goal "${goal.objective}" achieved after ${iterationCount} iteration(s).\n\n` +
        `Summary: ${evaluation.reason}\n\n` +
        `Stop working on the goal. Briefly tell the user what was accomplished.`,
    }
  }

  if (stagnant) {
    return {
      kind: 'fail',
      reason: 'stagnant',
      metaMessage:
        `[GoalTool] Goal progress is stagnant — same evaluator verdict ${STAGNATION_LIMIT} times in a row.\n\n` +
        `Last reason: ${evaluation.reason}\n\n` +
        `Stop. Tell the user the goal loop is stuck and surface the evaluator's verdict.`,
    }
  }

  if (exhausted) {
    return {
      kind: 'fail',
      reason: 'budget_exhausted',
      metaMessage:
        `[GoalTool] Budget exhausted after ${goal.attempts.length}/${goal.budget.maxIterations} iteration(s).\n\n` +
        `Last evaluator verdict: ${evaluation.reason}\n\n` +
        `Stop. Tell the user the budget was exhausted and surface the partial state.`,
    }
  }

  const missing = goal.successCriteria
    .filter(c => !evaluation.criterionEvidence[c.id])
    .map(c => c.description)
    .join('; ')

  return {
    kind: 'continue',
    metaMessage:
      `[GoalTool] Goal "${goal.objective}" — iteration ${iterationCount}/${goal.budget.maxIterations}.\n\n` +
      `Evaluator verdict: not yet met.\nReason: ${evaluation.reason}\n` +
      `Missing criteria: ${missing || '(none specific)'}\n\n` +
      `Continue working toward the goal. Do not repeat prior work — adjust strategy based on the missing criteria above.`,
  }
}
