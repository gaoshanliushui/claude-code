# 详尽异同对照表（Claude Code vs OpenWorkBuddy）

> 两个项目**定位完全不同**：
> - **Claude Code**：开发者的 terminal 编码助手（修改代码、跑 bash、抓网页）。
> - **OpenWorkBuddy**：办公工作者的桌面 + IM + Web 办公助理（产出能打开的文件：pptx / docx / xlsx / html / mp4）。
>
> 本对照目的是把"双方都能做 / 只有一边能做 / 形式类似但实质不同"梳成可读清单，便于学习借鉴。

---

## 0. 总览

| 维度 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 版本 | 2.2.0 | 0.13.1 |
| 形态 | CLI（interactive REPL + pipe） | Electron 桌面 + CLI + Web（HTTP server `127.0.0.1:3800`） + 6 路 IM |
| 入口文件 | `src/entrypoints/cli.tsx` | `electron-main.js`（桌面）/ `cli.js` / `server.js` |
| 运行时 | Bun | Node.js 18+ |
| 语言 | TypeScript / TSX（React `react-jsx`） | CommonJS（无构建步骤）+ Electron 前端（少量前端代码在 `public/`） |
| 工作目录 | 强制 cwd | workspace / projects / tenants 可切换 |
| 部署 | 单文件 Bun 打包 ~25MB，npm | Electron 安装包（mac/win）+ Docker（`deploy/`、`deploy.sh`） |
| 许可 | 此 fork 私有 / 仓库 `claude-js` | PolyForm-NC（个人非商用免费，公司商用买授权） |
| 定位 | **代码** | **文件交付** |

---

## 1. 形态与入口

| 项 | Claude Code | OpenWorkBuddy | 对照评注 |
|---|---|---|---|
| 桌面 UI | ❌ 无 | ✅ Electron + 桌面宠物 | OWB 多了"会说话"的桌面宠物 |
| TUI（终端） | ✅ REPL（`REPL.tsx` ~5373 行） | ✅ CLI REPL（`cli.js`） | 形式类似，但 Claude Code 主 UI，OWB 是多个入口之一 |
| Web UI | ❌ 无（server 子命令 dead） | ✅ 默认 `127.0.0.1:3800` | OWB 多了 Web 入口 |
| Pipe / 单次 | ✅ `-p` 单 turn，`--output-format` | ✅ `--json` NDJSON 事件流 | OWB CLI 也有 `-p` 风格单次 |
| SDK 远程 | ✅ `--sdk-url` + stream-json（隐藏） | ❌ 无 | Claude Code 这个 hook 给 SDK 集成的 |
| IM 远程 | ❌ 全部 dead（`assistant`/`bridge`/`rc` 等 gated） | ✅ 飞书 / 微信 iLink / WeCom 自建 / WeCom bot / 微信公众号 / QQ / 通用 webhook（7 路） | **OWB 强大得多** |
| 移动/扫码访问 | ❌ 无 | ✅ 行程卡 QR、内置 iLink 长轮询 | |
| 自启动后台 | ❌ `--bg` dead（`BG_SESSIONS` gated） | ✅ Electron app + 计划任务 `scheduler.js` | |
| Bash-only 部署 | ✅（设计目标） | ✅（CLI + server） | 都能 |

---

## 2. 工具集对比

### 2.1 文件 / shell / 代码类

