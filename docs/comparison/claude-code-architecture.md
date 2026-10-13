# Claude Code（当前代码库）架构档案

> 数据来源：`/Users/zhouquan/project/ai/agent/coding/claude-code/`
> 版本：`2.2.0`（`src/entrypoints/cli.tsx:6`）
> 运行时：Bun；构建：`bun build src/entrypoints/cli.tsx --outdir dist --target bun`
> 模块系统：ESM + TSX（`react-jsx`）
> 形态：CLI（interactive REPL）+ 管道模式 + WebSocket SDK 模式

> **重要背景**：这是 Anthropic Claude Code CLI 的反编译/降级版。
> `feature()` 永远返回 `false`，所有功能开关分支在运行时都是死代码；
> `process.env.USER_TYPE === 'ant'` 也从不成立，ANT-only 路径同样失效。

---

## 1. 定位与目标用户

| 项 | 内容 |
|---|---|
| 定位 | 面向开发者的 terminal AI 编码助手 |
| 主要交付 | 文件改动（编辑/创建）、bash 执行结果、网页抓取摘要 |
| 用户群体 | 软件工程师 |
| 部署形态 | 单文件 Bun 打包（`dist/cli.js` ~25MB），npm 分发 |
| 工作目录绑定 | 强制依赖当前项目目录 |

---

## 2. 工具清单（`src/tools/` 与 `src/tools.ts`）

### 2.1 始终启用的工具

| 工具 | 文件 | 功能 | UI |
|---|---|---|---|
| `BashTool` | `tools/BashTool/BashTool.tsx` | Shell 执行，支持沙箱、权限解析、`dangerousPatterns` 检测、后台任务 | `UI.tsx` + `BashToolResultMessage.tsx` |
| `FileReadTool` | `tools/FileReadTool/` | 读文件 / PDF / 图片 / Jupyter | `UI.tsx` |
| `FileEditTool` | `tools/FileEditTool/` | 字符串替换编辑，含 diff 追踪、文件历史快照、LSP 诊断 | `UI.tsx` |
| `FileWriteTool` | `tools/FileWriteTool/` | 创建/覆写文件，diff 生成 | `UI.tsx` |
| `NotebookEditTool` | `tools/NotebookEditTool/` | Jupyter notebook cell 编辑 | `UI.tsx` |
| `WebFetchTool` | `tools/WebFetchTool/` | URL → Markdown → AI 摘要 | `UI.tsx` |
| `WebSearchTool` | `tools/WebSearchTool/` | 联网搜索（带域名过滤） | `UI.tsx` |
| `AgentTool` | `tools/AgentTool/AgentTool.tsx` | 子代理派发（fork / async / background / remote）。7 个内置代理（`general-purpose`, `statusline-setup`, `Explore`, `Plan`, `claude-code-guide`, `verification`） | `UI.tsx` |
| `AskUserQuestionTool` | `tools/AskUserQuestionTool/` | 交互式多选题提示（可附预览） | inline |
| `SkillTool` | `tools/SkillTool/` | 名称调用 slash commands / skills | `UI.tsx` |
| `EnterPlanModeTool` / `ExitPlanModeV2Tool` | `tools/EnterPlanModeTool/` | Plan 模式（编辑前只读探索） | inline |
| `TodoWriteTool` | `tools/TodoWriteTool/` | 会话内 todo 列表（v1） | inline |
| `BriefTool` | `tools/BriefTool/` | 短消息 + 附件发送 | inline |
| `GlobTool` / `GrepTool` | `tools/GlobTool/`, `tools/GrepTool/` | ripgrep 实现路径/内容搜索 | `UI.tsx` |
| `MCPTool`（动态） | `tools/MCPTool/` | 每个 MCP server tool 注册为一个 | `UI.tsx` |
| `ListMcpResourcesTool` / `ReadMcpResourceTool` | `…/` | 列举/读取 MCP 资源 | inline |
| `McpAuthTool` | `tools/McpAuthTool/` | MCP OAuth 流程 | inline |
| `SendMessageTool` | `tools/SendMessageTool/` | 发送给 peers/teammates/mailbox（lazy require） | inline |
| `TaskOutputTool` / `TaskStopTool` | `…/` | 读后台任务输出 / 停止 | inline |
| `SyntheticOutputTool` | `tools/SyntheticOutputTool/` | 非交互模式结构化输出 | n/a |
| `TeamCreateTool` / `TeamDeleteTool` | `…/` | 创建/销毁 teammate 组（受 `isAgentSwarmsEnabled` 控制） | inline |

