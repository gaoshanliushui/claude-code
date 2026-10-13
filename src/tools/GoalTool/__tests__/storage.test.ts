/**
 * Tests for `isBudgetExhausted` — the budget gate that bounds auto-continue.
 * Pure function: no fs, no env. Easy to test exhaustively.
 */

import {describe, expect, test} from 'bun:test'
import {isBudgetExhausted} from '../storage.js'
import type {Goal} from '../types.js'

function makeGoal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'test',
		objective: 'o',
		successCriteria: [],
		budget: {maxIterations: 3, maxWallMs: 60_000},
		status: 'active',
		attempts: [],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	}
}

describe('isBudgetExhausted', () => {
	test('fresh goal with no attempts → not exhausted', () => {
		expect(isBudgetExhausted(makeGoal())).toBe(false)
	})

	test('attempts.length < maxIterations → not exhausted', () => {
		const g = makeGoal({attempts: [{}, {}, {}] as Goal['attempts']}) // length 3 = max → exhausted
		expect(isBudgetExhausted({...g, attempts: [{}, {}] as Goal['attempts']})).toBe(false)
	})

	test('attempts.length === maxIterations → exhausted', () => {
		const g = makeGoal({attempts: [{}, {}, {}] as Goal['attempts']})
		expect(isBudgetExhausted(g)).toBe(true)
	})

	test('wall time exceeded → exhausted even with few attempts', () => {
		const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
		const g = makeGoal({createdAt: tenMinAgo, budget: {maxIterations: 1000, maxWallMs: 60_000}})
		expect(isBudgetExhausted(g)).toBe(true)
	})

	test('wall time NOT set → only iteration cap matters', () => {
		const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
		const g = makeGoal({createdAt: tenMinAgo, budget: {maxIterations: 1000}})
		expect(isBudgetExhausted(g)).toBe(false)
	})

	test('iteration cap wins when both are exceeded', () => {
		const g = makeGoal({
			attempts: [{}, {}, {}] as Goal['attempts'],
			budget: {maxIterations: 3, maxWallMs: 24 * 60 * 60 * 1000},
		})
		expect(isBudgetExhausted(g)).toBe(true)
	})
})
