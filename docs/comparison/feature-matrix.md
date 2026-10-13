# 功能矩阵（高密度能力勾稽表）

> 评分规则：
> - ✅ 完整实现并运行可用
> - ⚠️ 部分可用（受 flag / 环境变量 / 平台限制）
> - ◼ 存代码但运行时不可达（feature flag 关闭 / ANT-only）
> - ❌ 完全缺失
> - n/a 不适用于该产品定位

详细文档：
- Claude Code：[`claude-code-architecture.md`](./claude-code-architecture.md)
- OpenWorkBuddy：[`openworkbuddy-architecture.md`](./openworkbuddy-architecture.md)
- 详尽对照：[`side-by-side.md`](./side-by-side.md)

---

## 1. 形态与入口

| 能力 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 终端 REPL | ✅（Ink TUI，主界面） | ✅（cli.js REPL，多入口之一） |
| 单次 / pipe | ✅ `-p` | ✅ `--json` NDJSON |
| Web UI | ❌（server 子命令 dead） | ✅ 默认 `127.0.0.1:3800` |
| 桌面 GUI | ❌ | ✅ Electron + 桌面宠物 |
| 移动访问 | ❌ | ✅ iLink 长轮询 + QR 行程卡 |
| SDK / 远程集成 | ✅ `--sdk-url` + `stream-json` | ❌ |
| 多入口共享同一 runtime | n/a（只有 CLI） | ✅（Electron + CLI + Web 共享 server.js） |
| 客户端分发 | npm 包 | Electron 安装包 + Docker + npm CLI |
| 后台常驻 / 调度入口 | ❌ (`--bg` dead) | ✅ Electron + scheduler |

---

## 2. 工具层

### 2.1 通用文件 / shell

| 工具 | Claude Code | OpenWorkBuddy |
|---|---|---|
| Bash 执行 | ✅ BashTool + sandbox + 危险拦截 | ✅ run_shell + mac/win 沙箱 |
| 文件读 | ✅ FileReadTool（PDF/image/notebook） | ✅ read_file / read_document |
| 文件编辑 | ✅ FileEditTool（diff + file history） | ✅ edit_file / multi_edit |
| 文件写 | ✅ FileWriteTool | ✅ write_file |
| Notebook | ✅ NotebookEditTool | ❌ |
| 长任务（shell） | ✅ LocalShellTask | ✅ 后台 shell（shell_output / shell_kill） |
| Sandbox JS / vm | ❌ | ✅ run_node (vm.compileFunction) |
| Sandbox IPC 端口隔离 | 基础 | ✅ 显式 deny 自家 3800 等 |
| Worktree 隔离 | ✅ --worktree + EnterWorktreeTool | ✅ src/agent/worktree.js |
| 危险命令拦截 | ✅ dangerousPatterns | ✅ P5 软护栏 + deny list（无论 tier） |
| 文件投递验证 | ❌ | ✅ `(成功\|✅)` 后文件名必须真在磁盘 |

### 2.2 网络 / 搜索

| 工具 | Claude Code | OpenWorkBuddy |
|---|---|---|
| URL 抓取 | ✅ WebFetchTool | ✅ fetch_url |
| JS 渲染抓取 | ❌ | ✅ chrome_cdp（内置 Chrome） |
| 联网搜索 | ✅ WebSearchTool | ✅ web_search（jina/DDG） |
| 浏览器自动化 | ◼ WebBrowserTool dead | ✅ chrome_cdp |
| URL/IP 守门 | 基础 | ✅ net-guard IP pin |

### 2.3 媒体生成（关键差异）

