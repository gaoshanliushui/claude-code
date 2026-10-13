/**
 * System prompt blurb for the ExpertManager tool. Injected into the model's
 * tool spec via ExpertManagerTool.prompt(). The goal is to give the model
 * enough context to know when to use this tool vs the Agent tool, and how
 * each action maps to user intent.
 *
 * WorkBuddy compatibility: the team-expert authoring section mirrors
 * WorkBuddy's lead-prompt conventions (5-Phase SOP, 4 workflows, iron
 * rules, forbidden behaviors). The lead's prompt body should follow this
 * template so that runtime='team' coordination matches WorkBuddy's
 * expectations.
 */
import {EXPERT_MANAGER_TOOL_NAME} from './constants.js'

export const DESCRIPTION =
	`Manage and invoke custom AI experts and expert teams (WorkBuddy-compatible).

Each expert is a directory under \`~/.claude/experts/<slug>/\` (user-level) or
\`<cwd>/.claude/experts/<slug>/\` (project-level), containing:

- \`plugin.json\` (WorkBuddy format: \`.codebuddy-plugin/plugin.json\`, or
  legacy: root \`plugin.json\`) — identity card with \`name\`, \`expertType\`,
  \`agentName\`, \`displayName\`, \`profession\`, \`description\`,
  \`displayDescription\`, \`categoryId\`, \`tags[3]\`, \`quickPrompts[3]\`,
  \`defaultInitPrompt\`, \`members[]\`. Optional WorkBuddy fields: \`version\`,
  \`author\`, \`avatar\`, \`plugin\`, \`teamInfo\`, \`agents[]\`.
- \`agents/<slug>.md\` (agent-type) or \`agents/<team-name>-team-lead.md\` +
  \`agents/<member1>.md\` + ... (team-type, WorkBuddy) — system prompt body.
- \`avatars/\` (optional) — per-member and team PNG avatars.
- \`README.md\` (optional) — human-readable documentation.

All i18n fields (\`displayName\`, \`profession\`, \`tags\`, \`quickPrompts\`,
\`defaultInitPrompt\`, \`displayDescription\`) accept either a plain string
(legacy) or a \`{en, zh}\` object (WorkBuddy).

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
  Optional: version, author, displayDescription, avatar, plugin.
- \`create_team\` — define a new team expert that references existing
  agent-type experts. Required: name, displayName, profession, description,
  categoryId, tags[3], quickPrompts[3], leader_agent, member_agents[].
  Optional: version, author, displayDescription, avatar, plugin, workflows[].
- \`edit\` — update one or more fields of an existing expert.
- \`delete\` — remove an expert directory. Irreversible.
- \`validate\` — run static checks (required fields, tags/quickPrompts
  lengths, description length, team member existence, teamInfo consistency,
  [TODO] placeholders).
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
  chars, and team members must be resolvable agent-type experts. teamInfo
  (if present) must be self-consistent with members[].

Naming:

- \`name\` is a kebab/snake-case slug matching \`/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/\`.
  Same slug becomes the \`agentName\`.
- For team experts, the lead's .md filename is \`<team-name>-team-lead.md\`
  (WorkBuddy convention). The lead's \`id\` in \`teamInfo.leadAgent\` should
  match this slug.

Example — create a finance analyst:

\`\`\`
{
  "action": "create",
  "name": "stock-analyst",
  "displayName": {"zh": "股票分析师", "en": "Stock Analyst"},
  "profession": {"zh": "金融分析师", "en": "Finance Analyst"},
  "description": "资深股票分析师,擅长技术面与基本面结合,给出可执行的操作建议",
  "categoryId": "06-Finance",
  "tags": [
    {"en": "Finance", "zh": "金融"},
    {"en": "Stock", "zh": "股票"},
    {"en": "Analysis", "zh": "分析"}
  ],
  "quickPrompts": [
    {"en": "Analyze recent trends", "zh": "分析最近走势"},
    {"en": "Compare peers", "zh": "对比同业"},
    {"en": "Trading recommendations", "zh": "给出操作建议"}
  ],
  "displayDescription": {"zh": "资深股票分析师,擅长技术面与基本面结合,给出可执行的操作建议", "en": "Senior stock analyst with combined technical + fundamental analysis."},
  "version": "1.0.0",
  "author": {"name": "Your Name"},
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

Team expert prompt authoring (WorkBuddy convention):

When \`runtime=team\` is used, the team expert's \`prompt\` is delivered to
the leader (the current process) as guidance, not a system prompt override.
So team expert prompts should be written as **coordinator instructions** —
they tell the leader how to orchestrate the named members.

Recommended structure (mirrors WorkBuddy's lead SOP template):

\`\`\`markdown
# <Team display name> - 主理人 <lead display name>

## 团队成员
| 成员 ID | 职责 |
|---------|------|
| <team-name>-team-lead | 编排调度 + 终审签发 |
| <member1-slug> | <member1 职责> |
| <member2-slug> | <member2 职责> |

## 标准工作流程 (SOP)

### Phase 1: 选题立项(<主理人>亲做)
- 解析用户选题指令,明确:主题 / 立场 / 目标读者 / 篇幅 / 风格基调
- 拆解核心数据需求清单
- 形成「立项卡」下发给下一阶段

### Phase 2: <阶段名>(并行/串行调度<成员>)
- 调用 <member>,传入完整立项卡
- 验收产出齐备性

### Phase 3-N: <阶段名>(...)
- ...

## 单 Agent 直调路由表
| 问法类型 | 直接调谁 |
|---------|---------|
| "..." | <member> |

## 预设 Workflow
### Workflow A: <name>
- 触发: <trigger>
- 范围: Phase X-Y

### Workflow B: <name>
- ...

## 团队协作机制(铁律)
1. **建立团队**: 任务开始时由主理人亲自创建团队(TeamCreate)。
   团队创建必须且只能由主理人执行,严禁委派任何成员创建团队
2. **调度成员**: 按 SOP 阶段将成员拉入协作、下发独立任务
3. **消息中转**: 成员产出回传给主理人,由主理人汇总、转交下一阶段;
   所有跨成员信息流必须经主理人中转,不得互相直连
4. **成员结论为准**: 任何专业产出必须由对应成员输出后再采信

### 严禁行为
- 禁止跳过 TeamCreate,直接自己模拟成员发言或并行写出多角色内容
- 禁止自己代写任何团队成员的专业产出
- 禁止未完成前序阶段就跳到后续阶段
- 禁止让成员互相直连通信,所有跨成员信息流必须经主理人中转
- 禁止 spawn 主理人自己
\`\`\`

Hard constraint: the leader's system prompt is fixed at CLI startup and
cannot be changed by tool invocations. The team expert's prompt lives in
the tool result, where the leader can read and act on it.
`

export function getPrompt(): string {
	return `${DESCRIPTION}\n\nTool name: \`${EXPERT_MANAGER_TOOL_NAME}\`.`
}

export {EXPERT_MANAGER_TOOL_NAME}
