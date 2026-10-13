/**
 * Independent goal-completion evaluator.
 *
 * Each auto-continue iteration makes ONE fresh LLM call via `sideQuery`
 * (NOT `query()` — we explicitly want no tools, no loop, no shared cache
 * prefix with the parent agent) and asks: "given this transcript, are
 * all success criteria satisfied?"
 *
 * Why independent:
 *   - The main agent is biased toward "I think I'm done." Letting it
 *     self-report is the classic self-grading failure mode.
 *   - The evaluator reads the same transcript but has no goal-commitment
 *     of its own — it's a forward pass with a strict JSON output contract.
 *
 * On error (network, schema mismatch, abort), we degrade to a safe
 * non-met verdict with reason 'evaluator_error: ...' so the loop keeps
 * going instead of deadlocking.
 */

import type Anthropic from '@anthropic-ai/sdk'
import {sideQuery, type SideQueryOptions} from '../../utils/sideQuery.js'
import {errorMessage} from '../../utils/errors.js'
import {
	DEFAULT_EVALUATOR_MODEL,
	EVALUATOR_MAX_TOKENS,
} from './constants.js'
import {EVALUATOR_SYSTEM_PROMPT} from './prompt.js'
import type {Goal, GoalEvaluation, Message} from './types.js'

type BetaJSONOutputFormat = Anthropic.Beta.Messages.BetaJSONOutputFormat

const OUTPUT_FORMAT = {
	type: 'json_schema',
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			goal_met: {type: 'boolean'},
			reasoning: {type: 'string'},
			criterionEvidence: {
				type: 'object',
				additionalProperties: {type: 'boolean'},
			},
		},
		required: ['goal_met', 'reasoning', 'criterionEvidence'],
	},
} as unknown as BetaJSONOutputFormat

/** Safe text extraction — handles content-block arrays. */
function extractText(response: Anthropic.Beta.Messages.BetaMessage): string {
	for (const block of response.content) {
		if (block.type === 'text') return block.text
	}
	return '{}'
}

/**
 * Compact transcript summary for the evaluator prompt.
 *
 * Keeps only the last 30 messages, truncated to 600 chars each, total
 * 16k chars. Goal criteria are evaluated against *what was said*, so
 * we don't need full fidelity — just enough signal.
 */
function summarizeTranscript(
	messages: ReadonlyArray<Message>,
	charBudget = 16_000,
): string {
	const tail = messages.slice(-30)
	const lines = tail.map(m => {
		const text = JSON.stringify(m).slice(0, 600)
		return `[${m.type}] ${text}`
	})
	return lines.join('\n').slice(0, charBudget)
}

/**
 * Run the independent evaluator against the given goal + recent transcript.
 *
 * Returns a GoalEvaluation. Never throws — failures degrade to
 * {met: false, reason: 'evaluator_error: ...'}.
 */
export async function evaluateGoal(
	goal: Goal,
	recentMessages: ReadonlyArray<Message>,
	signal: AbortSignal | undefined,
	model: string = DEFAULT_EVALUATOR_MODEL,
): Promise<GoalEvaluation> {
	try {
		const resp = await sideQuery({
			model,
			querySource: 'goal_evaluator' as SideQueryOptions['querySource'],
			skipSystemPromptPrefix: true,
			system: EVALUATOR_SYSTEM_PROMPT,
			messages: [
				{
					role: 'user',
					content:
						`Goal: ${goal.objective}\n` +
						`Criteria:\n${goal.successCriteria
							.map(c => `  [${c.id}] ${c.description}`)
							.join('\n')}\n\n` +
						`Recent transcript:\n${summarizeTranscript(recentMessages)}\n\n` +
						`Respond with strict JSON per the schema.`,
				},
			],
			output_format: OUTPUT_FORMAT,
			max_tokens: EVALUATOR_MAX_TOKENS,
			signal,
		})
		const parsed = JSON.parse(extractText(resp)) as {
			goal_met: boolean
			reasoning: string
			criterionEvidence: Record<string, boolean>
		}
		return {
			met: parsed.goal_met,
			reason: parsed.reasoning ?? '',
			criterionEvidence: parsed.criterionEvidence ?? {},
			evaluatorCostUsd: 0,
		}
	} catch (e) {
		return {
			met: false,
			reason: `evaluator_error: ${errorMessage(e)}`,
			criterionEvidence: {},
			evaluatorCostUsd: 0,
		}
	}
}
