# OpenWorkBuddy 架构档案

> 数据来源：`/Users/zhouquan/project/ai/agent/general/openworkbuddy/`
> 版本：`0.13.1`（`package.json`）
> 运行时：Node.js 18+；CommonJS（无构建步骤）
> 形态：Electron 桌面 + CLI（`cli.js`）+ Web UI（`server.js` 3800 端口）+ 6 路 IM 客户端
> 许可：PolyForm-Noncommercial 1.0.0（个人非商用免费，公司或商用必须购买商业授权）

> **定位**：跑在你自己电脑上的 AI 办公助理。一句话进去，它自己规划、动手、验收，把 PPT / Word / Excel / 网页落到你硬盘上。**给你的是能打开的文件，不是一段聊天记录。**

---

## 1. 定位与目标用户

| 项 | 内容 |
|---|---|
| 定位 | 本地优先的 AI 办公助理 |
| 主要交付 | 文件：`.pptx` / `.docx` / `.xlsx` / `.pdf` / `.html` / `.png` / `.mp4` / `.mp3` 等 |
| 用户群体 | 知识工作者 / 办公室白领 / 内容运营 / 营销 / 销售（不只开发者） |
| 部署形态 | Electron 桌面 + npm 全局 CLI + 本地 HTTP server（默认 `127.0.0.1:3800`） |
| 工作目录绑定 | 每个会话有 workspace（每个项目分独立空间）；多租户隔离 |

---

## 2. 工具清单

### 2.1 核心文件 / shell / 代码工具（`src/agent/tools.js`）

| 工具 | 功能 |
|---|---|
| `run_node` | 在 `vm.compileFunction` sandbox 中跑 JS；PPT/Word/Excel/图表生成的主力 |
| `run_shell` | 跑 shell 命令；macOS 用 `sandbox-exec`，Windows 用 `native/owb-sandbox` Go 二进制 |
| `shell_output` / `shell_kill` | 读长跑命令输出 / kill |
| `write_file` / `edit_file` / `multi_edit` | workspace 内写/追加/编辑 |
| `read_file` / `read_document` | 读文件；长结果溢出到 `.openworkbuddy/tool-results/*.txt` |
| `list_files` / `search_files` / `find_files` | workspace 文件列举 |
| `todo_write` | 进度清单（`PROGRESS.md` 格式），用作防止早停的闸门 |
| `check_page` | 验证 HTML 页（外部资源、console 错误） |
| `save_skill` / `install_skill` | 添加新 skill 目录（自带 git URL 安装） |
| `add_connector` | 持久化新 MCP server 并重连 |
| `library_list` / `library_read` / `library_import` | 个人/团队知识库 |
| `fetch_url` | HTTP 抓取，可选 JS 渲染 |
| `chrome_cdp` | 通过 CDP 用内置 Chrome（无远程 URL） |
| `web_search` | 联网搜索（provider=jina，fallback DuckDuckGo） |
| `gen_diagram` | 渲染 Mermaid/Graphviz/D2/PlantUML 等到 PNG/SVG |

**总计 ~37 个内置工具**（定义在 `src/agent/tools.js:272-...` 与 `src/agent/agent.js:70-335`）。

### 2.2 媒体生成工具（`src/tools/` + `core/model/media-models.js`）

| 工具 | 功能 |
|---|---|
| `generate_image` | 文生图，支持参考图 |
| `look_at_image` | 生成/上传图像的视觉回读 |
| `generate_video` | 文/图生视频 |
| `render_motion` | 动态图形 / 动画帧 |
| `text_to_speech` | TTS，支持 `segments` 批模式 |
| `transcribe_audio` | ASR（Whisper 等） |
| `html_to_image` | URL 或 HTML 字符串截图到 PNG（仅桌面端） |
| `compose_video` | 拼接片段、时间轴、字幕到 MP4（ffmpeg） |
| `canvas_manage` | 读写"无限画布"图（脚本 → 角色 → 场景 → 故事板 → 镜头 → 图像 → 视频 → 音频 → 时间轴 节点） |

### 2.3 协调器 / 元工具（`src/agent/agent.js:70-345`）

