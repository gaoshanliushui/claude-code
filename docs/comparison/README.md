# Claude Code vs OpenWorkBuddy — 异同速读

> 这是当前代码库（`/Users/zhouquan/project/ai/agent/coding/claude-code/`，反编译版 Claude Code CLI）
> 与本机 WorkBuddy 项目（`/Users/zhouquan/project/ai/agent/general/openworkbuddy/`，本地优先 AI 办公助理）的
> 详尽功能对照系列。

---

## 0. TL;DR（30 秒看完）

| 维度 | Claude Code | OpenWorkBuddy |
|---|---|---|
| 给谁用 | 开发者 | 办公族 |
| 主要交付 | 代码改动（bash / edit / read） | 文件（pptx / docx / xlsx / html / mp4 / mp3） |
| 形态 | 单 CLI | Electron 桌面 + CLI + Web + 6 路 IM |
| 内置 skill | 16（多个 gated） | 41 |
| 多 agent | 7 内置（多数 + 大量 flag-gated） | 42 expert + 10 顺序接力 team |
| IM 远程 | 全部 dead | ✅ 飞书 / 微信 iLink / WeCom app/MP/bot / QQ / 通用 webhook |
| 多 LLM | Anthropic + Bedrock/Vertex/Foundry | Anthropic + OpenAI 兼容 8+ 家（DeepSeek/Qwen/GLM/Kimi/Ollama/OpenRouter 等） |
| 自进化 | ❌ | ✅ 5 阶段（永不自动、规则上限 12、字符预算 4000） |
| 媒体生成 | ❌ | ✅ 图 / 视频 / TTS / ASR / 视频合成 / echarts / 流程图 |
| 投递验证 | ❌ | ✅ "(成功\|✅)" 后文件名必须真在磁盘 |
| 评估 | ❌（tsc 1341 错误未解决） | ✅ test/lint/typecheck/e2e/eval 全套 |

---

## 1. 本系列文档

| 文件 | 用途 | 适用读者 |
|---|---|---|
| **本文档** [`README.md`](./README.md) | 索引 + 一句话总览 | 任何人 |
| [`claude-code-architecture.md`](./claude-code-architecture.md) | Claude Code（本仓库）的功能档案 | 想深入了解本仓库能力清单的人 |
| [`openworkbuddy-architecture.md`](./openworkbuddy-architecture.md) | OpenWorkBuddy 的功能档案 | 想深入了解 WorkBuddy 能力清单的人 |
| [`side-by-side.md`](./side-by-side.md) | 维度并列对照 + 借鉴清单 | 决定"借鉴什么"的人 |
| [`feature-matrix.md`](./feature-matrix.md) | 高密度能力勾稽表 | 想速查"哪个能做"的人 |

---

## 2. 团队 / 工作流

> 你说"创建一个团队"——这个对比文档系列当作"虚拟团队"的产物：
>
> | 角色 | 谁在做事 | 交付 |
> |---|---|---|
> | Claude Code 探员 | Agent #1（已完成的子代理） | 摸清本仓库每个工具、模块、flag 的真实状态 |
> | OpenWorkBuddy 探员 | Agent #2（已完成的子代理） | 摸清 openworkbuddy 每个工具、skill、expert、IM 渠道的真实状态 |
> | 整理与对照者 | 我本人（本会话） | 把两份报告整合成 4 份可读文档 |
>
> 不会启动额外进程；本会话内已派 2 个并行研究代理完成勘察。

---

## 3. 为什么这两个项目值得比较

尽管定位几乎正交——一个是开发者终端 CLI，一个是办公族桌面助理——但底层大量设计选择高度相似：

- 都基于 Anthropic SDK 调模型
- 都有 skill 体系（Markdown frontmatter 描述）
- 都有 MCP client（stdio + SSE/HTTP）
- 都有子 agent 派发
- 都有 shell 沙箱
- 都声称"本地优先"
- 都支持多 provider
- 都有详细权限模型

差异更大的反而是**产品层**：

| 设计点 | Claude Code 选了什么 | OpenWorkBuddy 选了什么 |
|---|---|---|
| 主要交付 | 增量代码改动（git diff） | 完成的办公文件 |
| 形态多寡 | 单一 CLI | 桌面 + Web + CLI + IM |
| 触发节奏 | 用户主动 `claude` / `-p` | IM + 计划任务 + 主动对话 |
| 反馈回路 | /feedback 命令（无自学习） | 👍👎 进 5 阶段自进化 |
| 安全姿态 | 5+ 档权限 + 沙箱 | 4 档权限 + 沙箱 + Skill 静态审计 + URL IP pin + Secret 屏蔽 |
| Provider | 锁 Claude + 4 大云 | 真正模型无关 |
| 商业 | 公开产品 | 个人非商用免费 + 商用授权 |

---

## 4. 数据来源