### 2.2 条件启用

| 工具 | 条件 | 行为 |
|---|---|---|
| `TaskCreateTool` / `TaskGetTool` / `TaskUpdateTool` / `TaskListTool` | `isTodoV2Enabled()` | Todo v2 任务系统（默认未启用） |
| `EnterWorktreeTool` / `ExitWorktreeTool` | `isWorktreeModeEnabled()` | Git worktree 创建/退出 |
| `PowerShellTool` | `isPowerShellToolEnabled()`（Windows 检测） | Windows shell |
| `LSPTool` | `ENABLE_LSP_TOOL=1` | LSP-aware 编辑（含 format、symbol） |
| `ToolSearchTool` | `isToolSearchEnabledOptimistic()` | 工具很多时延迟加载 |

### 2.3 Feature-flag-gated（在当前构建内**全部死**）

| 工具 | flag | 备注 |
|---|---|---|
| `SleepTool` | `PROACTIVE` / `KAIROS` | |
| `CronCreateTool` / `CronDeleteTool` / `CronListTool` | `AGENT_TRIGGERS` | |
| `RemoteTriggerTool` | `AGENT_TRIGGERS_REMOTE` | |
| `MonitorTool` | `MONITOR_TOOL` | |
| `SendUserFileTool` | `KAIROS` | |
| `PushNotificationTool` | `KAIROS` / `KAIROS_PUSH_NOTIFICATION` | |
| `SubscribePRTool` | `KAIROS_GITHUB_WEBHOOKS` | |
| `OverflowTestTool` | `OVERFLOW_TEST_TOOL` | |
| `CtxInspectTool` | `CONTEXT_COLLAPSE` | |
| `TerminalCaptureTool` | `TERMINAL_PANEL` | |
| `WebBrowserTool` | `WEB_BROWSER_TOOL` | |
| `SnipTool` | `HISTORY_SNIP` | |
| `ListPeersTool` | `UDS_INBOX` | |
| `WorkflowTool` | `WORKFLOW_SCRIPTS` | |
| `SuggestBackgroundPRTool` / `REPLTool` | `USER_TYPE === 'ant'` | |

### 2.4 存根工具（目录存在但未注册）

- `ReviewArtifactTool/`、`DiscoverSkillsTool/`
- `SnipTool/`（重复）

---

## 3. 架构子系统

### 3.1 入口与启动

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/entrypoints/cli.tsx` | 短 | **真入口**。注入 polyfill（`feature() => false`、`MACRO`、`BUILD_TARGET`、`BUILD_ENV`），处理 `--version`/`--bg`/`--bare`/`--worktree` 等 fast path，把真正工作分派出去 |
| `src/entrypoints/init.ts` | 短 | 一次性初始化（telemetry、config、trust dialog） |
| `src/main.tsx` | ~4600 行 | Commander.js CLI 定义：解析 args → 加载 settings/auth/analytics → 分派 REPL 或 pipe 模式 |

### 3.2 查询循环与 API 层

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/query.ts` | ~1743 | 核心 query 函数：流式响应、tool-call 循环、token 计数、错误处理 |
| `src/QueryEngine.ts` | ~1341 | 高阶编排：会话状态、压缩、文件历史快照、attribution、turn 元数据 |
| `src/services/api/claude.ts` | ~3424 | 请求构造、Anthropic SDK 流式端点、事件处理、prompt caching、microcompact |
| `src/services/api/client.ts` | 中 | Provider 客户端工厂（Anthropic / Bedrock / Vertex / Foundry） |
| `src/services/api/bootstrap.ts` | 中 | 拉取 first-party bootstrap 数据 |

### 3.3 状态管理

| 文件 | 职责 |
|---|---|
| `src/state/AppState.tsx` | 中央 app state 类型 + Context Provider |
| `src/state/store.ts` | Zustand 风格 store |
| `src/state/selectors.ts` | memoized selectors |
| `src/bootstrap/state.ts` | 模块级 singleton：session ID、CWD、project root、token 总数、model 覆盖 |