| 工具 | 功能 |
|---|---|
| `delegate_to_expert` | 派生子智能体（指定 expert，共享 workspace） |
| `delegate_to_team` | 运行整支 expert team 流水线（成员顺序接力，可见前位产出） |
| `explore` | 只读并行子智能体（不可改文件、不可 ask_user），可并发 |
| `ask_user` | 强制提问，可附 `form` 配方（`promo-video` / `xhs-carousel` / `multi-post`） |
| `decide` | 批量评判（noul/choice/score）由 "Jev" 评判模型打分 |
| `feishu_doc_create` | 在飞书云文档创建带 markdown + 图片的文档 |
| `notify_user` | 推送到配置好的企业微信/钉钉机器人 webhook |
| `schedule_task` / `list_schedules` | 创建/列出 cron 与一次性计划任务 |
| `send_email` | 发送带可选附件的邮件（收件人白名单 + 必须审批） |
| `use_skill` | 把指定 skill 全文加载到提示词 |
| `remember` / `forget` | 双层记忆 |
| `desktop_pet` | 驱动桌面宠物（仅 Electron） |

### 2.4 MCP 连接器（`src/agent/mcp.js`）

标准 MCP client，两种传输：
- `stdio` — 子进程 + JSON-RPC over stdio
- `streamable-http` — POST JSON-RPC 到远端，支持 SSE 响应

配置在 `config.json → mcp_servers`（见 `config.example.json:76-87`）：
```json
[{ "name": "filesystem",
   "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/some/dir"] }]
```

MCP 添加的工具注入为 `mcp__<server>__<tool>`。工具清单缓存于 `mcp-tools-cache.json`；图像/音频输出落到 `.openworkbuddy/mcp-media/`。协议版本固定 `2025-06-18`。

agent 还可通过 `add_connector` 工具在运行时添加新连接器。

### 2.5 Native 二进制

`native/owb-sandbox/main.go` — Windows Go 二进制，实现 Integrity Level 沙箱，限定 `run_shell` / `run_node` 起的进程。macOS 用系统 `sandbox-exec`（`platform/sandbox.js`）。Linux 不沙箱化。

---

## 3. Skills 系统

Skills 是 `skills/<name>/skill.md` 的 Markdown 文件，frontmatter 含 `name` + `description`，可选 `scripts/`、`themes/` 等。通过 `use_skill` 懒加载。

实现：`src/core/ext/skills.js`；1 秒 mtime 缓存；安装时静态审计受 `skill-guard.js`（fork bomb、`dd`/`mkfs`、keychain、浏览器密码库、已知外泄域名、`curl -T` 本地上传、`git clone && execute` 链、超大 base64、隐藏 HTML 注释指令、`history -c`、`allowed-tools` 通配、还有中文"忽略上面的指令"模式）。

**全部 41 个内置 skill**（以 `src/platform/builtin-skill-hashes.json` 校核）：

```
brand-kit
character-photo-studio
competitor-watch
content-repurpose
content-studio
contract-review
customer-feedback
data-analysis
data-viz
deep-research
docx
email-draft
excel-report
feishu-doc
financial-model
html-page
infographic
lark-cli
market-research
meeting-minutes
multi-post
podcast
ppt-design
prd
product-demo
project-plan
promo-video
recruiting
sales-outreach
seo-brief
short-drama
skill-creator
support-scripts
triage
video-compose
web-styles
wechat-article
weekly-report
xhs-cards
xhs-carousel
xiaohongshu-topic
```

### 3.1 三个代表性示例

1. **`ppt-design`**（`skills/ppt-design/skill.md`）— `pptxgenjs` 完整参考。强制 16:9、一论点一幻灯片、≤6 bullets / ≤20 字、图表 `gen_diagram` 后 `addImage`、配色 `1F4E79` / `2E75B6` / `333333` / `EEF3F9` / `FFFFFF`。
2. **`deep-research`**（`skills/deep-research/skill.md`）— 研究工作流：拆 3-6 子问题、独立取证、读原文不读摘要、自我挑刺、列未知。绑定"深度研究员" expert。
3. **`lark-cli`**（`skills/lark-cli/skill.md`）— 包装官方 `@larksuite/cli`。Step 0 跑 `lark-cli --version && lark-cli whoami`；`bot` vs `user` 身份决定权限。

### 3.2 Skill 安装源

- 内置（`skills/`）
- 用户投到 `dataDir/skills/`
- 从 git URL 拉（`install_skill` 工具，跑同一 `skill-guard`）

---

## 4. Experts（`experts.json`）

**42 个具名 expert + 10 支 expert team**（`experts.json` 636 行；README 说 100+ 包括插件式 expert）。

### 4.1 Schema（参考 `src/agent/experts-lib.js` 与文件自身 `_说明`）

