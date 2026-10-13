/**
 * `/goal` slash command — show the active goal's status.
 *
 * Read-only by design: the heavy lifting (create / list / attach / abort)
 * is done via the GoalTool from inside the conversation. This command is
 * a quick status dashboard for the user, modeled on `/cost`.
 *
 * Output:
 *   - Active goal: id, objective, status, iteration count, criteria
 *     pass/fail, last evaluator verdict, budget exhaustion flag.
 *   - Recent attempts (last 3) with timestamps.
 *   - "No active goal" with a hint when none is set.
 */

import type {Command} from '../../commands.js'

const goal = {
	type: 'local',
	name: 'goal',
	description:
		'Show the active goal status (objective, criteria, attempt count, last evaluator verdict)',
	supportsNonInteractive: true,
	load: () => import('./goal.js'),
} satisfies Command

export default goal