### 3.4 UI 层（Ink）

- `src/ink.ts` — `ThemeProvider` 注入包装
- `src/ink/` — 自研 Ink 内核：reconciler、hooks（`useInput` / `useTerminalSize` / `useSearchHighlight`）、virtual list
- `src/components/` — 约 150 个 React 组件（`App.tsx`、`Messages.tsx`、`MessageRow.tsx`、`PromptInput/`、`permissions/`、`mcp/` 等）
- `src/screens/REPL.tsx` ~5373 行 — REPL 主屏：输入、消息呈现、权限弹窗、键盘快捷键
- `src/screens/ResumeConversation.tsx` — 恢复会话选择器
- `src/screens/Doctor.tsx` — 自检展示

**注意点**：组件带 React Compiler runtime（`react/compiler-runtime`），反编译输出在各处有 `_c(N)` memoization 调用——这是正常的，不可视为 bug。

### 3.5 MCP 支持（`src/services/mcp/`）

共 24 文件，约 12000 行：

- `client.ts` — 主 MCP client（stdio / SSE / streamable-HTTP 传输）
- `MCPConnectionManager.tsx` — 连接生命周期
- `config.ts` — 配置文件解析（`.mcp.json`、`--mcp-config`）
- `claudeai.ts` — Anthropic-managed MCP configs
- `auth.ts` / `xaa.ts` / `xaaIdpLogin.ts` / `oauthPort.ts` — OAuth 流程
- `elicitationHandler.ts` / `InProcessTransport.ts` / `SdkControlTransport.ts` / `vscodeSdkMcp.ts` / `mcpWebSocketTransport.ts` — 传输变体
- `channelAllowlist.ts` / `channelNotification.ts` / `channelPermissions.ts` — 通道支持（KAIROS，死）

### 3.6 Skills 系统（`src/skills/`）

- `bundledSkills.ts` — 内置 skill 注册表
- `loadSkillsDir.ts` — 从 `~/.claude/skills/`、`.claude/skills/`、plugin 目录加载
- `bundled/` — 内置 skill：`batch` / `claudeApi` / `claudeInChrome` / `debug` / `keybindings` / `loop` / `loremIpsum` / `remember` / `scheduleRemoteAgents` / `simplify` / `skillify` / `stuck` / `updateConfig` / `verify` / `verifyContent`（多个受 flag 控制）
- 支持 `path:` / `phase:`（pre/post tool use）事件

### 3.7 Hooks（`src/utils/hooks.ts` + `src/utils/hooks/`）