```jsonc
{
  "name": "PPT设计师",
  "alias": "排得稳",
  "avatar": "presentation",          // i-* sprite 里的图标名（去掉 i- 前缀）
  "category": "文档演示",            // 9 类之一
  "tags": ["演示文稿", "版式", "配色"],
  "skills": ["ppt-design"],          // 该 expert 启动前自动加载的 skill
  "description": "擅长把内容转化为排版精良的 PPT。…",   // ≤90 字
  "system": "你是一名 PPT 设计师。…", // 实际子智能体的 system prompt
  "builtin": true                    // 包管理；升级保留，除非用户删
}
```

Team：
```jsonc
{ "name": "AI短剧制作组", "avatar": "clapperboard",
  "description": "…",
  "members": ["短剧导演", "角色一致性师", "分镜摄影师", "视频成片师"] }
```

`experts-lib.js` 校验：名称唯一、成员引用存在、`system` 中提到的 `use_skill X` 必须在 `skills` 数组里（否则不会自动加载）。

### 4.2 9 个分类

| 分类 | 数量 | 示例 |
|---|---|---|
| 研究分析 | 4 | 调研专员、深度研究员、竞品分析师、市场研究 |
| 数据报表 | 2 | 数据分析师、数据可视化师 |
| 内容创作 | 8 | 文案写手、小红书运营、公众号编辑、翻译校对师、品牌守门员、短视频脚本师、小红书选题策划、邮件沟通师 |
| 效率办公 | 7 | 会议纪要师、周报助手、招聘专员、合同审阅员、客服话术师、项目经理、飞书助理 |
| 语言沟通 | 2 | 邮件沟通师、翻译校对师 |
| 文档演示 | 1 | PPT设计师 |
| 网页视觉 | 2 | 网页设计师、封面卡片师 |
| 开发协作 | 2 | 程序员、代码审查员 |
| AI短剧 | 5 | 短剧导演、角色一致性师、分镜摄影师、视频成片师、宣传片导演 |

### 4.3 10 支 expert team（顺序接力、成员可见前位产出）

| Team | 成员数 |
|---|---|
| 调研出报告 | 3 |
| 汇报三件套 | n/a |
| 网页交付组 | n/a |
| 内容发布组 | n/a |
| 短视频出片组 | n/a |
| 宣传片出片组 | n/a |
| AI短剧制作组 | 4 |
| 小红书全案组 | 3 |
| 飞书交付组 | 3 |
| 代码交付组 | 2 |

---

## 5. 架构子系统

### 5.1 Electron 桌面（`electron-main.js` 2028 行）

- `main` 字段是 `electron-main.js`
- 真入口是 Electron 主进程；它 spawn 一个 `utilityProcess` 跑 `server-host.js`，把 SSE 流、tool calls、大 JSON 解析从 UI 线程隔出去（`server-host.js:1-16` 注释说明）
- 创建 `BrowserWindow`、系统托盘（`src/desktop/pet.js` + `pet-sprites.js`）、全局快捷键（`src/desktop/`）、IPC bridge（`src/platform/electron-bridge.js`）
- 桌面宠物（`src/desktop/pet.js`）— 小悬浮窗，提供 `setState / alertAsk / clearAsk / show / hide`，驱动"思考 / 问询 / 空闲"的用户体验

### 5.2 Server（`server.js` 10962 行 + `server-host.js` 150 行）

- 单 Node HTTP server，默认端口 3800（`config.example.json:35-37`），默认 bind `127.0.0.1`
- Express app（`server.js`），路由在 `src/server/routes/`（`canvas.js`、`compose.js`、`drama.js`、`geo.js`、`library.js`、`prompt-tpls.js`）
- **多租户支持**：`src/domains/account/org.js` — org、member、RBAC、license key 校验、seat、budget。第一个注册用户为平台 super-admin
- 会话存储于 `data/sessions/`，每个 tool result 后 SSE autosave
- 备份 / 迁移 / 保留 / 更新 / relay 管线：`src/server/backup-auto.js`、`migrate.js`、`retention.js`、`updater.js`、`relay.js`、`relay-files.js`

### 5.3 Native 模块（`native/owb-sandbox/`）

- Go 模块（`go.mod`、`main.go`）— Windows Integrity-Level 沙箱助手，cross-compile 到 amd64 + arm64 Windows
- macOS 用 `sandbox-exec`（`src/platform/sandbox.js`），deny-list profile，调用前 realpath（处理 `/tmp` vs `/private/tmp`），~7ms 开销
- Linux：不沙箱，已在 `sandbox.js` 注明限制

### 5.4 Config 系统（`config.example.json` 98 行）

