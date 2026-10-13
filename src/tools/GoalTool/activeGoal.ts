/**
 * Module-level singleton for the *active* goal.
 *
 * Why a singleton: only one goal can drive the auto-continue hook at a time,
 * and the hook in `query.ts` needs synchronous read access. Persisted state
 * lives in storage.ts; this file holds the in-memory pointer plus env-driven
 * rehydration.
 *
 * Why NOT `bootstrap/state.ts`: that file carries an explicit
 * "DO NOT ADD MORE STATE HERE - BE JUDICIOUS WITH GLOBAL STATE" warning.
 * GoalTool is a new subsystem with a narrow contract, so it gets its own
 * module-scoped state file. Follows the closure pattern from
 * `src/utils/sessionStorage.ts:441` (the `resetProjectForTesting()` twin).
 */

import {readFile} from 'fs/promises'
import {loadGoal, saveGoal} from './storage.js'
import {GOAL_ENV_VAR_FILE, GOAL_ENV_VAR_ID} from './constants.js'
import type {Goal} from './types.js'

let _active: Goal | null = null

/** Persist + install as the active goal. Returns the goal for chaining. */
export async function setActiveGoal(g: Goal): Promise<Goal> {
  await saveGoal(g)
  _active = g
  return g
}

/** Sync read — called from the hot path in query.ts. */
export function getActiveGoal(): Goal | null {
  return _active
}

export function clearActiveGoal(): void {
  _active = null
}

/**
 * Rehydrate the active goal from env vars set by `main.tsx`.
 *
 * Two knobs:
 *   - CLAUDE_CODE_GOAL_FILE: read & parse JSON, treat as the goal.
 *   - CLAUDE_CODE_GOAL_ID:   load from the goals/ dir by id.
 *
 * Returns the active goal (or null). Failures are swallowed and logged via
 * the empty return — startup must not crash on a missing/bad goal file.
 */
export async function rehydrateFromEnv(): Promise<Goal | null> {
  const file = process.env[GOAL_ENV_VAR_FILE]
  if (file) {
    try {
      const raw = await readFile(file, 'utf-8')
      const parsed = JSON.parse(raw) as Goal
      return await setActiveGoal(parsed)
    } catch {
      return _active
    }
  }
  const id = process.env[GOAL_ENV_VAR_ID]
  if (id) {
    const loaded = await loadGoal(id)
    if (loaded) return await setActiveGoal(loaded)
  }
  return _active
}

/** Test reset — mirrors `resetProjectForTesting` in sessionStorage.ts. */
export function _resetActiveGoalForTesting(): void {
  _active = null
}