| 工具 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 文生图 | ❌ | ✅ generate_image |
| 图视觉回读 | ❌ | ✅ look_at_image |
| 文/图生视频 | ❌ | ✅ generate_video |
| 动效 | ❌ | ✅ render_motion |
| TTS | ❌ | ✅ text_to_speech（segments 批） |
| ASR | ❌ | ✅ transcribe_audio |
| HTML 截图 | ❌ | ✅ html_to_image（仅桌面） |
| 视频合成 + 字幕时间轴 | ❌ | ✅ compose_video |
| 图表（柱/折/饼/热力） | ❌ | ✅ echarts |
| 流程图（Mermaid/D2/PlantUML/Dagre/Joint/Viz） | ❌ | ✅ gen_diagram |
| PPTX | ❌ | ✅ pptxgenjs |
| DOCX | ❌ | ✅ docx |
| XLSX | ❌ | ✅ exceljs（含公式） |
| PDF | ❌ | ✅ 间接（外部命令） |
| 短剧画布 | ❌ | ✅ drama-pipeline + 无限画布 |
| 角色一致性 | ❌ | ✅ character-photo-studio skill |
| HTML 单文件 | n/a | ✅ skills/web-styles + html-page |
| QR 码 | ❌ | ✅ qrcode |

### 2.4 协同 / 元工具

| 工具 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 子 agent | ✅ AgentTool + 7 个内置 | ✅ delegate_to_expert |
| 顺序接力 team | ◼ TeamCreate/Delete gated | ✅ 10 支 expert team |
| 并发只读子 agent | ✅（Explore） | ✅ explore（明确并发） |
| 多任务 Task 系统 | ✅ TaskCreate/Get/Update/List | ✅ todo_write + delegate_to_* |
| 用户提问 | ✅ AskUserQuestionTool | ✅ ask_user（带 form 配方） |
| 批量评判 | ❌ | ✅ decide（Jev 模型打分） |
| 计划任务 | ◼ Cron* dead | ✅ schedule_task |
| 一次性任务 + 补跑 | ❌ | ✅ schedule_task |
| 邮件发送 | ❌ | ✅ send_email |
| IM 推送 | ◼ PushNotificationTool dead | ✅ notify_user（飞书/钉钉/WeCom） |
| 文件发到 IM | ◼ SendUserFileTool dead | ✅（含 mp4 压缩 + 封面） |
| 订阅 PR / GitHub 监听 | ◼ SubscribePRTool dead | ❌ |

### 2.5 MCP

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| stdio | ✅ | ✅ |
| streamable-HTTP（SSE） | ✅ | ✅ |
| SSE | ✅ | ✅（含在 streamable-HTTP） |
| WebSocket | ✅ mcpWebSocketTransport | ❌ |
| InProcess | ✅ | ❌ |
| SDK Control | ✅ SdkControlTransport | ❌ |
| vscodeSDK | ✅ vscodeSdkMcp | ❌ |
| OAuth | ✅ auth.ts + xaa.ts + xaaIdpLogin + oauthPort | ✅（IM 内） |
| Elicitation | ✅ elicitationHandler | 未明 |
| 工具缓存 | ✅ | ✅ mcp-tools-cache.json |
| 媒体输出 | 通过返回值 | ✅ 独立目录 .openworkbuddy/mcp-media |
| 协议版本 | 最新 | 2025-06-18 |
| 运行时新增 server | --mcp-config | ✅ add_connector |

### 2.6 内置 skill 数

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 内置 skill | 16（含多个 gated） | 41 |
| 加权可用 skill | ~10 | 41 |
| 加载方式 | 自动注入描述 + lazy use_skill | 自动注入描述 + use_skill |

---

## 3. 多 Agent / 子代理

| 能力 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 内置 agent/expert 类型 | 7 | 42 + 10 team |
| 自定义 agent/expert | ✅ `--agents` JSON + 多目录 | ✅ experts.json + UI |
| Fork 自身 | ✅ --fork-session | ❌（多 session 并存） |
| Async / background | ✅ | ✅（explore 并发） |
| 邮件 / mailbox 通讯 | ✅ teammate.ts 系列（gated） | ❌（用 IM + delegate） |
| Subagent memory | ✅（gated by AGENT_MEMORY_SNAPSHOT） | ✅（共享父记忆） |
| 共享 workspace | n/a | ✅ |
| 顺序接力可见前位产出 | n/a | ✅ expert team |

---

## 4. 记忆系统