顶层 key：
- `provider` — `"anthropic"` 或 `"openai"`（后者是 OpenAI 协议兼容垫片，覆盖 DeepSeek、Tongyi Qwen、Zhipu GLM、Kimi、Ollama、OpenRouter、Volcengine Ark）
- `anthropic` / `openai` — `{api_key, model, base_url}`
- `server` — `{port: 3800}`
- `agent` — 大量配置：`max_steps: 25`、`max_runtime_ms: 1800000`、`auto_continue_rounds`、`continue_gate`、`memory_gate`、`ask_gate`、`skill_gate`、`push_gate`、`gen_parallel_max: 2`、`thinking: "auto"`、`second_opinion`
- `search` — `{provider: "jina", api_key}`（DDG fallback）
- `langfuse` — 可选可观测（默认 `enabled: false`）
- `mcp_servers` — MCP server 配置列表
- `im` — 飞书（`app_id`/`app_secret`/`verification_token`）、企业微信 webhook、通用 webhook `secret`
- `models` / `active_model` — 多模型注册表（在设置 UI 添加）

### 5.5 Workspace / Data 布局

默认数据根：`~/OpenWorkBuddy/`（`OPENWORKBUDDY_DATA_DIR` 覆盖）。其下：

```
data/
  memory.md                     # 用户手写，全局共享
  memories.json                 # agent 写，按账户 scope
  memory_vectors.json           # 嵌入（可读 JSON）
  feedback.json                 # 👍/👎 事件（被 evolve 用）
  proposals.json                # 自进化提案
  evolve_runs.json              # 自进化历史
  learned/                      # 每条规则一个文件（一行人话）
  sessions/                     # 每会话一个 .json（按 turn）
  im-log.json                   # IM 200 条滚动历史
  im-sessions.json / .bak
  orgs.json / users.json
  sandbox-canary/               # 沙箱 canary 测试产物
  runtime/                      # server 内部状态
  metrics/  metrics-alerts.json
  usage/                        # 每账户用量记录
  cli-history.txt
  migrations.json
workspace/                      # 默认工作区
projects/                       # 多项目：每个一个工作区
tenants/                        # 多租户：每个 org 一个工作区
schedules.json                  # cron + 一次性任务 + 运行历史
```

来源：`src/platform/paths.js`，`data/` 目录列表。

---

## 6. CLI / 交互模式

3 个主入口共用同一运行时（README.md:225-275）：

| 入口 | 说明 |
|---|---|
| Desktop（`electron-main.js`） | 完整 GUI：聊天、文件浏览器、画布编辑器、设置、宠物 |
| CLI（`cli.js` 3360 行，`npm link` 安装） | REPL、单次、管道、NDJSON 事件流（`--json`）。子命令：`sessions`、`resume`、`engines`、`doctor`、`pair`、`passwd`、`2fa`、`owner`、`jev`、`workflow`、`review`、`worktree`、`completion`。退出码：0 ok / 1 任务失败 / 2 参数错误 / 130 Ctrl-C |
| Web UI | 与桌面一致 — `server.js` serve `public/` 到 `127.0.0.1:3800` |

### 6.1 IM 集成（`src/im/im.js` 1778 行）

6 路 IM 渠道：

1. **飞书 Bot** — 长连接模式（无需公网 URL）；fallback HTTP 回调 `POST /im/feishu/events`。使用 `im-feishu-media.js` 处理附件（mp4 含封面、>30MB 压缩）。
2. **微信 iLink** — 二维码扫码登录、长轮询（`im-ilink.js`、`im-wechat.js`）。
3. **企业微信自建应用 / 微信公众号** — 腾讯回调模式，需公网 HTTPS。回调：`/im/wecom/events`、`/im/mp/events`。
4. **企业微信群机器人** — webhook URL，仅推送（配置示例自带一份）。
5. **QQ** — `im-qq.js`、`createQQConnection`。
6. **通用 Webhook** — `POST /im/task {message, secret}` — 同步执行任务并返回 `{reply, files}`。Secret 校验。可桥接任何能发 HTTP 的东西（钉钉外向、iOS Shortcuts、自定义 IM 框架）。

外加 `send_email` 工具（`core/obs/mailer.js`，SMTP）。

### 6.2 通用 CLI flag（`src/cli/cli-args.js`）

```
--mode craft|goal|plan|ask
--perm plan|ask|auto|full
-C <workspace>
-f <file>（可重复）
-c（continue）
--session
--list [n]
--model
--max-steps
--append-system
--json
-q / --quiet
--raw
--no-mcp
--ask-remote
--allow <rule>（可重复）
-i <name=value>（workflow 输入）
--off（2fa）
--score（jev 评分）
-V
-h
```