事件：`PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `SessionStart` / `SessionEnd` / `Stop` / `SubagentStop` / `Notification` / `PreCompact` 等。

- 在 `settings.json` `hooks` key 配置
- 支持 shell：`bash` / `zsh` / `PowerShell`
- 插件托管 hooks（`getHooksConfigFromSnapshot`）
- 每工具权限 hooks（`src/hooks/toolPermission/`）
- 通知子系统（`src/hooks/notifs/`）

### 3.8 子代理 / Tasks / Teams

- `src/tools/AgentTool/` — 子代理运行器（local/remote、async、fork、summary、agent memory）
- `src/tasks/LocalShellTask/` / `LocalAgentTask/` / `RemoteAgentTask/`（remote 受 gate）
- `src/utils/teammate.ts` / `teammateMailbox.ts` / `teammateContext.ts` — 大多受 `isAgentSwarmsEnabled` 控制
- `src/utils/swarm/` — swarm 协调（多数受 gate）

### 3.9 Compaction（`src/services/compact/`）

| 文件 | 状态 |
|---|---|
| `compact.ts` | ✅ 手动 / API compact |
| `autoCompact.ts` | ✅ 上下文压力触发自动压缩 |
| `apiMicrocompact.ts` | ✅ 服务端 microcompact（beta） |
| `reactiveCompact.ts` | ❌ 受 `REACTIVE_COMPACT` 控制 |
| `sessionMemoryCompact.ts` | ✅ session 记忆提取压缩 |
| `contextCollapse/` | ❌ 受 `CONTEXT_COLLAPSE` 控制 |

### 3.10 权限（`src/utils/permissions/`）

权限模式（`PermissionMode.ts`）：

| 模式 | 含义 |
|---|---|
| `default` | 未列入规则的工具弹窗询问 |
| `plan` | 只读，禁止修改 |
| `acceptEdits` | 自动接受文件修改，其余弹窗 |
| `bypassPermissions` | 一律通过（`--dangerously-skip-permissions`） |
| `dontAsk` | 一律拒绝未列入 |
| `auto` | AI 分类器决策（`TRANSCRIPT_CLASSIFIER`，**死**） |
| `bubble` | ANT-only |

核心文件：
- `permissions.ts` ~1486 行 — 权限规则引擎
- `bashClassifier.ts` / `yoloClassifier.ts` — 命令分类（auto 模式）
- `pathValidation.ts` / `filesystem.ts` — 路径 / FS 权限
- `PermissionRule.ts` / `PermissionResult.ts` / `PermissionUpdate.ts` — 类型
- `dangerousPatterns.ts` — 危险命令启发式
- `denialTracking.ts` / `autoModeDenials.ts` — 拒绝追踪
- `src/hooks/useCanUseTool.tsx` — 每个工具调用前的中央 hook
- 委托给 MCP 工具： `--permission-prompt-tool`

### 3.11 认证（`src/services/oauth/` + `src/utils/auth.ts`）

- Claude subscription OAuth（`oauth/client.ts`）
- API key（env / Keychain / `apiKeyHelper`）
- AWS / GCP credential prefetch
- macOS Keychain（`utils/secureStorage/`）
- `authPortable.ts` / `authFileDescriptor.ts` — Linux / Windows 变体

### 3.12 分析 / 遥测（框架在；sink 空）

- `services/analytics/`：first-party event logger、GrowthBook、sink
- `isAnalyticsDisabled()`：当 `NODE_ENV=test`、Bedrock/Vertex/Foundry，或隐私级别为 no-telemetry/essential 时为 true
- Datadog sink：代码在，stub
- Sentry：`SentryErrorBoundary.ts` 仅组件存在
- GrowthBook：真实 client，但因 `feature()` 永远 false 不会下发
- OTEL：列在 `package.json` deps，但运行时未连接

### 3.13 其他子系统

- `src/memdir/` — 自动记忆提取（`extractMemories/`）
- `src/services/MagicDocs/` — Magic Docs（多视为 stub）
- `src/services/SessionMemory/` — session 记忆状态
- `src/services/tips/tipRegistry.ts` — tip of the day
- `src/services/policyLimits/` — org policy 强制
- `src/services/remoteManagedSettings/` — 远程配置同步
- `src/utils/sandbox/sandbox-adapter.ts` — bash 沙箱
- `src/utils/fileHistory.ts` — per-file 编辑历史（`/rewind`）
- `src/utils/git.ts` / `gitDiff.ts` / `github/` — git 操作、PR 状态、`gh` 认证
- `src/utils/lsp/` — LSP helpers
- `src/keybindings/` — 用户可自定义键绑定
- `src/outputStyles/` — 自定义输出风格

---

## 4. CLI 子命令与顶层 flag

### 4.1 子命令（`src/main.tsx`）

| 子命令 | 状态 | 来源 |
|---|---|---|
| `claude`（默认 REPL/print） | ✅ 活 | `main.tsx:1252-…` |
| `claude mcp`（`serve` / `add` / `remove` / `list` / `get` / `add-json` / `add-from-claude-desktop` / `reset-project-choices`） | ✅ 活 | `main.tsx:4085-4144` |
| `claude auth login`/`status`/`logout` | ✅ 活 | `main.tsx:4291-4322` |
| `claude plugin`（`validate`/`list`/`install`/`uninstall`/`enable`/`disable`/`update`） | ✅ 活 | `main.tsx:4339-4446` |
| `claude plugin marketplace`（`add`/`list`/`remove`/`update`） | ✅ 活 | `main.tsx:4362-4397` |
| `claude setup-token` | ✅ 活 | `main.tsx:4458` |
| `claude agents` | ✅ 活 | `main.tsx:4469` |
| `claude doctor` | ✅ 活 | `main.tsx:4537` |
| `claude update` / `upgrade` | ✅ 活 | `main.tsx:4553` |
| `claude install [target]` | ✅ 活 | `main.tsx:4586` |
| `claude completion <shell>` | ✅ 活 | `main.tsx:4683` |
| `claude server` | ❌ 死（`DIRECT_CONNECT`） | `main.tsx:4153` |
| `claude ssh <host> [dir]` | ❌ 死（`SSH_REMOTE`） | `main.tsx:4237` |
| `claude open <cc-url>` | ❌ 死（`DIRECT_CONNECT`） | `main.tsx:4250` |
| `claude auto-mode`（`defaults`/`config`/`critique`） | ❌ 死（`TRANSCRIPT_CLASSIFIER`） | `main.tsx:4480-4500` |
| `claude remote-control` / `rc` | ❌ 死（`BRIDGE_MODE`+`DAEMON`） | `main.tsx:4514` |
| `claude assistant [sessionId]` | ❌ 死（`KAIROS`） | `main.tsx:4526` |
| `claude rollback` / `up` / `log` / `error` / `export` / `task` | ❌ ANT-only | `main.tsx:4573-4672` |

### 4.2 顶层 flag（精选）

活：
```
-p / --print              管道模式
--output-format           text | json | stream-json
--input-format            text | stream-json
--json-schema             Zod 风格结构化输出
--include-hook-events     SSE 输出 hook events
--include-partial-messages 增量 message events
--replay-user-messages    重放用户消息
--model <model>           指定模型
--fallback-model          失败 fallback 模型
--betas <betas...>        启用 beta headers
--effort <level>          low / medium / high / max
--agent <agent>           选内置代理
--agents <json>           自定义代理定义
--permission-mode <mode>  default/plan/acceptEdits/bypassPermissions/dontAsk
--dangerously-skip-permissions
--thinking <mode>         enabled/adaptive/disabled
--max-thinking-tokens
--max-turns
--max-budget-usd
--agent-budget
-c / --continue           续最近会话
-r / --resume [id]        按 id 恢复（可选 picker）
--fork-session            恢复但开新 id
--from-pr                 从 PR 链接恢复
--resume-session-at <msgId>
--rewind-files <userMsgId> 恢复到指定消息时的文件状态
--add-dir <dirs...>
--allowedTools / --disallowedTools / --tools
--mcp-config <cfg>
--strict-mcp-config
--permission-prompt-tool 委托给 MCP tool
--system-prompt / --system-prompt-file
--append-system-prompt / --append-system-prompt-file
--settings / --setting-sources / --plugin-dir
--ide / --chrome / --no-chrome
--session-id / -n / --name / --no-session-persistence
--debug / -d [filter]
--debug-to-stderr / --debug-file / --verbose
--mcp-debug (已弃用)
--file <specs...>
--init / --init-only / --maintenance (hook 触发)
--prefill <text>
--sdk-url <url>
--bare / CLAUDE_CODE_SIMPLE=1
-w / --worktree [name] / --tmux
--teleport / --remote / --remote-control / --rc
--hard-fail / --disable-slash-commands
```

ANT-only 或死 flag：
```
--advisor
--delegate-permissions
--dangerously-skip-permissions-with-classifiers
--afk
--tasks [id]
--agent-teams
--enable-auto-mode
--proactive
--messaging-socket-path
--brief
--assistant
--channels <servers...>
--dangerously-load-development-channels <servers...>
--agent-id / --agent-name / --team-name / --agent-color
--plan-mode-required
--parent-session-id
--teammate-mode
--agent-type
--workload <tag>
```

### 4.3 Slash 命令（`src/commands/`）

50+ 个注册。其中 **17 个左右** 受 flag gate 而死：

活的有：
```
/add-dir, /clear, /compact, /config, /context, /copy, /cost, /diff, /doctor,
/effort, /exit, /export, /extra-usage, /fast, /feedback, /files, /heapdump,
/help, /hooks, /ide, /init, /install-github-app, /install-slack-app,
/keybindings, /login, /logout, /mcp, /memory, /mobile, /model, /output-style,
/passes, /permissions, /plan, /plugin, /pr-comments, /privacy-settings,
/rate-limit-options, /release-notes, /reload-plugins, /rename, /resume,
/review, /ultrareview, /rewind, /sandbox-toggle, /security-review, /session,
/skills, /stats, /status, /statusline, /stickers, /tasks, /theme,
/think-back, /upgrade, /usage, /insights, /vim
```

死的（feature-flag）：
```
/voice (VOICE_MODE)
/proactive (PROACTIVE/KAIROS)
/brief (KAIROS/KAIROS_BRIEF)
/assistant (KAIROS)
/bridge (BRIDGE_MODE)
/workflows (WORKFLOW_SCRIPTS)
/ultraplan (ULTRAPLAN)
/peers (UDS_INBOX)
/fork (FORK_SUBAGENT)
/buddy (BUDDY)
/force-snip (HISTORY_SNIP)
/subscribe-pr (KAIROS_GITHUB_WEBHOOKS)
/web-setup (CCR_REMOTE_SETUP)
/torch (TORCH)
/remote-control-server (DAEMON+BRIDGE_MODE)
```

ANT-only（也死）：
```
/tag, /backfill-sessions, /break-cache, /bughunter, /commit, /commit-push-pr,
/ctx_viz, /good-claude, /issue, /init-verifiers, /mock-limits, /bridge-kick,
/version, /reset-limits, /onboarding, /share, /summary, /teleport, /ant-trace,
/perf-issue, /env, /oauth-refresh, /debug-tool-call, /agents-platform,
/autofix-pr
```

---

## 5. LLM 供应商

| 供应商 | 触发 | 实现 |
|---|---|---|
| Anthropic First-Party | 默认 | `@anthropic-ai/sdk` |
| AWS Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` | `@anthropic-ai/bedrock-sdk` |
| Google Vertex AI | `CLAUDE_CODE_USE_VERTEX=1` | `@anthropic-ai/vertex-sdk` + `google-auth-library` |
| Microsoft Foundry (Azure) | `CLAUDE_CODE_USE_FOUNDRY=1` | `@anthropic-ai/foundry-sdk` + `@azure/identity` |
| Proxy | `ANTHROPIC_BASE_URL` 环境变量 | 自定义 baseURL |