| 工具 | Claude Code | OpenWorkBuddy | 评注 |
|---|---|---|---|
| Bash / shell | ✅ `BashTool`（沙箱、危险命令拦截、后台任务） | ✅ `run_shell`（macOS `sandbox-exec`、Windows Go 沙箱） | 都有；沙箱实现细节略不同 |
| 文件读 | ✅ `FileReadTool`（含 PDF / 图片 / notebook） | ✅ `read_file` / `read_document`（长结果溢出到磁盘） | |
| 文件编辑 | ✅ `FileEditTool`（带文件历史快照 + diff） | ✅ `edit_file` / `multi_edit` | Claude Code 的 `/rewind` 强；OWB 的 multi_edit 批量 |
| 文件写 | ✅ `FileWriteTool`（带 diff） | ✅ `write_file` | |
| Notebook | ✅ `NotebookEditTool` | ❌ 无 | Claude Code 独有 |
| Glob / Grep | ✅ ripgrep via `GlobTool` / `GrepTool` | ✅ `list_files` / `search_files` / `find_files` | |
| 沙箱 JS | ❌ | ✅ `run_node`（`vm.compileFunction`） | **OWB 独有**，靠它生成 PPT/Excel 等 |
| 长任务 | ✅（`LocalShellTask` / `LocalAgentTask`） | ✅ 后台 shell + 异步视频 job + worktree 隔离 | |
| Worktree | ✅ `--worktree` / `EnterWorktreeTool`（env-gated） | ✅ `src/agent/worktree.js`（并行任务自动分分支） | |
| 执行监督 | ✅ 危险命令拦截 `dangerousPatterns.ts` + 沙箱 | ✅ 4 档权限 + P5 软护栏（`cmd-risk.js`） + deny list | |

### 2.2 网络与搜索

| 工具 | Claude Code | OpenWorkBuddy | 评注 |
|---|---|---|---|
| URL 抓取 | ✅ `WebFetchTool`（Markdown + AI 摘要） | ✅ `fetch_url`（带 JS 渲染）+ `chrome_cdp`（无远程 URL） | OWB 多了 CDP 渲染 |
| 联网搜索 | ✅ `WebSearchTool`（域名过滤） | ✅ `web_search`（jina，fallback DDG） | |
| 浏览器控制 | ❌ 全部 dead（`WebBrowserTool` gated） | ✅ `chrome_cdp`（用内置 Chrome） | **OWB 独有** |
| 域名 / IP 守卫 | ✅ 基础 | ✅ `net-guard.js` 显式 pin 防 DNS rebinding | OWB 更细 |

### 2.3 媒体 / 办公交付（最关键差异）

| 工具 | Claude Code | OpenWorkBuddy | 评注 |
|---|---|---|---|
| 文生图 | ❌ 无 | ✅ `generate_image` + `look_at_image` 视觉回读 | **OWB** |
| 图生视频 | ❌ 无 | ✅ `generate_video` | **OWB** |
| TTS | ❌ 无 | ✅ `text_to_speech`（segments 批） | **OWB** |
| ASR | ❌ 无 | ✅ `transcribe_audio`（Whisper 等） | **OWB** |
| HTML 截图 | ❌ 无 | ✅ `html_to_image`（仅桌面） | **OWB** |
| 视频合成 | ❌ 无 | ✅ `compose_video`（ffmpeg） + 字幕时间轴 | **OWB** |
| 图表（柱/折/饼/热力图） | ❌ 无 | ✅ echarts ^6.1.0 + `data-viz` skill | **OWB** |
| 流程图（Mermaid/D2/PlantUML/Dagre/Joint/Viz） | ❌ 无 | ✅ `gen_diagram`（多种引擎） | **OWB** |
| PPTX 生成 | ❌ 无 | ✅ `pptxgenjs ^3.12.0` + `ppt-design` skill | **OWB** |
| DOCX 生成 | ❌ 无 | ✅ `docx ^9.0.0` + `docx` skill | **OWB** |
| XLSX 生成 | ❌ 无 | ✅ `exceljs ^4.4.0` + `excel-report` skill（公式不写死） | **OWB** |
| PDF 生成 | ❌ 无 | ✅ 间接（wkhtmltopdf / Chrome / docx→pdf，外部命令） | **OWB** |
| QR 码 | ❌ 无 | ✅ `qrcode ^1.5.4`（行程卡） | **OWB** |
| SVG | ❌ 无 | ✅ `gen_diagram` 同时输出 PNG + SVG（IM 丢 SVG） | **OWB** |
| PPT 渲染回验 | ❌ | ✅ 投递验证：`(生成成功|✅)` 后文件名**必须真在磁盘** | **OWB 独有** |

### 2.4 协同 / 元工具