---

## 7. LLM Provider

`config.example.json` 与 `src/core/model/chat-models.js` / `llm.js` 支持：

**接口格式**：
- OpenAI Chat Completions（`openai`）— 覆盖 OpenAI / DeepSeek / Qwen / Zhipu GLM / Kimi / Ollama / OpenRouter / Volcengine Ark
- Anthropic Messages API（`anthropic`）— 直连 Claude
- Gemini native（`gemini`）
- Ollama native（`ollama`）
- "Responses"（新 OpenAI 格式）

**`config.example.json:8-30` 中列出的预设**：
- Anthropic（Claude Opus-5 示例，可用 `@anthropic-ai/sdk ^0.125.0` 任意 Claude 模型）
- DeepSeek `https://api.deepseek.com/v1`（`deepseek-chat`）
- 通义千问 DashScope 兼容（`qwen-max`）
- 智谱 GLM-4（`glm-4-plus`）
- 月之暗面 Kimi（`moonshot-v1-32k`）
- Ollama 本地（`http://localhost:11434/v1`，如 `qwen3:14b`）

**媒体**（图像/视频/TTS/视觉）**单独**配置于 `core/model/media-models.js`；README 说同一模型 key 选择在 UI 也映射到媒体预设。

**推理**（`thinking` 在 `agent` block）：`auto / off / low / medium / high`，在 `src/core/model/thinking.js` 中按 provider 映射。

**"Engines"** — `src/engines/claude-code.js` 与 `src/engines/codex.js` 让用户复用本地已付费的 Claude Code（`claude -p`）或 Codex（`codex exec --json`）作为后端智能体。`openworkbuddy engines use claude-code` 切换，免付 API token。

---

## 8. 多任务 / 并行

- **生成式媒体并行** — `agent.gen_parallel_max`（默认 2，范围 1-4）控制一 turn 内同时跑的 image/video/TTS job。`config.example.json:56-58`。
- **`explore` 子智能体** — 同 turn 内多次 `explore` **并发**（只读子智能体）。`agent.js:106-118`。
- **后台 shell 命令** — `run_shell` 立即返回 job id；`shell_output` / `shell_kill` 轮询/取消。长跑命令不阻塞 agent。
- **计划任务** — `src/core/automation/scheduler.js`。自定义 cron 解析器（5 字段，支持 `*` / `n` / `n-m` / `*/s` / `n-m/s`、逗号列表）。一次性任务支持 `+5m` / `+2h` / `+1d` / `14:05` / `2026-09-19 14:05`。漏跑可在 24h 内补跑（`MAX_CATCHUP_MS`）。运行历史：最近 300 条存于 `schedules.json`。
- **异步视频 job** — `src/engines/harvest.js` 持续运行后台 collector，让 CLI 退出不掉单；最终剪辑回到原始会话，不重复计费。
- **自动续 round** — `agent.auto_continue_rounds`（默认 0）+ `continue_gate`（评判模型问"有未完成工作吗？"），让长任务在预算内自动重启。
- **Worktree 隔离** — `src/agent/worktree.js`；并行任务编辑同一 git repo 时各自一条分支。

---

## 9. 双层记忆

明确实现。`src/core/memory/memory.js` 头注释（第 1-18 行）翻译："两层：手写层（`data/memory.md`，全局，所有账户共享）+ 记忆项层（`data/memories.json`，agent 通过 `remember` 写，按账户 scope，去重，可淘汰，带保留）。注入提示词：共享 + **仅当前账户自己的**记忆 — 不会跨账户泄漏。"

关键参数：
- `MAX_TEXT = 400` 每项字数
- `MAX_PER_SCOPE = 120`
- `MAX_PROMPT_CHARS = 6000`
- `SECRET_PATTERNS` 屏蔽 API key、token、密码、AWS key、GitHub token、Slack token、"密码:xxx" 模式
- `looksStaleClaim` 屏蔽"X 工具已修复"类断言，防止记忆把误报固化为事实
- 排序：`min(hits, 20)*2 + (source=="user"?12:0) - idleDays/10 - ageDays/120` — 老但仍被用 > 新但被忽略

**两种召回**：
1. **向量召回**通过 `src/core/model/llm.js createEmbedder`
2. **中文 Bigram 关键词打分**（`bigrams()` + cosine）作为无 embedder 时的 fallback

**嵌入模型变更检测** — 先发 probe 调用；失败时保留旧向量（不在坏通道上清空索引）。

