/**
 * Constants for GoalTool — the goal-driven automation mechanism.
 *
 * Goals are persisted across sessions as JSON files under
 * `<claudeConfigHome>/goals/<id>.json`. At runtime a single active goal is
 * tracked in module-local state and drives an auto-continue hook in `query.ts`.
 */

export const GOAL_TOOL_NAME = 'Goal'

export const GOALS_DIR_NAME = 'goals'
export const GOAL_FILE_EXT = '.json'

// Env vars used to ferry CLI flag values into the module-level singleton.
// `main.tsx --goal <file>` writes CLAUDE_CODE_GOAL_FILE; resume-by-id is a
// future-facing knob for cross-session reattachment.
export const GOAL_ENV_VAR_FILE = 'CLAUDE_CODE_GOAL_FILE'
export const GOAL_ENV_VAR_ID = 'CLAUDE_CODE_GOAL_ID'

// Budget defaults — chosen to bound unattended runs without surprising users.
export const DEFAULT_MAX_ITERATIONS = 20
export const DEFAULT_MAX_WALL_MS = 30 * 60 * 1000 // 30 minutes
export const DEFAULT_MAX_COST_USD = 5 // soft cap; v1 doesn't track per-turn cost

// Stagnation: N consecutive identical non-met verdicts ⇒ fail early.
// Cheaper than waiting to hit maxIterations when the loop is genuinely stuck.
export const STAGNATION_LIMIT = 3

// Evaluator call shape — single-shot, structured-output, no tools.
export const EVALUATOR_MAX_TOKENS = 1024

// Haiku is sufficient for "did the agent satisfy these textual criteria?" —
// it's a forward-pass judgment over a transcript. Saves cost on long runs.
export const DEFAULT_EVALUATOR_MODEL = 'claude-haiku-4-5'

// Analytics tag — emitted on activation and on terminal status changes.
export const ANALYTICS_GOAL_ACTIVATED = 'tengu_goal_activated'
export const ANALYTICS_GOAL_COMPLETED = 'tengu_goal_completed'
export const ANALYTICS_GOAL_FAILED = 'tengu_goal_failed'
export const ANALYTICS_GOAL_ABORTED = 'tengu_goal_aborted'