| 工具 | Claude Code | OpenWorkBuddy | 评注 |
|---|---|---|---|
| 子代理 | ✅ `AgentTool`（fork / async / background）+ 7 个内置 agent | ✅ `delegate_to_expert` / `delegate_to_team` / `explore` | 同形不同体；OWB "team" 是顺序接力 |
| 团队 / 多 agent | ⚠️ `TeamCreateTool`/`TeamDeleteTool`（受 `isAgentSwarmsEnabled` 控制） | ✅ 10 支 expert team（顺序接力，成员可见前位产出） | OWB 用结构化团队 |
| Task 状态机 | ✅ `TaskCreate/Get/Update/List/Stop/Output`（受 `isTodoV2Enabled` 控制） | ✅ `todo_write` + `delegate_to_*` + 多 round | 命名不同 |
| 用户提问 | ✅ `AskUserQuestionTool`（可附预览） | ✅ `ask_user`（含 form 配方：promo-video / xhs-carousel / multi-post） | OWB 还支持"决定" decide（评分模型 Jev） |
| 时间调度 | ❌ 全部 dead（`CronCreateTool` 等 gated by `AGENT_TRIGGERS`） | ✅ `schedule_task` + cron 解析器 + 一次性 + 漏跑补 | **OWB 强** |
| 邮件 | ❌ 无 | ✅ `send_email`（收件人白名单 + 必审批） | **OWB** |
| 桌面通知 / 推送 | ❌ 全部 dead（`PushNotificationTool`、`SendUserFileTool` gated） | ✅ 飞书/钉钉/WeCom bot `notify_user` + IM 进度卡 | **OWB** |
| 文件发送 | ❌ 全部 dead | ✅ IM 自带附件（含 mp4 压缩 + 封面） | **OWB** |
| 桌面宠物 | ❌ | ✅ `desktop_pet`（思考/问询/空闲 状态） | **OWB** |

### 2.5 MCP（两边都有，深度差异）

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| Client 实现 | `src/services/mcp/`（24 文件 ~12000 行） | `src/agent/mcp.js`（1142 行） |
| 传输 | stdio / SSE / streamable-HTTP / WebSocket / InProcess / SDK Control / vscodeSDK | stdio / streamable-HTTP（带 SSE） |
| OAuth | ✅（`auth.ts`/`xaa.ts`/`xaaIdpLogin.ts`/`oauthPort.ts`） | ✅（在 IM 通道里有企业身份 / 飞书） |
| Elicitation | ✅ `elicitationHandler.ts` | 未明列，可能含 |
| 协议版本 | 最新 | 固定 `2025-06-18` |
| 工具缓存 | ✅ | ✅ `mcp-tools-cache.json` |
| 媒体输出 | 通过工具返回值 | **独立落盘** `.openworkbuddy/mcp-media/` |
| 运行时新增 | `--mcp-config` | ✅ `add_connector` 工具运行时增 |
| Channel（KAIROS） | 死代码 | n/a |
| 评估覆盖 | 丰富（多传输 + OAuth + CLI add/remove/list/get） | 较窄 |

---

## 3. Skills / 命令系统

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 内置 skill 数 | 16（`batch` / `claudeApi` / `claudeInChrome` / `debug` / `keybindings` / `loop` / `loremIpsum` / `remember` / `scheduleRemoteAgents` / `simplify` / `skillify` / `stuck` / `updateConfig` / `verify` / `verifyContent`；多个 gated） | 41 |
| 加载 | lazy（`loadSkillsDir.ts`）+ 描述注入系统提示 | lazy（`use_skill` 显式加载）+ 描述注入系统提示 |
| 路径 | `~/.claude/skills/`、`.claude/skills/`、plugin | `skills/`（bundle）+ `dataDir/skills/`（用户）+ git URL（`install_skill`） |
| 安全审计 | 无（无 guard） | ✅ `skill-guard.js`（fork bomb、`dd`、浏览器密码、外泄域名、`curl -T`、通配 `allowed-tools`、中文"忽略上面的指令"等） |
| 安装来源 | 本地目录 / plugin | bundle / drop-in / git URL |
| 自带 skill 类型 | **运维与协作**（debug、stuck、simplify、keybindings、loop、updateConfig、verify） | **办公交付**（ppt / docx / xlsx / data-viz / video / audio / 内容运营 / 招聘 / SEO / 周报 / 会议纪要 / 小红书 / 公众号 …） |

