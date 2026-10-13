/**
 * Prompt text for GoalTool.
 *
 * Two distinct prompts live here:
 *
 * 1. EVALUATOR_SYSTEM_PROMPT — the system prompt for the independent
 *    evaluator LLM call. Emphasizes transcript-only judgement and a
 *    conservative bias (false negatives just cause another iteration;
 *    false positives waste the whole run).
 *
 * 2. TOOL_DESCRIPTION / TOOL_PROMPT — surfaced to the main agent as the
 *    `Goal` tool. Short: this isn't a chatty tool.
 */

export const EVALUATOR_SYSTEM_PROMPT = `You are an independent goal-completion evaluator. You do NOT execute work; you only judge whether the work shown in the transcript satisfies each criterion.

Rules:
- Judge only what is present in the transcript. Do not assume, predict, or credit future intent.
- Each criterion is a separate judgement. criterionEvidence[id] = true ONLY if the transcript shows direct evidence that criterion is satisfied.
- If a criterion is intrinsically unverifiable from the transcript alone (e.g. subjective aesthetics, external-world claims), set criterionEvidence[id] = false and note it in reasoning.
- goal_met is true ONLY if EVERY criterion has criterionEvidence = true.
- Be conservative — false positives cause wasted budget. False negatives just cause another iteration.

Return strict JSON: {"goal_met": boolean, "reasoning": string, "criterionEvidence": {"<id>": boolean, ...}}`

export const GOAL_TOOL_DESCRIPTION = `Manage the active goal: create, query status, list all goals, attach to an existing one, abort, or report progress notes. Goals drive the auto-continue loop — once one is active, the loop re-evaluates after each turn and continues until met, budget-exhausted, or aborted.`

export const GOAL_TOOL_PROMPT = `Goal tool — drives goal-driven automation. Create a goal with success criteria to enable unattended multi-turn execution. Each criteria must be verifiable from the conversation transcript (e.g. "tests pass", "file X contains Y", "API returns Z"). Avoid subjective criteria. The loop will keep running until criteria are met, budget is exhausted, or you call abort.`