工厂在 `src/services/api/client.ts` 的 `getAnthropicClient()`；凭据刷新见 `utils/auth.ts`。

---

## 6. 输出 / 交互模式

| 模式 | 触发 | 说明 |
|---|---|---|
| Interactive REPL | 默认 `claude` | Ink TUI，键盘驱动，完整的输入+权限+消息 UI |
| Pipe / Print (`-p`) | `claude -p "..."` | Headless，单 turn（`--max-turns` 控多 turn），遵循 `--output-format` |
| Programmatic (SDK) | `--sdk-url <url>` 加 `-p` + `stream-json` | 远程 WebSocket SDK I/O streaming（隐藏） |
| Streamed JSON | `--print --output-format stream-json` | stdout 实时事件 |
| Structured Output | `--json-schema` | Zod 风格 schema 校验 |
| Bare | `--bare` / `CLAUDE_CODE_SIMPLE=1` | 最小模式：无 hooks、无 LSP、无 plugins、无 attribution、无 auto-memory、无 keychain |
| Server / SSH / Open / RC / Assistant / BG / Auto-mode / Daemon / Self-hosted runner / Templates | — | 全部 dead |

---

## 7. 内存 / 上下文加载

### 7.1 CLAUDE.md 发现（`src/utils/claudemd.ts`）