**每账户 scope** — `SHARED = "*"`；无登录用户时回退到 shared。

**命中簿记** — `pendingHits` Map 每 20 秒 flush（timer unref'd），淘汰按"真正被用过"而非"最早"。

---

## 10. IM 远程控制（细节）

- **飞书长连接**：启动 app 时建，无需公网 URL。权限：`im:message`（收）+ `im:message:send_as_bot`（发）。订阅事件：`im.message.receive_v1`。三步 UX：1）在用户消息上贴"稍等"反应，2）发活进度卡（`im-card.js`）含步骤数、耗时、tokens、最近 log 行，3）同一张卡变最终答案；移除反应。fallback 序列：CardKit streaming → CardKit static → interactive → 纯文本。`feishuDedupeKeys` 按 `event_id` + `message_id` 双去重。
- **飞书 HTTP 回调**：`POST /im/feishu/events` — 保留给已有公网 URL 的部署。
- **飞书文档创建**：工具 `feishu_doc_create` 直接在用户飞书写 docx（支持 markdown 表 + 图片；SVG 图像自动转 PNG 上传）。`wait_for_permission: true` 最多等 10 分钟。
- **微信 iLink**：扫码登录，长轮询。`im-ilink.js`。
- **企业微信自建应用 / 微信公众号**：HTTP 回调模式（需公网 HTTPS）。`im-wechat.js`（`createWecomApp`、`createWechatMp`）。
- **企业微信群机器人**：仅 webhook URL 推送，被 `notify_user` 工具用。
- **QQ**：`im-qq.js`、`createQQConnection`。
- **通用 webhook**：`POST /im/task {message, secret}` — 同步返回 `{reply, files}`。Secret 校验。
- **状态与日志端点**：`GET /im/status`、`GET /im/log`、`POST /im/feishu/test`（校验凭据 + 重建长连接）。

**会话处理**：`maybeResetIdleSession` 在 N 小时（可配置，默认关）不活动后自动重置会话省 token。

**可见性模型**：Web UI 用户只见自己的 chat + 任何"无主"channel，仅当他们是平台 admin（`seesAll`）。

---

## 11. 权限档位（4 档）

来自 `src/core/safety/security.js` — 严格 **4 档**：

| Tier（id） | 标签 | 写 | 命令 |
|---|---|---|---|
| `plan` | "只看不动" | deny | deny |
| `ask` | "每步都问" | ask | ask |
| `auto` | "自动改文件" | allow | rules（allowlist，再 blocklist） |
| `full` | "全自动" | allow | rules + 文件 blocklist + 危险命令 confirm |

CLI flag：`--perm plan|ask|auto|full`。

超出的硬规则（`security.js` 表明无论哪档都生效）：
- **P5 "软护栏"**：拦截破坏性命令形式（`rm -rf` 到 `/dev`、`dd` 到裸盘、`mkfs`、`down -v`、force-push、几十种 `cmd.exe`/`cmd /c`/`if exist x rd /s /q x` 模式）。无论哪档始终要求确认。
- **命令 deny 列表**（docker `-H`/`--host`/`--context`/etc.、`git --upload-pack` 等）。
- **URL 闸门**（`net-guard.js`）：localhost、内网、OWB 自己的端口、云元数据默认拒；每组织 `net_allow` / `net_deny` 白名单；出站 IP **pin** 到批准时的解析 IP 以防 DNS rebinding。
- **`app_modules` deny 列表**（例如 `config.json`、`*.pem`、`id_rsa*`、Keychain）。

### 11.1 沙箱层（编译时，在 tier 之上应用）

- **macOS**：`sandbox-exec` + deny-list profile（`src/platform/sandbox.js`）；deny 前 realpath（处理 `/tmp` vs `/private/tmp`）；~7ms 开销。
- **Windows**：Go 助手 `owb-sandbox` 把被 spawn 进程的 Integrity Level 降到"Low"，workspace 文件标"Low 可写"，config/key 标"Low 不可读"。
- **Linux**：无沙箱，文档注明限制。
- agent 自己的 IPC 端口（3800 等）显式阻止 sandboxed 进程访问。

### 11.2 批准卡片

命令需要批准时，`src/engines/approve.js` 在桌面 UI / CLI / IM 渲染卡片，默认 5 分钟超时（`ask_user_timeout_ms: 300000`）。

---

## 12. 交付物（可生成的文件）

agent 可端到端产出（README、config example、skill body 共同佐证）：