| 维度 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 用户手写层 | ✅ CLAUDE.md 四级 | ✅ data/memory.md 共享 |
| Agent 自动层 | ✅ memdir 自动提取 | ✅ memories.json + 向量索引 |
| 加载策略 | 4 级从 cwd 向上遍历 | 单文件 + item list 注入 |
| 容量控制 | 无 | ✅ MAX_TEXT/PER_SCOPE/CHARS |
| Secret 守卫 | ❌ | ✅ SECRET_PATTERNS |
| 误报守卫 | ❌ | ✅ looksStaleClaim |
| 排序公式 | n/a | ✅ hits + user-source + idle/age 衰减 |
| 向量召回 | ❌ | ✅ + Bigram fallback |
| Embedder 变更检测 | n/a | ✅ probe 失败保留旧向量 |
| 跨账户隔离 | n/a（单用户） | ✅ SHARED + per-account 注入 |

---

## 5. Provider

| 供应商 | Claude Code | OpenWorkBuddy |
|---|---|---|
| Anthropic 直连 | ✅ | ✅ |
| AWS Bedrock | ✅ | ❌ |
| Google Vertex | ✅ | ❌ |
| Microsoft Foundry | ✅ | ❌ |
| OpenAI | ❌ | ✅ |
| DeepSeek | ❌ | ✅ OpenAI 兼容 |
| Qwen / 通义千问 | ❌ | ✅ OpenAI 兼容 |
| 智谱 GLM-4 | ❌ | ✅ OpenAI 兼容 |
| 月之暗面 Kimi | ❌ | ✅ OpenAI 兼容 |
| Ollama 本地 | ❌ | ✅ OpenAI 兼容 |
| OpenRouter | ❌ | ✅ OpenAI 兼容 |
| Volcengine Ark | ❌ | ✅ OpenAI 兼容 |
| Gemini | ❌ | ✅ Gemini native |
| 任意 OpenAI 兼容 | ✅ 经 ANTHROPIC_BASE_URL 代理 | ✅ OpenAI 兼容垫片 |
| 二次推理（复用本地订阅） | ❌ | ✅ claude-code.js + codex.js |

---

## 6. 权限 / 安全

### 6.1 档位

| 档位 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 1 | default（弹窗） | plan（仅看不动） |
| 2 | plan（只读） | ask（每步问） |
| 3 | acceptEdits（自动接受编辑） | auto（自动改 + allowlist/denylist） |
| 4 | bypassPermissions（一律过） | full（全自动 + 文件 blocklist + 危险 confirm） |
| 5 | dontAsk（一律拒未列） | — |
| 6 | auto（AI 分类器，**死**） | — |
| 7 | bubble（**ANT-only 死**） | — |

### 6.2 沙箱

| 平台 | Claude Code | OpenWorkBuddy |
|---|---|---|
| macOS | @anthropic-ai/sandbox-runtime | sandbox-exec + 自生成 deny profile |
| Windows | 同上 | owb-sandbox Go IL 降级 |
| Linux | 同上 | ❌（已文档注明） |

### 6.3 其它安全机制

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| Skill 安装审计 | ❌ | ✅ skill-guard |
| 命令 deny 列表 | ✅ dangerousPatterns | ✅ cmd-risk + 大量模式 |
| URL 守门 + IP pin | 基础 | ✅ net-guard |
| Secret 屏蔽 | ❌ | ✅ memory SECRET_PATTERNS |
| Trust dialog | ✅ checkHasTrustDialogAccepted | ✅ approve.js 卡片 5 分钟超时 |
| app_modules deny | ❌ | ✅ config/keys、id_rsa、Keychain |
| 投递验证 | ❌ | ✅ "(成功\|✅)" 后必须真在磁盘 |

---

## 7. 状态持久化 / 会话

