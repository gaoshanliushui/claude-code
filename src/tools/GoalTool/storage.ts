/**
 * File-backed persistence for GoalTool.
 *
 * Goals live at `<getClaudeConfigHomeDir()>/goals/<id>.json`. This mirrors
 * the patterns at `src/utils/sessionStorage.ts` and
 * `src/services/SessionMemory/sessionMemoryUtils.ts`: lazy mkdir + atomic
 * JSON write. Reuses `getFsImplementation()` so tests can swap in an
 * in-memory filesystem.
 *
 * NOTE: writes are NOT atomic-rename. Concurrent writers could race. In
 * practice only the auto-continue hook writes (single in-flight query loop
 * per session) and the tool's `create/abort` actions; collisions are
 * improbable. Upgrade to tmp+rename if multi-process writes become a need.
 */

import {join} from 'path'
import {getFsImplementation} from '../../utils/fsOperations.js'
import {getClaudeConfigHomeDir} from '../../utils/envUtils.js'
import {GOALS_DIR_NAME, GOAL_FILE_EXT} from './constants.js'
import type {Goal} from './types.js'

function goalsDir(): string {
  return join(getClaudeConfigHomeDir(), GOALS_DIR_NAME)
}

function goalPath(id: string): string {
  return join(goalsDir(), `${id}${GOAL_FILE_EXT}`)
}

export async function saveGoal(g: Goal): Promise<void> {
  const fs = getFsImplementation()
  await fs.mkdir(goalsDir(), {recursive: true})
  await fs.writeFile(goalPath(g.id), JSON.stringify(g, null, 2), 'utf-8')
}

export async function loadGoal(id: string): Promise<Goal | null> {
  const fs = getFsImplementation()
  try {
    const raw = await fs.readFile(goalPath(id), 'utf-8')
    return JSON.parse(raw) as Goal
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export async function listGoals(): Promise<Goal[]> {
  const fs = getFsImplementation()
  let names: string[]
  try {
    names = await fs.readdir(goalsDir())
  } catch {
    return []
  }
  const results = await Promise.all(
    names
      .filter(n => n.endsWith(GOAL_FILE_EXT))
      .map(n => loadGoal(n.slice(0, -GOAL_FILE_EXT.length))),
  )
  return results.filter((g): g is Goal => g !== null)
}

export async function deleteGoal(id: string): Promise<void> {
  const fs = getFsImplementation()
  try {
    await fs.unlink(goalPath(id))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}

/**
 * Check whether a goal's budget has been exhausted.
 *
 * `attempts.length >= maxIterations` ⇒ iteration cap hit.
 * Wall time uses goal.createdAt (ISO) so clock-skew between turns doesn't
 * matter — only elapsed time since the goal was created.
 */
export function isBudgetExhausted(g: Goal, now: number = Date.now()): boolean {
  const iterCap = g.attempts.length >= g.budget.maxIterations
  const wallCap =
    g.budget.maxWallMs !== undefined &&
    now - Date.parse(g.createdAt) > g.budget.maxWallMs
  return iterCap || wallCap
}