| 文件 | 工具 / 库 | 备注 |
|---|---|---|
| `.pptx` | `run_node` + `pptxgenjs ^3.12.0` | `skills/ppt-design` 是规范参考 |
| `.docx` | `docx ^9.0.0` | `skills/docx` |
| `.xlsx` | `exceljs ^4.4.0` | `skills/excel-report` — 用公式不写死数值 |
| `.pdf` | via shell（wkhtmltopdf / headless Chrome / docx→pdf） | 不自带 |
| `.html`（单文件） | `write_file` | `skills/html-page`、`skills/web-styles`。无外部 CDN，仅系统字体 |
| `.png` / `.jpg` / `.webp` | `generate_image` + `gen_diagram`（mermaid、dagre、joint.js、viz-js、echarts ^6.1.0） | |
| `.svg` → `.png` | `gen_diagram`（写两者；IM 丢 SVG 双胞胎） | |
| `.mp4` | `compose_video`（ffmpeg）+ `generate_video` 上游 | `skills/short-drama`、`skills/promo-video`、`skills/video-compose` |
| `.mp3` / TTS | `text_to_speech`（segments 批模式） | `src/tools/tts-batch.js` |
| `.srt` / 字幕 | `src/util/timeline-subs.js` | |
| Mermaid / D2 / PlantUML | `gen_diagram`（mermaid ^11.17.0、@dagrejs/dagre ^1.1.8、@joint/core ^4.3.3、@viz-js/viz ^3.29.0） | |
| 柱/折/饼/热力图 | echarts | `skills/data-viz` |
| QR 码 | `qrcode ^1.5.4` | 用在"发到手机"行程卡 |
| Markdown / 飞书文档 | `feishu_doc_create`（在飞书创建真 docx） | |

**投递验证**：`agent.js` 强制：任何含 `(生成成功|导出成功|…|✅)` 后跟文件名的文本必须**真在磁盘上且非空**，否则该 run 被弹回（agent.js:366-450）。

---

## 13. 自进化（👍👎 进自进化）

`src/agent/evolve.js`（657 行）5 阶段：

1. **`mineSignals()`** — 扫 `data/sessions/*.json` 与 `data/feedback.json`。**按形态分类**所有 tool error 与事件，不按文本，所以改写的错误仍能聚类。每 key 跟踪：count、distinct sessions、samples（≤4）、firstAt/lastAt（只在 turn 自带日期时记录，避免假精度）。
2. **`proposeEdits()`** — 对每个超过 `minEvidence=3`/`minSessions=2` 阈值的信号，生成**最小可行的提示词微调**加验证条款。
3. **`gateProposal()`** — 代码侧否决：证据不足、与已有规则重复、超预算 — 杀掉。
4. **`decideProposal()`** — **永不自动应用**。必须人批。被拒原因反馈下一轮。
5. **`scoreRules()`** — 规则生效后，测底层 signal 频率是否真降。没降就提请退休。

硬上限（代码里）：
- `rules ≤ 12`（要加第 13 条必须点名退役哪条）
- `ruleChars ≤ 400`
- `blockChars ≤ 4000`（注入总预算）
- `minEvidence = 3`、`minSessions = 2`
- 默认窗口：14 天

**可行动性过滤**：每个信号打 `prompt | config | code` 标签。只有 `prompt` 允许长成规则；其余是"config"（如 provider 额度、沙箱误报）或"code"（如 `unknown_tool`），不该用提示词掩盖。

**反馈存储**：`data/feedback.json`，最多保留最近 2000 条，含完整 per-turn 上下文（model、provider、mode、steps、errors、elapsed、tokens）。`feedbackSummary()` 产 up-rate 按 model/mode/day。

**文件存储**：一条规则 = `data/learned/` 一个文件。人类可读可改，删除就是 `rm`。

---

## 14. 其他观察到的能力