四级优先级，反向加载（越近 cwd 优先级越高）：

1. Managed memory — `/etc/claude-code/CLAUDE.md`（系统级 admin）
2. User memory — `~/.claude/CLAUDE.md`（私人全局）
3. Project memory — 项目根目录的 `CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/*.md`，向上遍历到文件系统根
4. Local memory — 项目根的 `CLAUDE.local.md`（项目私有）

### 7.2 机制

- User memory：从 home 目录
- Project/Local：从 cwd 向上遍历
- `@include` 指令（`@path`、`@./rel`、`@~/abs`、`@/abs`）— 递归包含，有循环保护，不存在的文件静默忽略
- Frontmatter 解析在 `src/utils/frontmatterParser.ts`（path overrides、scoping）
- settings sources 过滤：`--setting-sources`（user / project / local）

### 7.3 Auto Memory（`src/memdir/`）

- `paths.ts` — auto-memory 路径解析
- `memdir.ts` — entrypoint 截断
- `extractMemories/` — 长会话中的自动记忆提取

### 7.4 上下文构造（`src/context.ts` + `src/utils/context.ts`）

- `getSystemContext()` — git status、date、CLAUDE.md、env、cwd、add dirs、memory
- `getUserContext()` — 用户身份（缓存于 `bootstrap/state.ts`）
- `getContextWindowForModel()` — 模型特定窗口大小

