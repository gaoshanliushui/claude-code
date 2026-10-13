/**
 * Implementation of the `/goal` slash command. Pure formatting — no side
 * effects. Reads from the active-goal singleton and from disk. If no
 * active goal is set, returns a hint pointing at the GoalTool.
 */

import {
	getActiveGoal,
} from '../../tools/GoalTool/activeGoal.js'
import {
	isBudgetExhausted,
	listGoals,
	loadGoal,
} from '../../tools/GoalTool/storage.js'
import type {Goal} from '../../tools/GoalTool/types.js'
import type {LocalCommandCall} from '../../types/command.js'

function formatGoal(g: Goal): string {
	const lines: string[] = []
	lines.push(`Active goal: ${g.id}`)
	lines.push(`  Status:    ${g.status}`)
	lines.push(`  Objective: ${g.objective}`)
	lines.push(
		`  Budget:    ${g.attempts.length}/${g.budget.maxIterations} iterations${
			g.budget.maxWallMs !== undefined
				? `, ${Math.round(g.budget.maxWallMs / 60_000)} min wall`
				: ''
		}`,
	)
	if (isBudgetExhausted(g)) {
		lines.push('  Budget exhausted.')
	}

	if (g.successCriteria.length > 0) {
		lines.push('  Criteria:')
		const lastEvidence = g.attempts[g.attempts.length - 1]?.criterionEvidence ?? {}
		for (const c of g.successCriteria) {
			const verified = lastEvidence[c.id] === true
			const mark = verified ? '✓' : '·'
			lines.push(`    [${mark}] ${c.id}: ${c.description}`)
		}
	}

	if (g.attempts.length > 0) {
		lines.push('  Recent attempts:')
		const recent = g.attempts.slice(-3)
		for (const a of recent) {
			const ts = a.ts.slice(11, 19) // HH:MM:SS
			const verdict = a.met ? 'MET' : 'not-met'
			lines.push(`    iter ${a.iteration} · ${ts} · ${verdict}`)
			lines.push(`      ${a.reason.slice(0, 200)}`)
		}
	}

	return lines.join('\n')
}

export const call: LocalCommandCall = async () => {
	const active = getActiveGoal()
	if (!active) {
		const all = await listGoals()
		const onDisk = all.length
		const lines: string[] = ['No active goal.']
		if (onDisk > 0) {
			lines.push(
				`${onDisk} goal(s) on disk — reattach with the agent's ` +
					`goal({action:"attach", id:"<id>"}) tool.`,
			)
		} else {
			lines.push(
				'Create one via the agent calling ' +
					'goal({action:"create", objective:"...", success_criteria:["..."]}).',
			)
		}
		return {type: 'text', value: lines.join('\n')}
	}

	// Refresh from disk so the user sees the latest evaluator verdicts,
	// even if the in-memory copy hasn't been touched this turn.
	const fresh = await loadGoal(active.id)
	const display = fresh ?? active
	return {type: 'text', value: formatGoal(display)}
}
