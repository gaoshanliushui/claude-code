/**
 * /expert — list or invoke a custom expert (WorkBuddy-style).
 *
 *   /expert              → list all experts (display only)
 *   /expert <name>       → inject a meta message telling the model to invoke
 *                          the named expert via the ExpertManager tool.
 *
 * Implementation lives in `./expert.tsx` (local-jsx) and is lazy-loaded.
 */
import type {Command} from '../../commands.js'

const expert = {
	type: 'local-jsx',
	name: 'expert',
	description:
		'List available custom AI experts, or invoke one by name (`/expert <name>`)',
	argumentHint: '[name]',
	whenToUse:
		'Use /expert to see what custom AI experts are available, or /expert <name> to activate one. The list comes from ~/.claude/experts/ (user) and <cwd>/.claude/experts/ (project).',
	load: () => import('./expert.js'),
} satisfies Command

export default expert