---

## 8. 权限 / 安全细节

### 8.1 模式（重复列于 §3.10）

`default` / `plan` / `acceptEdits` / `bypassPermissions` / `dontAsk` / `auto`（死）/ `bubble`（ANT-only）

### 8.2 批准流程

- `src/hooks/useCanUseTool.tsx` — 每个 tool 调用的中央 hook
- 权限请求在 Ink 弹窗中渲染
- 规则引擎（`src/utils/permissions/permissions.ts`）— 合并 settings/project/local 来源的 allow/deny/ask 规则
- Shell 规则匹配（`shellRuleMatching.ts`）— `Bash(git:*)` / `Bash(npm run:*)` 模式
- 路径校验（`pathValidation.ts` / `filesystem.ts`）— cwd、add dirs、read-only
- 分类器（`bashClassifier.ts` / `yoloClassifier.ts`）— auto mode 语义分类（死）
- 工具注册时按 deny rules 过滤（`filterToolsByDenyRules` 在 `tools.ts`）

### 8.3 安全护栏

- `dangerousPatterns.ts` — 启发式危险命令检测
- `BashTool/destructiveCommandWarning.ts` — 破坏性操作前警告
- 沙箱（`@anthropic-ai/sandbox-runtime` via `utils/sandbox/sandbox-adapter.ts`）— per-platform bash 沙箱
- Trust dialog（`checkHasTrustDialogAccepted`）— 交互模式下管理 git hooks / untrusted 执行

---

## 9. 状态持久化

### 9.1 会话与历史

- 会话保存到 `~/.claude/sessions/`（JSONL transcript）
- `src/utils/sessionStorage.ts` — 存/读、transcript 路径、agent transcript
- `src/utils/sessionRestore.ts` — 恢复处理
- `src/utils/conversationRecovery.ts` — 崩溃恢复 & 损坏 transcript 检测

### 9.2 恢复与续接

- `-c` / `--continue` — 续 cwd 最近会话
- `-r` / `--resume [id]` — 按 id 恢复或 picker
- `--fork-session` — 恢复但新 id
- `--from-pr` — 按 PR 链接恢复
- `--resume-session-at <msgId>` — 恢复到指定消息
- `--rewind-files <userMsgId>` — 还原到指定消息时的文件状态并退出

### 9.3 File-history 快照（`src/utils/fileHistory.ts`）

- FileEditTool / FileWriteTool 期间按文件生成快照
- `/rewind` 用它还原
- `useFileHistorySnapshotInit.ts` hook 初始化

### 9.4 其它状态文件

- `~/.claude/settings.json` — 全局配置
- `.claude/settings.json`、`.claude/CLAUDE.md`、`.claude/rules/*.md` — 项目配置 / 记忆
- `.mcp.json` — 项目 MCP 服务器
- 插件缓存（`src/utils/plugins/`）
- 策略限制缓存
- bootstrap data 缓存

---

## 10. 关键文件路径索引

| 关注点 | 路径 |
|---|---|
| 入口 / 启动 | `src/entrypoints/cli.tsx`、`src/main.tsx`、`src/entrypoints/init.ts` |
| 查询循环 | `src/query.ts`、`src/QueryEngine.ts` |
| API | `src/services/api/claude.ts`、`src/services/api/client.ts` |
| 工具注册 | `src/tools.ts`、`src/tools/` |
| Provider | `src/utils/model/providers.ts` |
| 权限 | `src/utils/permissions/permissions.ts`、`PermissionMode.ts` |
| State | `src/state/AppState.tsx`、`src/state/store.ts`、`src/bootstrap/state.ts` |
| UI | `src/screens/REPL.tsx`、`src/components/`、`src/ink/` |
| MCP | `src/services/mcp/` |
| 记忆 | `src/utils/claudemd.ts`、`src/memdir/` |
| Skills | `src/skills/` |
| Hooks | `src/utils/hooks.ts`、`src/utils/hooks/` |
| 压缩 | `src/services/compact/` |
| Sessions | `src/utils/sessionStorage.ts`、`src/utils/sessionRestore.ts` |
| 存根 | `packages/@ant/`、`packages/*-napi/` |