### 3.1 Claude Code 内置 skill 示例

| Skill | 用途 |
|---|---|
| `batch` | 批量任务 |
| `claudeApi` | 使用 Claude API |
| `debug` | 调试辅助 |
| `keybindings` | 自定义快捷键 |
| `loop` | 循环任务 |
| `remember` / `skillify` | 记忆 + 把操作固化为 skill |
| `simplify` | 简化代码 |
| `stuck` | 卡死时的脱困 |
| `updateConfig` | 改 config 的元 skill |
| `verify` / `verifyContent` | 验证 |

### 3.2 OpenWorkBuddy 内置 skill 示例（按类别）

| 类别 | Skill |
|---|---|
| 内容创作 | `content-studio`、`content-reproduce`（拼凑重写）、`wechat-article`、`xhs-cards`、`xhs-carousel`、`xiaohongshu-topic`、`multi-post`、`podcast`（文字稿）、`support-scripts` |
| 文档演示 | `ppt-design`、`docx`、`excel-report` |
| 数据 | `data-analysis`、`data-viz`（echarts）、`financial-model` |
| 研究 | `deep-research`、`competitor-watch`、`market-research`、`seo-brief` |
| 工作流 | `meeting-minutes`、`weekly-report`、`triage`、`recruiting`、`contract-review`、`customer-feedback`、`sales-outreach`、`email-draft`、`prd`、`project-plan` |
| 网页视觉 | `web-styles`、`html-page`、`infographic`、`brand-kit`（品牌档案）、`cover-card` 风格 |
| 视频 | `promo-video`、`video-compose`、`short-drama`、`character-photo-studio`（角色一致性） |
| 飞书生态 | `lark-cli`、`feishu-doc` |
| 元工具 | `skill-creator`（创建 skill 的 skill） |

---

## 4. 多 agent / 子代理机制

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 内置代理类型 | 7（`general-purpose`、`statusline-setup`、`Explore`、`Plan`、`claude-code-guide`、`verification`） | 42 个 named expert（9 类）+ 10 支 team |
| 自定义 | ✅ `--agents <json>` / `~/.claude/agents/` / `.claude/agents/` / plugin agents | ✅ 添加 expert（`experts.json` + UI） |
| 分发 | 一句话委派子代理；async / fork / background | `delegate_to_expert`（单）；`delegate_to_team`（顺序接力） |
| Fork 自身 | ✅ `--fork-session` | ❌（但 multiple sessions in parallel） |
| 并发子代理 | ✅ | ✅ **同 turn 内多次 `explore` 并发**（只读） |
| 共享工作目录 | ❌（worktree 隔离） | ✅ **共享 workspace**（agent 内），worktree 隔离在并行 task 上 |
| 子 agent memory | ✅ `AGENT_MEMORY_SNAPSHOT`（gated） | ✅ 子 agent 共享父记忆 |
| 团队通道（mailbox） | ✅（`teammate.ts` / `teammateMailbox.ts` / `teammateContext.ts`，大多 gated） | ❌ 无（用 `notify_user` IM + `delegate`） |
| Task 工具 | ✅ 多 | ✅ 通过 `todo_write` + `delegate_to_*` 隐式 |

**评注**：Claude Code 的"swarm"机制在源码里存在但运行死；OWB 的"team"是完全设计过的，把接力顺序、可见前位产出当成产品体验。

---

## 5. 记忆系统（关键对照）

