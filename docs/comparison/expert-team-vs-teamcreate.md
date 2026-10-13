# ExpertManager.create_team vs TeamCreateTool — 同名异质,各占一层

> 对比本仓库两套"团队"机制:
> 1. 原生 **`TeamCreateTool`** —— 运行时多 agent 协同
> 2. 自建 **`ExpertManagerTool` 的 `create_team` action** —— 持久化的领域专家目录
>
> 两者都叫"团队",但建模的层完全不同。本文把它们放在一张图里说清楚,避免误用。
>
> **v2 更新**:ExpertManagerTool 已通过 `expert:` agentType 注册桥接到 TeamCreate 的运行时。详见文末 [§13 桥接架构](#13-桥接架构) 与 [§14 团队专家 prompt 模板](#14-团队专家-prompt-模板)。

---

## 0. TL;DR

| 维度 | `TeamCreateTool`(原生) | `ExpertManagerTool.create_team`(自建) |
|---|---|---|
| 是什么 | 多 agent 协同的**运行时编排** | 持久化的**领域专家目录** |
| 存在时间 | 单次会话内,任务结束清理 | 永久,跨会话、跨项目复用 |
| 成员本质 | 独立进程(独立 session / tmux pane) | 对其他 expert 目录的 slug 引用 |
| 是否真协同 | ✅ teammates 互发消息 | ✅(经 `runtime='team'` 桥接) |
| 触发方式 | 工具调用 spawn 长生命周期 teammate | 工具调用 `invoke` 同步跑完即结束 |
| 元数据 | name/description/agent_type(裸) | 15 类目 / 3 tags / 3 quickPrompts / CJK 校验 |
| git 友好 | ❌(含 tmuxPaneId、sessionId、cwd) | ✅(纯 JSON + md,可入库) |
| 类比 | Kubernetes Pod / tmux session | 编程语言里的 namespace + role catalog |

**一句话**:`TeamCreateTool` 是"这次任务怎么协作",`create_team` 是"我有哪些可复用的角色"。把它们混用是反模式。

---

## 1. 概念模型的根本差异

```
                          ┌──────────────────────────────────────┐
   ┌──────────────┐       │      单次 Claude Code 会话          │
   │ TeamCreate   │──────▶│                                      │
   │   Tool       │       │   lead session ─┬─ spawn teammate 1  │
   └──────────────┘       │                  ├─ spawn teammate 2  │
        临时              │                  └─ spawn teammate N  │
                          │       ↑              (独立 session,   │
                          │       │              独立 tmux pane,  │
                          │   SendMessage 互发    可通信)         │
                          └──────────────────────────────────────┘

                          ┌──────────────────────────────────────┐
   ┌──────────────┐       │      ~/.claude/experts/              │
   │ ExpertMgr.   │──────▶│  experts/                            │
   │   create_team│       │  └── toutiao-ops-team/                │
   └──────────────┘       │      ├── plugin.json   (静态元数据)   │
        永久              │      └── agents/toutiao-ops-team.md   │
                          │      members: [                       │
                          │        "toutiao-ops-director",        │
                          │        "toutiao-content-strategist",  │
                          │        ... ← slug 引用,不实例化       │
                          │      ]                                │
                          │                                       │
                          │  真正执行: invoke → TeamCreate +      │
                          │    per-member Agent spawn             │
                          └──────────────────────────────────────┘
```

`TeamCreateTool` 解决的是**这次对话**里多个 agent 如何并行并通信。
`create_team` 解决的是**长期可复用**的多角色 bundle,什么时候想用就 `invoke` 一次。

---

## 2. 存储位置和文件结构

### 2.1 TeamCreateTool

```
~/.claude/teams/<team-name>/config.json
```

(`leadAgentId`、`leadSessionId` 字段强绑定具体运行实例)

```jsonc
{
  "name": "research-squad",
  "createdAt": 1735000000,
  "leadAgentId": "team-lead@research-squad",
  "leadSessionId": "9c3e…-uuid",   // 真实 session UUID
  "members": [
    {
      "agentId": "team-lead@research-squad",
      "name": "team-lead",
      "agentType": "researcher",
      "model": "opus",
      "joinedAt": 1735000000,
      "tmuxPaneId": "%5",          // 真实 tmux pane
      "cwd": "/Users/.../project",
      "worktreePath": null,
      "sessionId": "uuid-…",       // 每个 member 独立 session
      "subscriptions": ["researcher-2@research-squad"],
      "isActive": true,
      "mode": "default"
    },
    {
      "agentId": "researcher-2@research-squad",
      "name": "researcher-2",
      "agentType": "researcher",
      // 同上,每个 member 都有 tmuxPaneId / sessionId
    }
  ]
}
```

### 2.2 ExpertManagerTool.create_team

```
~/.claude/experts/<team-name>/
├── plugin.json       # 静态元数据
└── agents/
    └── <team-name>.md  # leader 的角色 prompt
```

(`plugin.json` 只描述"我是谁",不描述"我现在在哪个 session 跑")

```jsonc
{
  "name": "toutiao-ops-team",
  "expertType": "team",
  "agentName": "toutiao-ops-team",
  "displayName": { "zh": "头条运营专家团", "en": "Toutiao Ops Team" },
  "profession": { "zh": "内容运营" },
  "description": "资深头条运营团队,覆盖策略/数据/增长/变现/爆款 5 个领域,综合产出运营方案",
  "categoryId": "marketing",
  "tags": ["头条运营", "专家团队", "内容变现"],
  "quickPrompts": [
    "诊断当前账号瓶颈",
    "策划一个月的运营方案",
    "复盘最近 30 天数据"
  ],
  "defaultInitPrompt": "诊断当前账号瓶颈",
  "members": [
    { "agentName": "toutiao-ops-director",       "role": "leader" },
    { "agentName": "toutiao-content-strategist" },
    { "agentName": "toutiao-data-analyst" },
    { "agentName": "toutiao-growth-specialist" },
    { "agentName": "toutiao-monetization-expert" },
    { "agentName": "toutiao-viral-writer" }
  ]
}
```

**关键差异**

| 字段类型 | TeamCreateTool | create_team |
|---|---|---|
| 运行时状态 | `joinedAt` / `tmuxPaneId` / `sessionId` / `isActive` / `mode` | ❌ 无 |
| 通信 | `subscriptions`(可 SendMessage) | ❌ 无 |
| Catalog 属性 | ❌ 无 | `displayName` / `profession` / `categoryId` / `tags` / `quickPrompts` |
| 静态引用 | ❌ member 是实例 | ✅ member 是 `agentName` 字符串 |
| WorkBuddy 校验 | ❌ | ✅ CJK 描述 40–50 字符、tags=3、quickPrompts=3 等 |

---

## 3. 成员构成方式

### 3.1 TeamCreateTool

`members[]` 的每个元素是一个**真实的运行 agent 实例**:

```ts
{
  agentId: 'team-lead@<team>',
  name: 'team-lead',
  agentType: 'general-purpose' | 'Explore' | 'statusline-setup' | ...,
  model: 'opus' | 'sonnet' | ...,
  tmuxPaneId: '%5',         // 真实的 tmux pane
  cwd: '/Users/...',
  worktreePath: '/.../worktree-abc',
  sessionId: 'uuid-…',      // 真实 session UUID
  subscriptions: ['teammate-2@<team>'],  // 通信拓扑
  joinedAt: 1735000000,
  isActive: true,
  mode: 'plan' | 'default',
  backendType: 'in-process' | 'tmux',
  color: 'red' | 'blue' | ...,
}
```

Lead 用 `spawnTeammate()` 逐个 spawn,每个 member:
- 拿到独立 `sessionId`(可独立 resume)
- 占用独立 tmux pane
- 注册 `subscriptions` 用于接收消息
- 分配独立 `color`(UI 区分)

### 3.2 create_team

`members[]` 的每个元素是**对另一个 expert 目录的引用**:

```ts
{
  agentName: 'toutiao-content-strategist',  // slug,指向 ~/.claude/experts/toutiao-content-strategist/
  role?: 'leader' | 'member'                // 可选,标记角色
}
```

- `agentName` 是字符串,直到 `invoke` 时才被 `parseExpertDir()` 解析为 expert 对象。
- 没有 sessionId、没有 tmux、没有 subscriptions。
- 一个 member 可以同时被多个 team 引用(因为只是 slug 字符串)。
- `validateInput` 会在创建时校验:每个 member agentName 必须能被解析到(防止 dangling reference)。

**根本差别**

| 维度 | TeamCreateTool | create_team |
|---|---|---|
| member 是什么 | 一个**进程** | 一个**目录路径** |
| member 在哪 | 运行时 spawn 后才存在 | 永久存在于 `~/.claude/experts/<slug>/` |
| member 资源 | 独立 session + tmux + token budget | 无独立资源,共享调用者 budget |
| member 之间 | 通信 | 引用 |

---

## 4. 执行模型(桥接后)

### 4.1 TeamCreateTool

```
TeamCreate({team_name, description, agent_type})
  │
  ├─ setLeaderTeamName(sanitizeName(team_name))
  ├─ resetTaskList(taskListId) + ensureTasksDir(taskListId)
  └─ spawn lead session
         │
         ├─ lead 用 TaskCreate 创建子任务
         ├─ lead 用 spawnTeammate() 一个一个 fork teammates
         │      │
         │      ├─ teammate-1 独立 session,独立 tmux pane
         │      ├─ teammate-2 独立 session,独立 tmux pane
         │      └─ teammate-N 独立 session,独立 tmux pane
         │
         ├─ teammates 用 SendMessage 互相通信(可选)
         ├─ lead 收集结果,推进 task list
         └─ 任务结束 → TeamDelete(cleanup) 关闭
```

- 真并行(每个 teammate 独立 UI、可独立打断)
- Lead 是 orchestrator,动态决定 spawn 顺序、收集结果
- 每个 member 有自己的 token budget / context window / permission context

### 4.2 ExpertManagerTool.invoke(team) — 经 `runtime: 'team'` 桥接后

```
ExpertManager invoke({name: 'toutiao-ops-team', prompt: '分析 Q4 增长方案', runtime: 'team'})
  │
  ├─ readExpert('toutiao-ops-team') → plugin.json + .md
  │
  ├─ isAgentSwarmsEnabled()?
  │     └─ false → 立即返回 status='rejected',提示需 swarms
  │
  ├─ TeamCreateTool.call({team_name: 'expert_toutiao-ops-team_xxx',
  │                        description, agent_type: 'expert:toutiao-ops-team'})
  │     └─ 写 ~/.claude/teams/<name>/config.json
  │        setLeaderTeamName + resetTaskList + ensureTasksDir
  │        registerTeamForSessionCleanup
  │
  ├─ Promise.all(
  │     team.members.map(member =>
  │       AgentTool.call({
  │         description, prompt,
  │         subagent_type: `expert:${member.agentName}`,
  │         name: member.agentName,
  │         team_name, run_in_background: false
  │       })
  │     )
  │   )
  │     └─ 每个 member:
  │          - 找到 activeAgents 中 expert:<slug> 的 CustomAgentDefinition
  │          - spawnTeammate() → handleSpawnInProcess
  │          - runInProcessTeammate 自动注入 SendMessage + TeamCreate +
  │            TeamDelete + Task* 到工具集
  │          - 系统 prompt: [主 prompt] + [TEAMMATE_SYSTEM_PROMPT_ADDENDUM]
  │                       + [# Custom Agent Instructions\n<expert prompt>]
  │
  └─ 返回 tool result(content 是协调指引):
       "## Team: toutiao-ops-team (expert_toutiao-ops-team_xxx)
        ### Your role
        <team expert prompt>
        ### Members spawned
        - toutiao-content-strategist (teammate_id: …)
        - toutiao-viral-writer (teammate_id: …)
        ...
        ### Original task
        分析 Q4 增长方案
        ### Coordination
        Use SendMessage to talk to each member. ..."
```

leader 读完 tool result 后,在自己的后续 turn 中用 SendMessage 真正驱动协调。

**关键差异**

| 步骤 | TeamCreateTool | create_team + `runtime: 'team'` |
|---|---|---|
| 启动并行 | Lead 决策,按需 spawn | invoke 时一并 spawn(leader 后续可继续 spawn) |
| 并行谁 | teammates(独立 session) | members(共享 leader session,通过 SendMessage 沟通) |
| Member 拿不拿得到 leader 输出 | 主动 SendMessage 拉 | 已经在 tool result 里看到 team prompt 和任务 |
| Member 互相能不能通信 | ✅ | ✅(SendMessage 自动注入) |
| 谁能续跑 / resume | 任何 teammate(独立 session) | ✅ 每个 member 独立 sessionId |

### 4.3 ExpertManagerTool.invoke(team) — `runtime: 'single'`(旧路径)

```
ExpertManager invoke({name: 'toutiao-ops-team', prompt, runtime: 'single'})
  │
  ├─ runExpertTeam(team, prompt):  # 旧实现
  │     ├─ leader 先跑(同步)
  │     └─ Promise.all(members.map(runSingleExpert))
  │          每个 member 拿 leader 的输出作为附加 prompt
  │     └─ 把所有输出拼成 markdown 字符串
  │
  └─ 一次性同步返回,无通信
```

适用于"快速多视角,不需要讨论"场景。轻量,无 swarms 依赖。

---

## 5. 通信

| 通道 | TeamCreateTool | create_team (`runtime: 'team'`) | create_team (`runtime: 'single'`) |
|---|---|---|---|
| Lead ↔ Member | ✅ SendMessage(双向) | ✅ SendMessage | ❌ 无 |
| Member ↔ Member | ✅ SendMessage | ✅ SendMessage | ❌ 无 |
| Caller ↔ Lead | ✅ 整个 session 可见 | ✅ tool result 包含协调指引 | ✅ 但只有最终拼好的字符串 |
| 中途打断/续接 | ✅ session resume | ✅ member 各自 sessionId 可 resume | ❌ |

---

## 6. 生命周期

### 6.1 TeamCreateTool

```
create → [life: 任一 session 运行中] → delete / cleanup
```

- 每次会话内现建现用
- `leadSessionId` 记录 leader 的真实 session UUID,便于其他 session 加入发现
- 失败处理:`TeamDelete` 或 `operation: 'cleanup'`
- 不跨会话

### 6.2 create_team

```
create / create_team → [永久存在] → delete(可选)
```

- 跨会话、跨项目复用
- `invoke` 触发时,通过 TeamCreate 建立运行时(每个 invoke 一次)
- 失败处理:`validate` + 重新 `edit`
- 项目级 expert 可入 git,新同事 clone 仓库就有这套专家

---

## 7. 持久化语义

| 维度 | TeamCreateTool | create_team |
|---|---|---|
| 跨会话 | ❌ 不应跨会话 | ✅ 永久 |
| 跨项目 | ❌ 写到 `~/.claude/teams/`,只在当前 session 可见 | ✅ 项目级 + 用户级并存,优先级明确 |
| 跨用户/机器 | ❌ | ✅ 项目级随 git 走 |
| git 友好 | ❌ 含 tmuxPaneId、sessionId、cwd | ✅ 纯 JSON + markdown,可入库 |
| 优先级 | 单根(用户级) | managed > user > project(项目最高) |

---

## 8. 资源消耗

### 8.1 TeamCreateTool(典型场景)

- 1 个 lead session + N 个 teammate session
- 每个 teammate 占用一个 tmux pane 或独立进程
- 每个 session 有独立的 token budget、context window、permission context
- **重** —— 适合需要深度独立工作的复杂任务

### 8.2 create_team + `runtime: 'team'`

- 1 个 lead session + N 个 teammate session
- 每个 member 是真实 teammate(独立 session,独立 SendMessage)
- 但没有独立 tmux pane(默认 in-process 模式)
- 子任务共享 caller 的 tool pool、permission context、token budget
- **中** —— 适合"我要让 N 个 agent 真正讨论,产出一个综合方案"

### 8.3 create_team + `runtime: 'single'`

- 1 个 lead 调用 + N 个串行/并行 `runAgent` 子任务(都在同一个 caller session 里跑)
- 没有独立 session、没有 tmux、没有独立 context
- 子任务共享 caller 的 tool pool、permission context、token budget
- **轻** —— 适合"我想要 N 个视角的输出,串成一个回答"

---

## 9. 适用场景

| 场景 | 用哪个 |
|---|---|
| 「让 3 个研究员分别独立调研一个细分领域,3 小时后回来汇报」 | `TeamCreateTool` |
| 「让 6 个领域的专家分别给一段意见,然后拼成一个综合报告」 | `create_team` + `runtime: 'team'` |
| 临时性的 ad-hoc 协作 | `TeamCreateTool` |
| 公司/团队的标准 SOP,谁都要用 | `create_team`(项目级入 git) |
| 需要 teammates 互相讨论、迭代 | `TeamCreateTool` 或 `create_team + runtime: 'team'` |
| 一次性收集多视角,不需要交互 | `create_team + runtime: 'single'` |
| 中途可能要停下来切换、续跑 | `TeamCreateTool`(session resume) |
| 纯声明,不需要"运行中"概念 | `create_team`(create / edit / delete 即可) |
| 需要 tmux pane / worktree 隔离 | `TeamCreateTool` |
| 不希望 leader / member 互相污染 context | `create_team + runtime: 'single'` |
| **重 runAgent 路径、swarms 没开** | `create_team + runtime: 'single'` |

---

## 10. 设计上的取舍

### 10.1 TeamCreateTool 的代价

- 重(每个 member 是独立 session + tmux pane)
- 不能跨会话复用
- 没有 catalog 能力(没有 tags、quickPrompts、categoryId)
- 不能入 git
- **门控**:`isAgentSwarmsEnabled()` 开启才可用,默认不可用
- 资源消耗大,token budget 翻 N 倍

### 10.2 create_team + `runtime: 'team'` 的代价

- **依赖 swarms 启用**:不开就 `status: 'rejected'`
- **leader 系统 prompt 不能改**:team prompt 只能作为 tool result 引导
- **共享 caller 的 token budget**:成员多了容易爆 context
- **每个 member 是独立 expert 目录**:创建团队前必须先 create 好所有 agent
- 仍然没有独立 tmux pane(默认 in-process)

### 10.3 create_team + `runtime: 'single'` 的代价

- **不是真协同**:leader 完成后才跑 members,members 拿不到 leader 的中途输出
- 没有独立 session,不能 resume,不能中途打断
- 共享 caller 的 token budget,成员多了容易爆 context
- 缺乏跨 member 的通信协议

### 10.4 create_team 的优势(整体)

- 轻量(尤其 single)
- 跨会话、跨项目复用,跟代码一起入库
- 完整的 catalog 元数据(tags、quickPrompts、categoryId)便于人工浏览
- 触发简单:`/expert <name>` 一条命令
- WorkBuddy 风格的强校验(描述长度、tags 数量、TODO 占位符、leader 必填等)
- `runtime` 字段允许按场景切换:`auto` 智能选择,`single` 永远轻量,`team` 需 swarms 但真协同

---

## 11. 当前仓库状态

`~/.claude/experts/` 里目前有 **7 个 expert**:

| 类型 | 名称 | 角色 |
|---|---|---|
| agent | toutiao-ops-director | leader |
| agent | toutiao-content-strategist | 内容策略 |
| agent | toutiao-data-analyst | 数据分析 |
| agent | toutiao-growth-specialist | 用户增长 |
| agent | toutiao-monetization-expert | 变现 |
| agent | toutiao-viral-writer | 爆款写作 |
| **team** | **toutiao-ops-team** | 引用上面 6 个,1 leader + 5 members |

`/expert toutiao-ops-team`(自动使用 `runtime: 'team'`)触发:
1. 6 个 member 并行 spawn 成 real teammate(各带 SendMessage)
2. leader 收到包含协调指引的 tool result
3. leader 在后续 turn 用 SendMessage 与 members 沟通
4. 协调完成,leader 综合输出

`/expert toutiao-viral-writer` 触发(agent 类型,`runtime: 'single'`):
1. 单个 expert 直接跑
2. 同步返回结果

跟 TeamCreateTool 跑 6 个独立 teammate session 在能力上对齐,在 catalog / 持久化 / git 友好上更优。

---

## 12. 一句话总结

> **`TeamCreateTool` 是临时的、重的、可通信的多 agent 编排运行时;`ExpertManagerTool.create_team` 是持久的、轻量的、声明式的领域专家目录。**
>
> 通过 `expert:` agentType 的桥接,create_team 调出来的 team 在 `runtime: 'team'` 下能享受 TeamCreateTool 的全部运行时能力,同时保留自己的 catalog / 持久化 / git 优势。
>
> 解决的是不同层的问题 —— 前者解决"这次任务怎么协作",后者解决"我有哪些可复用的角色"。

---

## 13. 桥接架构

桥接由 3 个改动组成,**全部已落地**:

### 13.1 Expert → CustomAgentDefinition 注册

**文件**:`src/tools/AgentTool/loadAgentsDir.ts`

`getAgentDefinitionsWithOverrides` 在 `builtInAgents` / `pluginAgents` / `customAgents` 之后注入 expert 派生项:

```ts
const {listExperts} = await import('../ExpertManagerTool/expertStorage.js')
const expertAgents = await listExperts(undefined, 'agent')
const expertDefs: AgentDefinition[] = expertAgents.map(expert => ({
  agentType: `expert:${expert.name}`,
  whenToUse: <description>,
  tools: ['*'],
  source: 'userSettings',      // passes isCustomAgent() at spawnMultiAgent.ts:881
  baseDir: expert.path,
  getSystemPrompt: () => expert.prompt,
  model: expert.model ?? 'inherit',
  description: <description>,
  omitClaudeMd: false,
}))

const allAgentsList = [
  ...builtInAgents,
  ...pluginAgents,
  ...customAgents,
  ...expertDefs,               // experts last, getActiveAgentsFromList priority applies
]
```

### 13.2 缓存失效钩子

**文件**:`src/tools/ExpertManagerTool/expertStorage.ts`

`writeExpert` / `deleteExpert` 在 `clearExpertsCache()` 之后追加:

```ts
import {clearAgentDefinitionsCache} from '../AgentTool/loadAgentsDir.js'

// writeExpert:
clearExpertsCache()
clearAgentDefinitionsCache()

// deleteExpert:
clearExpertsCache()
clearAgentDefinitionsCache()
```

让新创建的 expert 立即对 Agent tool / spawnTeammate 可见,无需重启进程。

### 13.3 invoke 的 `runtime` 字段

**文件**:`src/tools/ExpertManagerTool/ExpertManagerTool.ts` + `expertRunner.ts`

```ts
case 'invoke': {
  const expert = await readExpert(input.name, scope)
  if (!expert) throw new Error(...)

  const runtime = input.runtime ?? 'auto'
  const resolvedRuntime = runtime === 'auto'
    ? (expert.expertType === 'team' ? 'team' : 'single')
    : runtime

  if (resolvedRuntime === 'team' && !isAgentSwarmsEnabled()) {
    return {data: {action: 'invoke', status: 'rejected', reason: '...'}}
  }

  if (resolvedRuntime === 'single') {
    // existing runExpert / runExpertTeam path
  }

  // resolvedRuntime === 'team' — real teammates
  try {
    return {data: await runExpertTeamReal(expert, ...)}
  } catch (err) {
    await cleanupTeamIfPresent(context, canUseTool)
    throw err
  }
}
```

`runExpertTeamReal` 内部:
1. 调用 `TeamCreateTool.call({team_name, description, agent_type: 'expert:<slug>'})`
2. `Promise.all` 每个 member 调一次 `AgentTool.call({subagent_type: 'expert:<member>', name, team_name, ...})`
3. 返回 tool result,内含 team prompt + member 列表 + 协调指引

### 13.4 端到端数据流

```
ExpertManagerTool.invoke({name: 'toutiao-ops-team', runtime: 'team'})
        │
        ▼
   runExpertTeamReal
        │
        ├─ TeamCreateTool.call()
        │       写 ~/.claude/teams/expert_toutiao-ops-team_xxx/config.json
        │       setLeaderTeamName
        │       resetTaskList + ensureTasksDir
        │
        ├─ Promise.all(
        │     AgentTool.call({subagent_type: 'expert:alpha', team_name, name, prompt})
        │     AgentTool.call({subagent_type: 'expert:beta',  team_name, name, prompt})
        │     ...
        │   )
        │       │
        │       ├─ handleSpawnInProcess 在 activeAgents 里找 expert:alpha
        │       ├─ 找到 expert 派生的 CustomAgentDefinition
        │       ├─ runInProcessTeammate 自动注入:
        │       │     SendMessage, TeamCreate, TeamDelete,
        │       │     TaskCreate, TaskGet, TaskList, TaskUpdate
        │       └─ 系统 prompt = [主] + [TEAMMATE addendum] + [# Custom Agent Instructions\n<expert.prompt>]
        │
        └─ 返回 tool result(content 包含协调指引)
                │
                ▼
        leader (current process) 读取 tool result
                │
                ▼
        主动用 SendMessage 与 members 协调
                │
                ▼
        综合最终答案返回给用户
```

---

## 14. 团队专家 prompt 模板

`runtime: 'team'` 模式下,team expert 的 `prompt` 字段是**协调员指引**,不是系统 prompt 覆盖(lead 系统 prompt 在 CLI 启动时已固定)。所以 team expert prompt 必须写成"协调员视角":

```markdown
You are coordinating a team of N experts to address the user's task.

Members:
- {member1-slug}: {what they do}
- {member2-slug}: {what they do}
- ...

Workflow:
1. Read the original task carefully.
2. Decompose it into N sub-tasks, one per member.
3. Use SendMessage to send each member their sub-task.
4. Collect their responses.
5. Synthesize a unified final answer.
6. If persistTeam was false, TeamDelete will clean up at session end.

Notes:
- Members have SendMessage, TeamCreate, TeamDelete, and Task* tools available.
- You can use TeamDelete yourself if you want to terminate the team early.
- You can use TaskCreate to track your own coordination subtasks.
```

**硬约束**:leader 的系统 prompt 启动后不可改。team prompt 通过 `invoke` 的 tool result 注入,lead 读完主动行为。

---

## 15. 决策树

```
                            ┌─ 需要长期复用 ──→ create_team
                            │
"我有 N 个相关 expert" ──────┤
                            │
                            └─ 临时一次性 ──→ TeamCreateTool

                            ┌─ 需要真协同(讨论/迭代) ──→ create_team + runtime: 'team'
                            │
"需要协同" ─────────────────┤                          或 TeamCreateTool
                            │
                            └─ 一次性多视角够了 ──→ create_team + runtime: 'single'

                            ┌─ swarms 已启用 ──→ create_team + runtime: 'team'
                            │
"环境约束" ─────────────────┤
                            └─ swarms 没开 ──→ create_team + runtime: 'single'
                                                  (不会 reject,但会丢真协同)
```

---

## 附录 A:实现位置

| 工具 | 入口 | 关键文件 |
|---|---|---|
| `TeamCreateTool` | `src/tools/TeamCreateTool/TeamCreateTool.ts` | `src/utils/swarm/teamHelpers.ts` (TeamFile schema) |
| `ExpertManagerTool` | `src/tools/ExpertManagerTool/ExpertManagerTool.ts` | `expertStorage.ts` / `expertRunner.ts` / `expertValidator.ts` |
| 桥接 | `loadAgentsDir.ts` + `expertStorage.ts` + `expertRunner.ts` | (见 §13) |
| `/expert` 命令 | `src/commands/expert/index.ts` → `expert.tsx` | `src/commands.ts` 注册 |

## 附录 B:参考

- [`README.md`](./README.md) — Claude Code vs OpenWorkBuddy 异同速读
- [`side-by-side.md`](./side-by-side.md) — 维度并列对照
- [`feature-matrix.md`](./feature-matrix.md) — 高密度能力勾稽表
- `src/tools/TeamCreateTool/` — 原生 TeamCreate 实现
- `src/tools/ExpertManagerTool/` — 自建 ExpertManager 实现
- `src/commands/expert/` — `/expert` slash command 实现
