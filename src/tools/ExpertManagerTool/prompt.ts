/**
 * System prompt blurb for the ExpertManager tool. Injected into the model's
 * tool spec via ExpertManagerTool.prompt(). The goal is to give the model
 * enough context to know when to use this tool vs the Agent tool, and how
 * each action maps to user intent.
 */
import {EXPERT_MANAGER_TOOL_NAME} from './constants.js'

export const DESCRIPTION =
	`Manage and invoke custom AI experts and expert teams (WorkBuddy-style).

Each expert is a directory under \`~/.claude/experts/<slug>/\` (user-level) or
\`<cwd>/.claude/experts/<slug>/\` (project-level), containing:

- \`plugin.json\` — identity card (name, expertType, displayName, profession,
  description, categoryId, tags[3], quickPrompts[3], defaultInitPrompt,
  members[] for teams).
- \`agents/<slug>.md\` — system prompt body that defines the expert's role.

Use this tool when:

- The user asks for a new specialist persona (analyst, tutor, reviewer,
  etc.) — call \`create\`.
- The user asks for a coordinated squad across multiple domains — call
  \`create_team\`.
- The user wants to activate a saved expert for a specific task — call
  \`invoke\`. Internally this spawns a sub-agent using the Agent tool
  mechanism, so permission semantics are identical to spawning an agent.
- The user wants to see what experts exist, view a definition, edit,
  delete, or validate it.

Do NOT use this tool to invoke a generic one-off sub-agent — use the Agent
tool with \`subagent_type: general-purpose\` for that. Experts are persistent
named personas the user expects to be reusable.

Actions (all take an \`action\` discriminator):

- \`list\` — enumerate experts. Optional \`scope\` (user|project|all,
  default all) and \`type\` (agent|team|all, default all).
- \`view\` — read an expert's full definition (plugin.json + .md body).
- \`create\` — define a new agent-type expert. Required: name, displayName,
  profession, description, categoryId, tags[3], quickPrompts[3], prompt.
- \`create_team\` — define a new team expert that references existing
  agent-type experts. Required: name, displayName, profession, description,
  categoryId, tags[3], quickPrompts[3], leader_agent, member_agents[].
- \`edit\` — update one or more fields of an existing expert.
- \`delete\` — remove an expert directory. Irreversible.
- \`validate\` — run static checks (required fields, tags/quickPrompts
  lengths, description length, team member existence, [TODO] placeholders).
- \`invoke\` — run an expert on a specific prompt. Returns the expert's
  final assistant message and the spawned agentId(s). Has an optional
  \`runtime\` field:
    - \`auto\` (default) — picks by expertType: agent → single, team → team.
    - \`single\` — always uses the in-process runAgent path (no real
      teammates; leader+member outputs are concatenated).
    - \`team\` — uses TeamCreate + per-member Agent spawns. Members become
      real teammates with SendMessage available. The leader (current
      process) is told via the tool result how to coordinate. Requires
      \`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1\` or \`--agent-teams\` (or
      \`USER_TYPE=ant\`). Use \`team\` when members need to discuss / react
      to each other. Use \`single\` when the user wants quick N-perspective
      output without real coordination.
  Additional \`invoke\` fields: \`persistTeam\` (default false) to keep the
  team alive after invoke; \`teamTimeoutMs\` (default 600000) for per-
  invocation idle timeout.

Storage:

- Default writes go to \`~/.claude/experts/<slug>/\` (user-level, shared
  across projects). Pass \`scope: "project"\` to write to
  \`<cwd>/.claude/experts/<slug>/\` instead.
- Reads use priority: managed > user > project (later wins on name
  collision). Use \`scope\` to limit the search.

Safety:

- \`delete\` is irreversible and requires Write permission on the experts
  directory.
- \`create\` / \`edit\` / \`delete\` / \`invoke\` all require appropriate
  permission grants via the standard permission system.
- Validation rules mirror WorkBuddy's \`validate_expert.py\`: tags.length
  must be exactly 3, quickPrompts.length must be exactly 3, defaultInitPrompt
  must equal quickPrompts[0], description with CJK chars must be 40-50
  chars, and team members must be resolvable agent-type experts.

Naming:

- \`name\` is a kebab/snake-case slug matching \`/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/\`.
  Same slug becomes the \`agentName\`.

Example — create a finance analyst:

\`\`\`
{
  "action": "create",
  "name": "stock-analyst",
  "displayName": {"zh": "股票分析师", "en": "Stock Analyst"},
  "profession": {"zh": "金融分析师", "en": "Finance Analyst"},
  "description": "资深股票分析师,擅长技术面与基本面结合,给出可执行的操作建议",
  "categoryId": "finance",
  "tags": ["finance", "stock", "analysis"],
  "quickPrompts": ["分析最近走势", "对比同业", "给出操作建议"],
  "prompt": "You are a senior stock analyst..."
}
\`\`\`

Example — invoke:

\`\`\`
{
  "action": "invoke",
  "name": "stock-analyst",
  "prompt": "评估一下腾讯最近的走势"
}
\`\`\`

Example — invoke a team with real coordination:

\`\`\`
{
  "action": "invoke",
  "name": "toutiao-ops-team",
  "prompt": "诊断当前账号瓶颈",
  "runtime": "team",
  "persistTeam": false
}
\`\`\`

Team expert prompt authoring (for the coordinator role):

When \`runtime=team\` is used, the team expert's \`prompt\` is delivered to
the leader (the current process) as guidance, not a system prompt override.
So team expert prompts should be written as **coordinator instructions** —
they tell the leader how to orchestrate the named members. Example shape:

\`\`\`markdown
You are coordinating a team of N experts to address the user's task.

Members:
- {member1-slug}: {what they do}
- {member2-slug}: {what they do}
...

Workflow:
1. Decompose the user's task into N sub-tasks, one per member.
2. Use SendMessage to send each member their sub-task.
3. Collect their responses.
4. Synthesize a unified final answer.
5. If persistTeam was false, TeamDelete cleans up at session end.
\`\`\`

Hard constraint: the leader's system prompt is fixed at CLI startup and
cannot be changed by tool invocations. The team expert's prompt lives in
the tool result, where the leader can read and act on it.
`

export function getPrompt(): string {
	return `${DESCRIPTION}\n\nTool name: \`${EXPERT_MANAGER_TOOL_NAME}\`.`
}

export {EXPERT_MANAGER_TOOL_NAME}