| 维度 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 设计哲学 | **文件层级 + 自动提取**（CLAUDE.md 体系） | **双层：手写共享 + agent 写按账户** |
| 用户手写层 | ✅ `~/.claude/CLAUDE.md` + 项目 `.claude/CLAUDE.md` + `.claude/rules/*.md` + `CLAUDE.local.md` | ✅ `data/memory.md`（全局共享） |
| Agent 自动层 | ✅ `src/memdir/` 自动提取（`extractMemories/`）+ `auto_continue_rounds` | ✅ `data/memories.json` + 向量索引 `memory_vectors.json` |
| 加载发现 | 4 级优先级，从 cwd 向上遍历；`@include` 指令 | 单文件 + item list 注入 |
| 过滤机制 | `--setting-sources` 用户/项目/本地 | SHARED scope + 当前账户 scope（防跨账户泄漏） |
| 容量控制 | 无显式上限 | `MAX_TEXT=400`、`MAX_PER_SCOPE=120`、`MAX_PROMPT_CHARS=6000` |
| Secret 守卫 | 无 | ✅ `SECRET_PATTERNS` 屏蔽 key/token/密码 |
| 误报守卫 | 无 | ✅ `looksStaleClaim` 阻止误固化为事实 |
| 排序 | 无显式 | `min(hits,20)*2 + (source==user?12:0) - idleDays/10 - ageDays/120` |
| 检索 | 全文加载 | 向量召回 + 中文 Bigram fallback |
| Embedder 变更检测 | n/a | ✅ probe 后失败保留旧向量 |
| 命中簿记 | n/a | ✅ `pendingHits` 20s flush |

**评注**：OWB 的记忆是显式工程化的（容量、Secret、排序、向量）；Claude Code 的更轻，依靠文件 + 自动提取。

---

## 6. 多 LLM Provider

| 供应商 | Claude Code | OpenWorkBuddy |
|---|---|---|
| Anthropic 直连 | ✅ 默认 | ✅ |
| AWS Bedrock | ✅ `CLAUDE_CODE_USE_BEDROCK=1` | ❌ |
| Google Vertex AI | ✅ `CLAUDE_CODE_USE_VERTEX=1` | ❌ |
| Microsoft Foundry（Azure） | ✅ `CLAUDE_CODE_USE_FOUNDRY=1` | ❌ |
| OpenAI（含 GPT-5） | ❌ | ✅ 直连 OpenAI |
| DeepSeek | ❌ | ✅ OpenAI 协议兼容 |
| 通义千问（DashScope） | ❌ | ✅ OpenAI 协议兼容 |
| 智谱 GLM-4 | ❌ | ✅ OpenAI 协议兼容 |
| 月之暗面 Kimi | ❌ | ✅ OpenAI 协议兼容 |
| Ollama 本地 | ❌ | ✅ OpenAI 协议兼容（`localhost:11434/v1`） |
| OpenRouter | ❌ | ✅ OpenAI 协议兼容 |
| Volcengine Ark | ❌ | ✅ OpenAI 协议兼容 |
| Gemini | ❌ | ✅ Gemini native |
| 任意 OpenAI 兼容 | ✅ 走 `ANTHROPIC_BASE_URL` 代理 | ✅ OpenAI 兼容垫片 |
| 二次推理（"Engines"） | n/a | ✅ `engines/claude-code.js` + `engines/codex.js`（复用本地订阅） |

**评注**：Claude Code 专注 Claude 系列 + 4 大云；OWB 是真正的"模型无关"，任何兼容协议都能挂。

---

## 7. 权限 / 安全

### 7.1 权限档位

| Claude Code | OpenWorkBuddy |
|---|---|
| `default`（未列弹窗） | n/a |
| `plan`（只读） | `plan`（只看不动） |
| `acceptEdits`（自动接受编辑） | n/a |
| `bypassPermissions`（一律过） | `full`（全自动） |
| `dontAsk`（一律拒未列） | n/a |
| `auto`（AI 分类器，**死**） | `auto`（自动改文件 + 命令 allowlist/denylist） |
| `bubble`（ANT-only，**死**） | `ask`（每步都问） |

**评注**：档位思路不同。Claude Code 是 7 档但 4 档死，OWB 是 4 档全活，且都按"读 vs 写 vs 命令"二维组合。

### 7.2 沙箱

