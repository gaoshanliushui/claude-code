/**
 * Unit tests for the pure decision logic in `decideNextStep`.
 *
 * The hook is the heart of the auto-continue loop — if it picks the wrong
 * outcome kind, the loop either deadlocks or runs unbounded. These tests
 * lock in the four outcome kinds and the budget / stagnation boundaries.
 */

import {describe, expect, test} from 'bun:test'
import {decideNextStep} from '../hook.js'
import {DEFAULT_MAX_ITERATIONS, STAGNATION_LIMIT} from '../constants.js'
import type {Goal, GoalEvaluation} from '../types.js'

function makeGoal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'test-goal',
		objective: 'Test objective',
		successCriteria: [
			{id: 'c0', description: 'first criterion'},
			{id: 'c1', description: 'second criterion'},
		],
		budget: {maxIterations: DEFAULT_MAX_ITERATIONS, maxWallMs: 30 * 60 * 1000},
		status: 'active',
		attempts: [],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	}
}

function makeEvaluation(overrides: Partial<GoalEvaluation> = {}): GoalEvaluation {
	return {
		met: false,
		reason: 'no evidence',
		criterionEvidence: {},
		evaluatorCostUsd: 0,
		...overrides,
	}
}

const neverExhausted = () => false
const alwaysExhausted = () => true

describe('decideNextStep — complete', () => {
	test('met=true AND all criteria verified → complete', () => {
		const goal = makeGoal()
		const evaluation = makeEvaluation({
			met: true,
			reason: 'all criteria satisfied',
			criterionEvidence: {c0: true, c1: true},
		})
		const out = decideNextStep(goal, evaluation, neverExhausted, 1)
		expect(out.kind).toBe('complete')
		if (out.kind === 'complete') {
			expect(out.metaMessage).toContain('achieved')
			expect(out.metaMessage).toContain('1 iteration')
		}
	})

	test('met=true but evidence missing for one criterion → NOT complete', () => {
		const goal = makeGoal()
		const evaluation = makeEvaluation({
			met: true,
			reason: 'evaluator says met but missed c1',
			criterionEvidence: {c0: true, c1: false},
		})
		const out = decideNextStep(goal, evaluation, neverExhausted, 1)
		// met=true alone is insufficient — every criterion must be verified.
		expect(out.kind).toBe('continue')
	})
})

describe('decideNextStep — fail (budget exhausted)', () => {
	test('budget exhausted AND not met → fail', () => {
		const goal = makeGoal()
		const evaluation = makeEvaluation({met: false, reason: 'no progress'})
		const out = decideNextStep(goal, evaluation, alwaysExhausted, 99)
		expect(out.kind).toBe('fail')
		if (out.kind === 'fail') {
			expect(out.reason).toBe('budget_exhausted')
			expect(out.metaMessage).toContain('Budget exhausted')
		}
	})
})

describe('decideNextStep — fail (stagnant)', () => {
	test(`last ${STAGNATION_LIMIT} non-met attempts share same reason → fail`, () => {
		const goal = makeGoal({
			attempts: Array.from({length: STAGNATION_LIMIT}, (_, i) => ({
				iteration: i + 1,
				ts: new Date().toISOString(),
				met: false,
				reason: 'agent is stuck',
				criterionEvidence: {},
				evaluatorCostUsd: 0,
			})),
		})
		const evaluation = makeEvaluation({met: false, reason: 'agent is stuck'})
		const out = decideNextStep(goal, evaluation, neverExhausted, 4)
		expect(out.kind).toBe('fail')
		if (out.kind === 'fail') {
			expect(out.reason).toBe('stagnant')
			expect(out.metaMessage).toContain('stagnant')
		}
	})

	test('2 same-reason attempts is NOT yet stagnation', () => {
		const goal = makeGoal({
			attempts: [
				{
					iteration: 1,
					ts: new Date().toISOString(),
					met: false,
					reason: 'same',
					criterionEvidence: {},
					evaluatorCostUsd: 0,
				},
				{
					iteration: 2,
					ts: new Date().toISOString(),
					met: false,
					reason: 'same',
					criterionEvidence: {},
					evaluatorCostUsd: 0,
				},
			],
		})
		const evaluation = makeEvaluation({met: false, reason: 'same'})
		const out = decideNextStep(goal, evaluation, neverExhausted, 3)
		expect(out.kind).toBe('continue')
	})

	test('stagnation only triggers when last N attempts are ALL non-met', () => {
		const goal = makeGoal({
			attempts: [
				{
					iteration: 1,
					ts: new Date().toISOString(),
					met: true,
					reason: 'ok',
					criterionEvidence: {c0: true, c1: true},
					evaluatorCostUsd: 0,
				},
				{
					iteration: 2,
					ts: new Date().toISOString(),
					met: false,
					reason: 'ok',
					criterionEvidence: {},
					evaluatorCostUsd: 0,
				},
				{
					iteration: 3,
					ts: new Date().toISOString(),
					met: false,
					reason: 'ok',
					criterionEvidence: {},
					evaluatorCostUsd: 0,
				},
			],
		})
		const evaluation = makeEvaluation({met: false, reason: 'ok'})
		const out = decideNextStep(goal, evaluation, neverExhausted, 4)
		// First attempt was met → not all non-met → no stagnation.
		expect(out.kind).toBe('continue')
	})
})

describe('decideNextStep — continue', () => {
	test('partial progress → continue with missing-criteria list', () => {
		const goal = makeGoal()
		const evaluation = makeEvaluation({
			met: false,
			reason: 'half done',
			criterionEvidence: {c0: true, c1: false},
		})
		const out = decideNextStep(goal, evaluation, neverExhausted, 2)
		expect(out.kind).toBe('continue')
		if (out.kind === 'continue') {
			expect(out.metaMessage).toContain('iteration 2')
			expect(out.metaMessage).toContain('second criterion') // the missing one
			expect(out.metaMessage).not.toContain('first criterion') // c0 is met, omitted
		}
	})
})