| 能力 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 会话存储 | ~/.claude/sessions/（JSONL） | data/sessions/<id>.json |
| Resume 最近 | -c / --continue | -c |
| Resume by id | -r [id] | cli resume <id> |
| Resume from PR | --from-pr | ❌ |
| Fork session | --fork-session | ❌ |
| Resume at message | --resume-session-at | ❌ |
| File history snapshot | ✅ /rewind + --rewind-files | ❌ |
| 会话压缩 | manual /compact + autoCompact + apiMicrocompact + sessionMemoryCompact | ✅ session autosave + migrate + retention |
| Crash recovery | ✅ conversationRecovery | ✅ SSE autosave |
| Cross-project resume | ✅ crossProjectResume / ccshareResume | 多 workspace 并存 |
| 并发会话追踪 | ✅ concurrentSessions | ✅（web 多 tab） |

---

## 8. 自进化 / 反馈

| 能力 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 👍👎 反馈 | ✅ /feedback 但无自学习 | ✅ feedback.json + evolve.js 5 阶段 |
| 信号挖掘 | n/a | ✅ mineSignals（按形态，不按文本） |
| 提议生成 | n/a | ✅ proposeEdits（最小可行 + 验证条款） |
| 闸门否决 | n/a | ✅ gateProposal（证据/重复/预算） |
| 人工批准 | n/a | ✅ decideProposal（**永不自动**） |
| 评分回收 | n/a | ✅ scoreRules（提请退休） |
| 规则上限 | n/a | ✅ rules ≤ 12 / ruleChars ≤ 400 / blockChars ≤ 4000 |
| 证据门槛 | n/a | ✅ minEvidence=3 / minSessions=2 / 14 天 |
| 标签过滤 | n/a | ✅ prompt / config / code（只有 prompt 长成规则） |
| 规则存储 | n/a | ✅ data/learned/<rule> 一文件一规则 |

---

## 9. 调度 / 后台

| 能力 | Claude Code | OpenWorkBuddy |
|---|---|---|
| Cron | ◼ CronCreate/Delete/List dead | ✅ 5 字段 cron + 自定义解析 |
| 一次性任务 | ❌ | ✅ +5m / +2h / +1d / 14:05 / ISO |
| 漏跑补跑 | ❌ | ✅ MAX_CATCHUP_MS 24h |
| 运行历史 | n/a | ✅ 最近 300 条 |
| 触发渠道 | n/a | IM + 内部 |
| 后台 agent 常驻 | ◼ --bg / ps / logs / attach / kill 全 dead | ✅ Electron 主进程 + scheduler |

---

## 10. UI / TUI

| 能力 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 自研 Ink / 终端框架 | ✅ src/ink/ 自研 reconciler + hooks | n/a（CLI 用标准 readline/inquirer 风格） |
| React Compiler | ✅ runtime 注入 | n/a |
| Virtual list | ✅ useSearchHighlight | n/a |
| 桌宠 | ❌ | ✅ desktop_pet |
| 文件浏览器 | n/a（CLI） | ✅ Electron Web UI |
| 画布编辑器 | ❌ | ✅ 无限画布（短剧） |
| 进度卡片 | n/a | ✅ im-card.js 活进度卡 |
| 提问卡片 | ✅ AskUserQuestionTool（带 preview） | ✅ ask_user（带 form 配方） |
| 权限弹窗 | ✅ Ink dialog | ✅ approve.js 卡片（desktop/CLI/IM 通用） |
| 主题/状态行 | ✅ /theme /statusline | n/a |

---

## 11. 远程 / 协作

| 能力 | Claude Code | OpenWorkBuddy |
|---|---|---|
| GitHub PR 监听 | ◼ SubscribePRTool dead | ❌ |
| Webhook 触发 | ❌ | ✅ 通用 webhook POST /im/task |
| 飞书 Bot 长连接 | ❌ | ✅（无需公网 URL） |
| 飞书 HTTP 回调 | ❌ | ✅ |
| 微信 iLink 长轮询 | ❌ | ✅ |
| 企业微信自建应用 | ❌ | ✅ |
| 微信公众号 | ❌ | ✅ |
| 企业微信群机器人 | ❌ | ✅ |
| QQ | ❌ | ✅ |
| 通用 webhook | ❌ | ✅ |
| IM 进度卡推送 | ❌ | ✅ im-card.js |
| IM 附件（含 mp4 压缩） | ❌ | ✅ im-feishu-media.js |
| Slack / Discord | ◼ 仅 install-slack-app | ❌（可用通用 webhook 间接接） |
| Bridge / Remote Control | ◼ claude remote-control / rc dead | ❌ |
| Daemon | ◼ daemon dead | ❌ |