| 平台 | Claude Code | OpenWorkBuddy |
|---|---|---|
| macOS | `@anthropic-ai/sandbox-runtime`（via `sandbox-adapter.ts`） | `sandbox-exec` + 自生成 deny-list profile（realpath 处理 `/tmp`） |
| Windows | 同上 | Go 二进制 `owb-sandbox` 降 Integrity Level |
| Linux | 同上 | ❌ 不沙箱（文档注明） |
| 自家端口 | — | 显式 deny 自家 IPC port |
| URL 守门 | 基础 | ✅ `net-guard.js` IP pin 防 DNS rebinding |
| 命令守门 | `dangerousPatterns.ts` 启发式 | ✅ P5 软护栏 + deny list + 危险命令 confirm（无论哪档） |

### 7.3 关键安全机制

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| Skill 安装审计 | 无 | ✅ `skill-guard.js` 静态审计（含中文 prompt injection 模式） |
| MCP connector 验证 | 较丰富（OAuth、elicitation） | 基础 |
| Secret 屏蔽 | 无 | ✅ 记忆 SECRET_PATTERNS |
| Trust dialog | ✅ `checkHasTrustDialogAccepted` | ✅ 桌面/IM 5 分钟 `approve.js` 卡片 |
| 投递验证 | n/a | ✅ "(生成成功|✅)" 后文件名必须真在磁盘 |
| Push/Pull 隔离 | n/a | ✅ `app_modules` deny（config、pem、id_rsa、Keychain） |

---

## 8. 交互模式 / Slash 命令

### 8.1 Claude Code 50+ slash 命令（30+ 活）

活：`/add-dir` `/clear` `/compact` `/config` `/context` `/copy` `/cost` `/diff` `/doctor` `/effort` `/exit` `/export` `/extra-usage` `/fast` `/feedback` `/files` `/heapdump` `/help` `/hooks` `/ide` `/init` `/install-github-app` `/install-slack-app` `/keybindings` `/login` `/logout` `/mcp` `/memory` `/mobile` `/model` `/output-style` `/passes` `/permissions` `/plan` `/plugin` `/pr-comments` `/privacy-settings` `/rate-limit-options` `/release-notes` `/reload-plugins` `/rename` `/resume` `/review` `/ultrareview` `/rewind` `/sandbox-toggle` `/security-review` `/session` `/skills` `/stats` `/status` `/statusline` `/stickers` `/tasks` `/theme` `/think-back` `/upgrade` `/usage` `/insights` `/vim`

死的（flag）：`/voice` `/proactive` `/brief` `/assistant` `/bridge` `/workflows` `/ultraplan` `/peers` `/fork` `/buddy` `/force-snip` `/subscribe-pr` `/web-setup` `/torch` `/remote-control-server`

ANT-only（也死）：`/tag` `/backfill-sessions` `/break-cache` `/bughunter` `/commit` `/commit-push-pr` `/ctx_viz` `/good-claude` `/issue` `/init-verifiers` `/mock-limits` `/bridge-kick` `/version` `/reset-limits` `/onboarding` `/share` `/summary` `/teleport` `/ant-trace` `/perf-issue` `/env` `/oauth-refresh` `/debug-tool-call` `/agents-platform` `/autofix-pr`

### 8.2 OpenWorkBuddy CLI 子命令

`sessions` `resume` `engines` `doctor` `pair` `passwd` `2fa` `owner` `jev` `workflow` `review` `worktree` `completion`

自定义 slash 命令：`.openworkbuddy/commands/<name>.md` 或 `~/.openworkbuddy/commands/<name>.md`，支持 `$ARGUMENTS` / `$1..$9`。

**评注**：两边都有"slash 命令"概念，但 OWB 子命令比 Claude Code 的少；OWB 选了**桌面工作流 + 文件交付**，所以日常交互不走 slash 走图形。

---