| 来源 | 内容 |
|---|---|
| 本仓库 `src/`、`packages/`、各 `docs/` | Claude Code 侧 |
| 本仓库 `CLAUDE.md` | 反编译背景、构建信息、stub 提示 |
| `/Users/zhouquan/project/ai/agent/general/openworkbuddy/` 整树 | OpenWorkBuddy 侧 |
| openworkbuddy `README.md` + `docs/own/` 各文档 | 中文 OA 产品定位 |
| openworkbuddy `config.example.json` | 配置 schema 真相 |
| openworkbuddy `experts.json` | 42 expert + 10 team 列表 |
| openworkbuddy `skills/` 41 个 `skill.md` | skill 实际清单 |

---

## 5. 阅读路径建议

1. **产品/PM/决策者**：先看本 README 的 §0 和 [`side-by-side.md`](./side-by-side.md) 的 §14（关键差异要点一句话）。
2. **架构师/技术负责人**：看 [`feature-matrix.md`](./feature-matrix.md)，再按需进入 [`claude-code-architecture.md`](./claude-code-architecture.md) 或 [`openworkbuddy-architecture.md`](./openworkbuddy-architecture.md) 查细节。
3. **具体借鉴/迁移者**：直接看 [`side-by-side.md`](./side-by-side.md) §15-16 的借鉴清单，按"价值 + 难度"挑。
4. **审计/安全**：看 [`feature-matrix.md`](./feature-matrix.md) §6（权限 / 安全）和 §8（自进化）。
5. **媒体/AI 应用开发者**：重点关注 OpenWorkBuddy §2.3 媒体类工具 + skill 库。

---

## 6. 主要事实速记

### 6.1 Claude Code（本仓库）核心事实

- **反编译版本**，`feature()` 永远 false，ANT-only 路径 dead
- 30+ 工具，~10 个 SKU-gated，~25 个 flag-dead
- 4 大 Provider（Anthropic / Bedrock / Vertex / Foundry）
- 50+ slash 命令，活约 30+ 个
- 完整 MCP（24 文件、~12000 行）
- 完整 Hooks、权限、记忆、压缩、resume
- **缺失**：媒体生成、IM、自进化、调度、桌宠、画布
- **1341 tsc 错误**未解决（来自反编译，不阻塞 Bun 运行）

### 6.2 OpenWorkBuddy 核心事实

- **v0.13.1**，Node 18+ CommonJS，Electron + CLI + Web + IM
- 37 个核心工具 + 5 类媒体工具 + MCP
- 41 个内置 skill（含 ppt/docx/xlsx/data-viz/video/audio/微信/小红书等办公全场景）
- 42 expert + 10 顺序接力 team + 9 类
- 6 路 IM 渠道（飞书 / 微信 iLink / WeCom 自建 / WeCom 群机器人 / 微信公众号 / QQ / 通用 webhook）
- 双层记忆（含向量、Secret 屏蔽、排序公式）
- 4 档权限（plan/ask/auto/full）+ Skill-guard 静态审计 + URL IP pin
- 5 阶段自进化（规则上限 12 + 字符预算 4000 + 永不自动）
- cron + 一次性 + 漏跑补跑的 scheduler
- mac/win 沙箱（Linux 不沙箱，已文档注明）
- 多租户（org/RBAC/license）
- test/lint/typecheck/e2e/eval 全套
- 个人非商用免费；商用须购买商业授权

---

## 7. 关键设计模式横向对比

| 模式 | Claude Code | OpenWorkBuddy | 是否能彼此借鉴 |
|---|---|---|---|
| Skill 系统 | Frontmatter + 描述注入 + lazy use_skill | 同 | OWB 加 skill-guard 静态审计 |
| 子 agent 派发 | AgentTool + 内置 7 类 | delegate_to_expert + 42 expert + 10 team | 形式相同，OWB 专家库更结构化 |
| 顺序团队 | TeamCreate/Delete（gated） | 10 支显式接力 team | OWB 设计产品化 |
| 计划任务 | 全 dead | scheduler.js（cron+once+catchup） | OWB 更完整 |
| IM 远程 | 全 dead | 6 渠道 + 进度卡 + 附件 | OWB 完整产品 |
| 多模型 | 4 供应商锁 Claude | Anthropic + OpenAI 兼容 8+ 家 | OWB 真正模型无关 |
| 记忆 | 文件体系 + memdir | 双层 + 向量 + Secret 守卫 | OWB 工程化更深 |
| 沙箱 | @anthropic-ai/sandbox-runtime（统一） | mac sandbox-exec + Win Go IL | 思路不同都可参考 |
| 权限档位 | 5+ 活 + 2 死 | 4 档全活 | Claude Code 细分更多但大量死 |
| 自进化 | 无 | 5 阶段硬上限 | OWB 独有 |
| 评估 | 无 | 全套 test+lint+e2e+eval | OWB 完整工程实践 |
| 桌面 | 无 | Electron + 桌宠 | OWB 独有 |

---

## 8. 对 Claude Code（本仓库）最有价值的 OWB 设计（按价值/难度排）