---

## 12. 评估 / 工程化

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 测试运行器 | ❌ 未配置 | ✅ test/all.js + test/e2e.js |
| 测试数 | 0 | 151 |
| Lint | biome lint | ✅ eslint + test/lint.js |
| Type check | ❌（tsc 1341 错误） | ✅ tsconfig.check.json + test/typecheck.js |
| Eval | ❌ | ✅ eval/run.js |
| 健康检查 | bun run health | ✅ doctor 命令 + boot-check |
| Skill hash 校验 | ❌ | ✅ scripts/skill-hashes.js |
| 自动更新 | --update | ✅ src/server/updater.js（只查 GitHub Releases） |

---

## 13. 工程依赖（关键 npm 包对照）

### 13.1 Claude Code 不带的、OWB 用的

| 包 | 用途 |
|---|---|
| `@anthropic-ai/sdk ^0.125.0` | Anthropic SDK（OWB 用同款；Claude Code 改用内部 SDK 包） |
| `docx ^9.0.0` | DOCX 生成 |
| `exceljs ^4.4.0` | XLSX 生成 |
| `pptxgenjs ^3.12.0` | PPTX 生成 |
| `mermaid ^11.17.0` | 流程图 |
| `echarts ^6.1.0` | 数据可视化 |
| `qrcode ^1.5.4` | QR 码 |
| `express ^4.21.0` | HTTP server |
| `nodemailer ^9.1.1` | 邮件 |
| `@larksuiteoapi/node-sdk ^1.72.0` | 飞书 |
| `@dagrejs/dagre ^1.3.x` | 有向图布局 |
| `@joint/core ^4.3.x` | JointJS 图编辑 |
| `@viz-js/viz ^3.29.0` | Graphviz |

### 13.2 Claude Code 用的、OWB 不带的

| 包 | 用途 |
|---|---|
| `@anthropic-ai/bedrock-sdk` | AWS Bedrock |
| `@anthropic-ai/vertex-sdk` | Google Vertex |
| `@anthropic-ai/foundry-sdk` | MS Foundry |
| `google-auth-library` | GCP 认证 |
| `@azure/identity` | Azure 认证 |
| `@anthropic-ai/sandbox-runtime` | 沙箱运行时 |
| `@growthbook/growthbook` | feature flag |
| React Compiler + 自研 Ink | UI 层 |

---

## 14. 文档 / 多语言

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| README | 短 | 极长（特性对照表 + 商用） |
| 中英双语 | ❌ | ✅ README.md + README.en.md + CHANGELOG.{en,}.md |
| 功能清单 | ❌ | ✅ docs/own/功能清单.md |
| 案例 | ✅ docs/案例_贪吃蛇需求工作流程.md | ✅ docs/own/案例.md |
| 路线图 | ❌ | ✅ docs/own/路线图.md + 架构优化路线 |
| 架构详解 | docs/architecture/ | docs/own/代码架构.md + 实现细节.md |
| 安全 | ❌ | ✅ docs/own/安全.md + 安全基线.md |
| 部署 | ❌ | ✅ docs/own/部署.md + install.sh + install-mac.sh |
| 命令行用法 | ❌ | ✅ docs/own/命令行用法.md |
| 评测方法论 | ❌ | ✅ docs/own/评测方法论.md |
| 站点 | ✅ mint.json | ✅ docs/own/index.html + sitemap.xml |

---

## 15. 商业模式 / 部署

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 开源 | 仓库（私有 fork） | ✅ GitHub + 私有分支 |
| 许可证 | 仓库自定 | PolyForm-NC（个人非商用免费，公司商用必买） |
| 商业授权 | n/a | ✅ contact@aijentra.com |
| 商用试用 | n/a | ✅ 30 天免费试用 |
| FDE 驻场服务 | ❌ | ✅ 企业服务 |
| 培训 / 咨询 | ❌ | ✅ |