## 9. 状态持久化 / 会话恢复

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 会话文件 | `~/.claude/sessions/`（JSONL） | `data/sessions/<session>.json`（按 turn） |
| 恢复 | `-c`、`-r [id]`、`--fork-session`、`--from-pr`、`--resume-session-at` | `cli.js resume <id>` / Web UI 选 |
| 文件历史快照 | ✅ `fileHistory.ts` + `/rewind` + `--rewind-files` | ❌（无 `/rewind` 概念，但 session autosave） |
| 压缩 | manual `/compact` + autoCompact + apiMicrocompact + sessionMemoryCompact | session 自动备份 + 迁移（`migrate.js`）+ retention |
| Continue | `--continue` | `-c` |
| Crash recovery | ✅ `conversationRecovery.ts` | ✅ `data/sessions/` autosave，SSE autosave |
| Cross-project resume | ✅ `crossProjectResume.ts` / `ccshareResume.ts` | ✅ 多 workspace 并存 |
| 并发会话追踪 | ✅ `concurrentSessions.ts` | ✅（浏览器多 tab + multi-tenant） |

**评注**：Claude Code 的"rewind" + "from-pr" + "cross-project"是开发者专用强项；OWB 的 autosave + retention 适合长跑交付。

---

## 10. 自进化

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 👍👎 进自进化 | ❌ 无 | ✅ 5 阶段：`mineSignals → proposeEdits → gateProposal → decideProposal → scoreRules` |
| 证据门槛 | n/a | `minEvidence=3`、`minSessions=2`、14 天窗口 |
| 规则上限 | n/a | `rules ≤ 12`、`ruleChars ≤ 400`、`blockChars ≤ 4000` |
| 分类 | n/a | `prompt \| config \| code`（只有 prompt 长成规则） |
| 反馈存储 | n/a | `data/feedback.json`（最近 2000 条）+ per-turn 上下文 |
| 自动应用 | n/a | **永不自动**（人必须批） |

**评注**：这是 OWB 的真正差异化能力；Claude Code 没有对应的机制。

---

## 11. 调度 / 后台

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| Cron | ❌ dead（`AGENT_TRIGGERS`） | ✅ 5 字段 cron + 自定义解析 |
| 一次性任务 | ❌ | ✅ `+5m` / `+2h` / `+1d` / `14:05` / `2026-09-19 14:05` |
| 漏跑补跑 | ❌ | ✅ `MAX_CATCHUP_MS` 24h |
| 运行历史 | n/a | ✅ 最近 300 条 |
| 触发渠道 | n/a | IM + 系统内部 |
| 后台 agent | `--bg` dead（`BG_SESSIONS`） | ✅ Electron app + 计划任务 |

---

## 12. 评估 / 测试

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 测试运行器 | ❌ 未配置 | ✅ `node test/all.js`、`test/e2e.js` |
| 测试目录 | ❌ | ✅ `test/`（151 项） |
| Lint | ❌ | ✅ `eslint.config.js` + `test/lint.js` |
| Type check | ❌ | ✅ `test/typecheck.js` + `tsconfig.check.json` |
| Eval | ❌ | ✅ `eval/run.js` |
| Skill hashes | ❌ | ✅ `scripts/skill-hashes.js` |
| 评测方法论 | ❌ | ✅ `docs/评测方法论.md` |
| Health check | ✅ `bun run health` | ✅ `doctor` 命令 + `cli.js doctor` |

---

## 13. 文档成熟度

| 项 | Claude Code | OpenWorkBuddy |
|---|---|---|
| README | 短 | 极长（含对照表、商用授权） |
| docs/ | 主题分类（agent / architecture / context / hook / mcp / memory / msg / other / own / permission / repl / skill / spec / tool） | 主题（自己的 own/ + alternatives/ + 推广/）+ 中英双 README |
| 功能清单 | ❌ | ✅ `docs/own/功能清单.md` |
| 案例 | `docs/案例_贪吃蛇需求工作流程.md` | ✅ `docs/own/案例.md` |
| 路线图 | ❌ | ✅ `docs/own/路线图.md` + `架构优化路线_2026-08.md` |
| 安全基线 | ❌ | ✅ `docs/own/安全.md` + `安全基线.md` |
| 部署 | ❌ | ✅ `docs/own/部署.md` + `install.sh` + `install-mac.sh` |
| 多语言 | 单语 | 中 / 英双 README + 双 CHANGELOG |
| 兼容性 / 命令行用法 | ❌ | ✅ `docs/own/命令行用法.md` |
| 架构详解 | ✅ 在源码注释 + docs/ | ✅ `docs/own/代码架构.md` + `实现细节.md` |