| 优先级 | 设计 | 关键代码 |
|---|---|---|
| ★★★ | 5 阶段自进化 | `src/agent/evolve.js` |
| ★★★ | Skill 静态审计（含中文 prompt injection 模式） | `src/core/safety/skill-guard.js` |
| ★★ | 双层记忆（Secret 守卫 + 向量） | `src/core/memory/memory.js` |
| ★★ | 表单配方 ask_user（多问答合一） | `src/domains/content/recipes.js` |
| ★★ | 投递验证 | `agent.js:366-450` |
| ★ | `add_connector` 运行时新增 MCP | `tools.js` |
| ★ | decide + Jev 评分模型 | `src/core/judge/jev.js` |

## 9. 对 OpenWorkBuddy 最有价值的 Claude Code 设计

| 优先级 | 设计 | 关键代码 |
|---|---|---|
| ★★★ | `/rewind` + 文件历史快照 | `src/utils/fileHistory.ts` |
| ★★★ | Hooks（pre/post tool）通用框架 | `src/utils/hooks.ts` |
| ★★ | `--json-schema` Zod 结构化输出 | `src/main.tsx` |
| ★★ | `from-pr` / `cross-project resume` | `src/utils/crossProjectResume.ts` |
| ★★ | Bedrock/Vertex/Foundry 多云支持 | `src/services/api/client.ts` |
| ★ | `--output-format stream-json` | `src/main.tsx` |
| ★ | LSP 集成 | `src/services/lsp/` |
| ★ | `--worktree` 开发会话隔离 | `src/utils/worktree/` |
| ★ | MCP 多传输（WebSocket/InProcess/SdkControl） | `src/services/mcp/` |

---

## 10. 一句话总结

**两个项目几乎在所有维度都恰好互补**：

- 把 Claude Code 当骨架，把 OpenWorkBuddy 当肌肉，可以拼出"开发者 + 办公族"双栖 AI 助理；
- 或反之，把 OWB 当骨架，把 Claude Code 当开发助手外挂；
- 单独看，Claude Code 是程序员利器，OpenWorkBuddy 是办公族利器；
- 一起看，能发现大量值得互相借鉴的工程决策与产品决策。

---

## 附录 A：项目目录

```
/Users/zhouquan/project/ai/agent/coding/claude-code/      ← 本仓库（反编译版 Claude Code）
└── docs/comparison/                                       ← 本文档系列
    ├── README.md                  (本文件)
    ├── claude-code-architecture.md
    ├── openworkbuddy-architecture.md
    ├── side-by-side.md
    └── feature-matrix.md

/Users/zhouquan/project/ai/agent/general/openworkbuddy/   ← 本机 WorkBuddy
├── README.md  README.en.md
├── CHANGELOG.md  CHANGELOG.en.md
├── docs/own/
│   ├── 功能清单.md
│   ├── 代码架构.md
│   ├── 实现细节.md
│   ├── 案例.md
│   ├── 路线图.md
│   ├── 架构优化路线_2026-08.md
│   ├── 安全.md  安全基线.md
│   ├── 部署.md  安装与启动.md
│   ├── 命令行用法.md
│   ├── 多人协作.md  IM与定时任务.md
│   ├── 数据同步与搬家.md  远程访问.md
│   ├── 评测方法论.md  模型与Key管理_调研与改法.md
│   ├── 推广/  alternatives/
│   └── index.html  sitemap.xml  stats.json
└── ...
```

## 附录 B：术语对照

| 术语 | Claude Code | OpenWorkBuddy | 说明 |
|---|---|---|---|
| skill | 一个 Markdown + frontmatter 的命名能力 | 同 | 同 |
| sub-agent / sub-expert | AgentTool 派生的子 Claude | delegate_to_expert 派生的子 agent | 同形 |
| team | TeamCreate（多人组，gated） | expert team（顺序接力，可见前位产出） | 同名不同质 |
| approval | Ink 弹窗 | approve.js 卡片（desktop/CLI/IM 通用） | 同 |
| memory | CLAUDE.md 4 级 | 双层：手写 + 自动写 | 不同 |
| provider / 模型 | CLAUDE_CODE_USE_*_=1 | config.json models | 形式不同 |
| hook | settings.json hooks | ❌（OWB 没有通用 hook） | Claude Code 独有 |
| plugin | .claude/plugins/ | ❌ | Claude Code 独有 |
| slash command | /name | /name（含 form 配方） | 基本同 |
| plan mode | /plan + EnterPlanMode | --mode plan | 同概念 |
| worktree | --worktree | src/agent/worktree.js | 同概念 |
| voice mode | VOICE_MODE（dead） | ❌ | Claude Code dead 路径 |
| proactive / scheduled | AGENT_TRIGGERS（dead） | scheduler.js（活） | OWB 活 |

---

> 本文档系列由派生的 2 个并行研究代理 + 本会话整理而成，未读原始未读章节会在原文标注"无法确认"，请以原文为准。