---

## 16. 主要 dead / 未激活功能（汇总）

### Claude Code 大量 dead（feature-flag 关闭 + ANT-only）

```
KAIROS、AGENT_TRIGGERS、AGENT_TRIGGERS_REMOTE、BG_SESSIONS、
BRIDGE_MODE、DAEMON、DIRECT_CONNECT、SSH_REMOTE、FORK_SUBAGENT、
PROACTIVE、VOICE_MODE、WORKFLOW_SCRIPTS、ULTRAPLAN、UDS_INBOX、
HISTORY_SNIP、CONTEXT_COLLAPSE、REACTIVE_COMPACT、TRANSCRIPT_CLASSIFIER、
WEB_BROWSER_TOOL、MONITOR_TOOL、TERMINAL_PANEL、OVERFLOW_TEST_TOOL、
KAIROS_GITHUB_WEBHOOKS、KAIROS_PUSH_NOTIFICATION、KAIROS_BRIEF、
KAIROS_CHANNELS、SEND_USER_FILE_TOOL、CCR_REMOTE_SETUP、CCR_MIRROR、
BUDDY、TORCH、LODESTONE、MCP_SKILLS、AGENT_MEMORY_SNAPSHOT、
EXPERIMENTAL_SKILL_SEARCH、UPLOAD_USER_SETTINGS、ABLATION_BASELINE
```

外加 ANT-only（USER_TYPE === 'ant'）：
```
SuggestBackgroundPRTool、REPLTool、ConfigTool、TungstenTool
+ 大量 ANT-only slash 命令
```

### OpenWorkBuddy dead / 缺失

- 不显式有"dead code"，但 plugin 目录里未列举内置 vs git source
- 自动更新只查 GitHub Releases（已确认）
- Langfuse tracing 默认关

---

## 17. 一句话定位（终极对照）

| 项目 | 一句话 |
|---|---|
| Claude Code | 给开发者用的、terminal 优先的、文件改动的 AI 编码助手 |
| OpenWorkBuddy | 给办公族用的、桌面 + IM 优先的、文件交付的 AI 工作助理 |

两者几乎在所有维度都恰好互补。

---

## 18. 借鉴建议速查表

### 对 Claude Code 最有价值的 OWB 设计

| # | 设计 | 价值 | 难度 |
|---|---|---|---|
| 1 | 5 阶段自进化（永不自动 + 硬上限） | 极高 | 中 |
| 2 | Skill-guard（含中文 prompt injection） | 高 | 低 |
| 3 | 双层记忆（含 Secret + 向量 + 排序） | 高 | 中 |
| 4 | IM 全渠道（IM 进度卡 + 附件） | 取决于定位 | 高 |
| 5 | 投递验证（产物落盘） | 中 | 低 |
| 6 | form 配方 ask_user（多问答合一） | 中 | 低 |
| 7 | decide + Jev 评分模型 | 中 | 低 |

### 对 OpenWorkBuddy 最有价值的 Claude Code 设计

| # | 设计 | 价值 | 难度 |
|---|---|---|---|
| 1 | `/rewind` + 文件历史快照 | 高 | 中 |
| 2 | `from-pr` / `cross-project resume` | 中 | 中 |
| 3 | Hooks（pre/post tool）通用框架 | 高 | 低 |
| 4 | Bedrock/Vertex/Foundry 多云 | 中 | 中 |
| 5 | `--json-schema` Zod 结构化输出 | 高 | 低 |
| 6 | `--output-format stream-json` | 中 | 低 |
| 7 | LSP 集成 | 中 | 中 |
| 8 | 5 档权限细分（acceptEdits 等） | 中 | 低 |
| 9 | `--worktree` 开发会话隔离 | 中 | 中 |
| 10 | MCP 多传输（WebSocket / InProcess / SdkControl） | 中 | 高 |