---

## 14. 关键差异要点（一句话）

| # | 维度 | 一句话 |
|---|---|---|
| 1 | 交付物 | Claude Code：代码改动；OWB：能打开的文件 |
| 2 | 形态 | Claude Code：纯 CLI；OWB：桌面 + Web + 6 路 IM + CLI |
| 3 | 媒体生成 | Claude Code：无；OWB：图 / 视频 / TTS / ASR / 视频合成 全 |
| 4 | MCP | 双方都有；Claude Code 多传输 + OAuth 更完整；OWB 允许运行时新增 |
| 5 | 记忆 | Claude Code：CLAUDE.md 体系；OWB：双层 + 向量 + Secret 守卫 |
| 6 | 权限 | Claude Code：5 活 + 2 死；OWB：4 档全活 |
| 7 | Provider | Claude Code：4 大云 + Anthropic；OWB：Anthropic + OpenAI 兼容 8+ 家 |
| 8 | 自进化 | Claude Code：无；OWB：5 阶段硬上限规则 |
| 9 | 调度 | Claude Code：全部 dead；OWB：cron + 一次性 + 漏跑补 |
| 10 | IM | Claude Code：全部 dead；OWB：6 渠道完整 |
| 11 | 团队 | Claude Code：swarm 死代码；OWB：10 支顺序接力 team |
| 12 | 桌宠 | Claude Code：无；OWB：Electron desktop pet |
| 13 | 画布 | Claude Code：无；OWB：无限画布（短剧 / 故事板） |
| 14 | 评估 | Claude Code：无；OWB：完整 test + lint + typecheck + e2e + eval |
| 15 | 安全审计 | Claude Code：基础；OWB：skill-guard + 命令守门 + URL IP pin + Secret |
| 16 | 多租户 | Claude Code：单用户；OWB：多 org / RBAC / license |
| 17 | 投递验证 | Claude Code：无；OWB：磁盘真在才能继续 |
| 18 | 工作目录模型 | Claude Code：单 cwd；OWB：workspace / projects / tenants |

---

## 15. 可借鉴清单（Claude Code 视角）

| OWB 能力 | 借鉴难度 | 借鉴价值 |
|---|---|---|
| 双层记忆（含 Secret 守卫、向量） | 中 | 高 |
| 5 阶段自进化（卡控 + 永不自动） | 中 | 高 |
| Skill-guard（含中文 prompt injection 模式） | 低 | 高 |
| Skill-站场：办公交付 skill 库 | 高（要攒 skill） | 中（看用户群体） |
| `add_connector` MCP 运行时增 | 低 | 中 |
| 投递验证（产物落盘） | 低 | 中 |
| 4 档权限（OWB 风格） | 中 | 中（Claude Code 已有 5 档，思路不同） |
| IM 全渠道 | 高 | 看产品定位 |
| 视频 / 图像 / TTS 工具 | 极高 | 取决于方向 |
| 多租户 / org / license | 高 | 看是否做 SaaS |

## 16. 可借鉴清单（OpenWorkBuddy 视角）

| Claude Code 能力 | 借鉴难度 | 借鉴价值 |
|---|---|---|
| LSP 集成（env-gated） | 中 | 中（编码 agent 专用） |
| 多 Provider 路由（Bedrock/Vertex/Foundry） | 中 | 中 |
| `--worktree`/`tmux` 开发会话隔离 | 中 | 高 |
| `/rewind` + `--resume-session-at` | 低 | 高（OWB 没有） |
| File history snapshots | 中 | 中 |
| 5 档权限细分（含 acceptEdits） | 低 | 中 |
| Hooks 系统（pre/post tool） | 低 | 高（OWB 没有通用 hook 框架） |
| 跨项目 resume / from-pr | 中 | 中 |
| MCP OAuth 流程（含 xaaIdpLogin） | 高 | 中 |
| 危险命令启发式（dangerousPatterns） | 低 | 中 |
| `--output-format stream-json` | 低 | 中（脚本化集成） |
| Zod `--json-schema` 结构化输出 | 低 | 高 |