- **"无限画布" / AI 短剧流水线** — `src/domains/media/drama-pipeline.js`、`drama-compose.js`、`timeline-compose.js`、`shot-history.js`。README 引用的 75 秒示例 `不烧心` EP01 就是用 `短剧导演` team 走过这个画布（脚本 → 角色/场景 → 故事板 → 镜头 → 图像/视频/音频 → 时间轴）。
- **行程卡 + 地图** — `src/util/itinerary.js`、`domains/geo/places.js` + `tiles.js`。国内默认高德，海外 Google Maps。
- **配方 form** — `src/domains/content/recipes.js` 驱动 `ask_user` 的 `form: "promo-video"|"xhs-carousel"|"multi-post"` 参数；多问题渲染成一张多问答卡。
- **Brand Kit** — `src/domains/content/brand-kit.js` — 每个产品一个品牌档案；只在产品被提及时注入。
- **知识库 / preview** — `src/domains/library/` — 团队共享 + 个人素材（PDF、Word、图像），agent 可拉。
- **Workflow runner** — `src/cli/workflow.js` 读 JSON 文件（`steps`，每步含 prompt、mode、可选 `{{name}}` 插值或 `{{input.name}}` 预填），同一会话内顺序跑，第一处失败停除非 `continue_on_error: true`。步数上限 50。
- **自定义 slash 命令** — `src/cli/custom-commands.js`：扔个 `.openworkbuddy/commands/<name>.md`（项目）或 `~/.openworkbuddy/commands/<name>.md`（用户），支持 `$ARGUMENTS` 和 `$1..$9`。不可 shadow 内置（`/diff` 等）。
- **Sweep / cleanup** — `src/agent/sweep.js` 列中间产物（per-frame PNG、demucs wavs、Xcode build、ck.db）并提出删除理由。永远不自动删。
- **多租户账户** — `src/domains/account/`（admin、org、rbac、spaces、license、lifecycle、vkeys）；第一注册用户为平台 admin；per-org `allow_shell`、`net_allow`、`net_deny`、`skills_write`、`connectors_write` 策略。
- **自动更新** — `src/server/updater.js` 查询 GitHub Releases（不是作者自己的服务器）— README 确认唯一遥测就是更新检查时 GitHub 看到的本机 IP。
- **桌面宠物** — `src/desktop/pet.js` + `pet-sprites.js` — 小悬浮头像，反映 agent 状态（"thinking / idle / asking"）。

---

## 15. 重要文件路径索引

| 关注点 | 路径 |
|---|---|
| Electron 主进程 | `electron-main.js`（2028 行） |
| 主 server | `server.js`（10962 行）+ `server-host.js`（150 行） |
| CLI | `cli.js`（3360 行） |
| Agent 主循环 | `src/agent/agent.js`（极长） |
| 工具实现 | `src/agent/tools.js` |
| MCP client | `src/agent/mcp.js`（1142 行） |
| 自进化 | `src/agent/evolve.js`（657 行） |
| 双层记忆 | `src/core/memory/memory.js`（655 行） |
| 调度器 | `src/core/automation/scheduler.js`（816 行） |
| 评判模型 | `src/core/judge/{jev,systemone}.js` |
| 4 档权限 | `src/core/safety/security.js` |
| Skill 静态审计 | `src/core/safety/skill-guard.js` |
| URL + 命令护栏 | `src/core/safety/net-guard.js` + `core/safety/cmd-risk.js` |
| 模型路由 | `src/core/model/{chat-models,llm,thinking,media-models,media-health}.js` |
| IM 路由 | `src/im/im.js`（1778 行） |
| CLI 表面 | `src/cli/{cli-args,cli-ask,cli-approve,custom-commands,doctor,repl-commands,review,workflow-panel,workflow}.js` |
| Skills/Plugins/MCP 目录 | `src/core/ext/{skills,plugins,mcp-catalog}.js` |
| 媒体生成 | `src/tools/{canvas,compose,media,motion,tts-batch}.js` |
| 领域逻辑 | `src/domains/{account,content,geo,library,media}/*` |
| 平台层 | `src/platform/{sandbox,paths,store,electron-bridge,render,boot-check,awake,deps-guard,child-env,log,known-tools,icons,root,win,which}.js` |
| Windows Go 沙箱 | `native/owb-sandbox/{main.go,go.mod}` |
| 内置 skills | `skills/*`（41 个目录，每个含 `skill.md`） |
| 部署资产 | `deploy/{Caddyfile,nginx.conf,env.example}` + `deploy.sh` |

---

## 16. 无法确认的事项

- **Expert 精确数**：README/着陆页说"100+ roles"，但 `experts.json` 是 42 + 10 team。"100+" 大概把可从 git 安装的 plugin expert 算进来。
- **插件目录**：`src/core/ext/plugins.js` 存在但未列举哪些内置 vs 来自 git。
- **Langfuse 追踪**：代码路径（`src/core/obs/trace.js`、`config.example.json:69-75`）存在，默认关。
- **自动更新端点**：确认查 GitHub Releases；未确认精确轮询频率。
- **`worktree.js` / `hooks.js` / `checkpoints.js`**：以独立文件存在；未深度读，但已在 agent require 图里（处理 git 隔离、用户定义 hooks、per-tool checkpoints）。
