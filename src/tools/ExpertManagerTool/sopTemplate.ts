/**
 * SOP (Standard Operating Procedure) template generators for team experts.
 *
 * Mirrors the WorkBuddy `plugin.json` + `agents/<id>.md` layout. Used by
 * `ExpertManagerTool.create_team` to write fully-formed .md files when a
 * new team is created — not just a stub body.
 *
 * Three exports:
 *   - `buildAgentFrontmatter`  → YAML frontmatter block (name / displayName /
 *                                profession / maxTurns)
 *   - `buildLeadSOPBody`       → 4-Phase SOP lead body (团队成员表 / 5 Phases /
 *                                路由表 / Workflow A-D / 铁律 / 严禁行为 / 协作规则)
 *   - `buildMemberBody`        → 身份 / 核心能力 / 工作流程 / 输出规范 / SendMessage 回传
 *
 * The lead body and member body shapes match the on-disk format produced by
 * `scripts/generate-team-md.mjs` (which generated the 3 existing teams:
 * software-dev-team / toutiao-finance-account-ops-team / toutiao-ops-team).
 *
 * All text is in Chinese because the WorkBuddy convention is that
 * team-lead prompts coordinate Chinese-speaking agents; the model's
 * per-team customizations can be passed via `leadPrompt` and per-member
 * `prompt` overrides at the call site.
 */

import type {I18nString} from './types.js'

// ---------------------------------------------------------------------------
// YAML helpers (kept local to avoid an export-cycle with expertStorage.ts)
// ---------------------------------------------------------------------------

/** Quote a YAML scalar if it contains characters that need escaping. */
function quoteYamlString(s: string): string {
	const needsQuotes = /[:#{}\[\]\&*!|>%@`]/.test(s) || s === ''
	if (!needsQuotes) return s
	return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Serialize an i18n value as a nested YAML block (used for displayName /
 *  profession). The result is the inner `en: ...\n  zh: ...` text that
 *  follows the `displayName:` key. */
function serializeI18nYaml(value: I18nString | undefined): string | undefined {
	if (value === undefined || value === null) return undefined
	if (typeof value === 'string') return quoteYamlString(value)
	const lines: string[] = []
	if (value.en !== undefined) lines.push(`en: ${quoteYamlString(value.en)}`)
	if (value.zh !== undefined) lines.push(`zh: ${quoteYamlString(value.zh)}`)
	return lines.length > 0 ? lines.join('\n  ') : undefined
}

/** Extract a human-readable string from an i18n value (zh preferred). */
function i18nToZh(value: I18nString | undefined): string {
	if (!value) return ''
	if (typeof value === 'string') return value
	return value.zh ?? value.en ?? ''
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export type AgentFrontmatterInput = {
	id: string
	description: string
	displayName: I18nString
	profession: I18nString
	maxTurns: number
	model?: string
}

/** Build the YAML frontmatter block (between `---` markers) for an agent
 *  or lead .md file. The order matches the WorkBuddy format produced by
 *  `scripts/generate-team-md.mjs`. */
export function buildAgentFrontmatter(m: AgentFrontmatterInput): string {
	const lines: string[] = ['---']
	lines.push(`name: ${m.id}`)
	lines.push(`description: ${quoteYamlString(m.description)}`)
	if (m.displayName) {
		const dn = serializeI18nYaml(m.displayName)
		if (dn) lines.push(`displayName:\n  ${dn}`)
	}
	if (m.profession) {
		const p = serializeI18nYaml(m.profession)
		if (p) lines.push(`profession:\n  ${p}`)
	}
	if (m.model) lines.push(`model: ${m.model}`)
	lines.push(`maxTurns: ${m.maxTurns}`)
	lines.push('---')
	lines.push('')
	return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Lead SOP body
// ---------------------------------------------------------------------------

export type LeadSOPMember = {
	id: string
	flowname: string
	duty: string
}

export type LeadSOPPhase = {
	phase: number
	name: string
	steps: string[]
}

export type LeadSOPWorkflow = {
	id: string
	name: string
	trigger: string
	scope: string
}

export type LeadSOPBodyInput = {
	teamDisplay: string
	leadFlowname: string
	members: ReadonlyArray<LeadSOPMember>
	sopPhases?: ReadonlyArray<LeadSOPPhase>
	routingTable?: ReadonlyArray<readonly [question: string, target: string]>
	workflows?: ReadonlyArray<LeadSOPWorkflow>
}

/** Build a default 4-Phase SOP for a small team. Phases are intentionally
 *  domain-agnostic so they read sensibly for any team composition.
 *
 *  - Phase 1: 立项 (主理人亲做)
 *  - Phase 2: 调度 (主理人派单)
 *  - Phase 3: 并行执行 (并行调度 N 个成员)
 *  - Phase 4: 终审签发 (主理人亲做)
 *
 *  For teams with 4+ non-lead members, an extra "汇审核验" phase is
 *  inserted between execution and sign-off. */
function defaultSOPPhases(args: {
	leadFlowname: string
	memberCount: number
}): LeadSOPPhase[] {
	const {leadFlowname, memberCount} = args
	const memberNames = args.memberCount > 0 ? `${memberCount} 个成员` : '成员'
	const phases: LeadSOPPhase[] = [
		{
			phase: 1,
			name: `需求立项 (${leadFlowname}亲做)`,
			steps: [
				`解析用户诉求,识别: 业务目标 / 用户角色 / 核心场景 / 关键约束`,
				`拆解为可分派的子任务清单,标注依赖关系与并行机会`,
				`输出「立项卡」(项目背景 / 业务目标 / 验收标准 / 风险点),下发到对应成员`,
			],
		},
		{
			phase: 2,
			name: `成员调度 (${leadFlowname}派单)`,
			steps: [
				`按立项卡派单给团队成员,每个子任务明确: 输入 / 产出 / 验收标准`,
				`识别可并行的子任务,一次性下发,避免串行等待`,
			],
		},
		{
			phase: 3,
			name: `并行执行 (并行调度${memberNames})`,
			steps: [
				`成员独立完成各自子任务,产出通过 SendMessage 回传给${leadFlowname}`,
				`${leadFlowname}验收每份产出: 完整性 / 契约一致性 / 规范符合度`,
				`对未通过验收的子任务打回,要求成员修订后重交`,
			],
		},
	]
	if (memberCount >= 4) {
		phases.push({
			phase: 4,
			name: `汇总裁验 (${leadFlowname}汇总)`,
			steps: [
				`汇总所有成员产出,核对跨成员的接口契约一致性`,
				`识别产出之间的冲突与缺口,必要时补一轮派单`,
			],
		})
	}
	phases.push({
		phase: memberCount >= 4 ? 5 : 4,
		name: `终审签发 (${leadFlowname}亲做)`,
		steps: [
			`综合全部产出做最终签发判断`,
			`✅ **直接交付**: 全部验收通过,可交付用户`,
			`🔁 **修订后交付**: 列出具体修订项,修订后重审`,
			`❌ **打回重做**: 核心实现有问题,重走相关 Phase`,
			`输出最终交付物: 交付清单 / 风险预案 / 下一步建议`,
		],
	})
	return phases
}

/** Build a default Workflow A/B/C/D block matching the WorkBuddy team
 *  convention. Workflow names are intentionally generic. */
function defaultWorkflows(): LeadSOPWorkflow[] {
	return [
		{
			id: 'A',
			name: '常规全流程',
			trigger: '用户提出完整需求(从 0 到 1 或重大功能)',
			scope: 'Phase 1-4/5 全跑,标准 SOP',
		},
		{
			id: 'B',
			name: '单点技术咨询',
			trigger: '用户提纯技术问题(选型 / 调优 / 定位)',
			scope: '跳过立项与签发,主理人直接调对应成员单点回答',
		},
		{
			id: 'C',
			name: '产出评审直出',
			trigger: '用户给一段产出要求评审',
			scope: '跳过立项与调度,主理人直接调相关成员评审',
		},
		{
			id: 'D',
			name: '纯查询直出',
			trigger: '"xxx 是什么意思" / "yyy 怎么做"',
			scope: '跳过全 SOP,主理人直接回答',
		},
	]
}

/** Build the lead .md body (the part AFTER the frontmatter).
 *  Format mirrors `scripts/generate-team-md.mjs#buildLeadBody`. */
export function buildLeadSOPBody(args: LeadSOPBodyInput): string {
	const lines: string[] = []
	const teamDisplay = args.teamDisplay
	const lead = args.leadFlowname

	lines.push(`# ${teamDisplay} - 主理人 ${lead}`)
	lines.push('')
	lines.push(`${lead}是${teamDisplay}的调度官与终审签发人。`)
	lines.push(`${lead}负责拆任务、派单、控质量、审终稿。`)
	lines.push('')

	// 团队成员
	lines.push('## 团队成员')
	lines.push('')
	lines.push('| 成员 ID | 花名 | 职责 |')
	lines.push('|---------|------|------|')
	for (const m of args.members) {
		lines.push(`| ${m.id} | ${m.flowname} | ${m.duty} |`)
	}
	lines.push('')

	// SOP
	lines.push('## 标准工作流程(SOP)')
	lines.push('')
	const phases =
		args.sopPhases ?? defaultSOPPhases({leadFlowname: lead, memberCount: args.members.length - 1})
	for (const p of phases) {
		lines.push(`### Phase ${p.phase}: ${p.name}`)
		lines.push('')
		for (const step of p.steps) lines.push(`- ${step}`)
		lines.push('')
	}

	// 路由表
	if (args.routingTable && args.routingTable.length > 0) {
		lines.push('## 单 Agent 直调路由表')
		lines.push('')
		lines.push('| 问法类型 | 直接调谁 |')
		lines.push('|---------|---------|')
		for (const row of args.routingTable) {
			lines.push(`| ${row[0]} | ${row[1]} |`)
		}
		lines.push('')
	}

	// 预设 Workflow
	lines.push('## 预设 Workflow')
	lines.push('')
	const workflows = args.workflows ?? defaultWorkflows()
	for (const w of workflows) {
		lines.push(`### Workflow ${w.id}: ${w.name}`)
		lines.push(`- **触发**: ${w.trigger}`)
		lines.push(`- **范围**: ${w.scope}`)
		lines.push('')
	}

	// 铁律
	lines.push('## 团队协作机制(铁律)')
	lines.push('')
	lines.push('你必须走正式的**团队协作流程**,严禁简化或跳过:')
	lines.push('')
	lines.push('1. **建立团队**: 任务开始时由主理人亲自创建团队(TeamCreate),明确协作边界。**团队创建必须且只能由主理人执行,严禁委派任何成员创建团队**')
	lines.push('2. **调度成员**: 按 SOP 阶段将成员拉入协作、下发独立任务;成员作为独立协作方输出专业产出,不得由主理人代写')
	lines.push('3. **消息中转**: 成员产出回传给主理人,由主理人汇总、转交下一阶段;所有跨成员信息流必须经主理人中转,不得互相直连')
	lines.push('4. **成员结论为准**: 任何专业产出必须由对应成员输出后再采信,主理人只做编排与汇编')
	lines.push('')
	lines.push('### 严禁行为')
	lines.push('- ❌ 禁止跳过 TeamCreate,直接自己模拟成员发言或并行写出多角色内容')
	lines.push('- ❌ 禁止自己代写任何团队成员的专业产出')
	lines.push('- ❌ 禁止未完成前序阶段就跳到后续阶段')
	lines.push('- ❌ 禁止让成员互相直连通信,所有跨成员信息流必须经主理人中转')
	lines.push('- ❌ 禁止 spawn 主理人自己')
	lines.push('')

	// 协作规则
	lines.push('## 协作规则')
	lines.push('')
	lines.push('1. 所有成员调度必须经过"建立团队 → 调度成员 → 成员回传"流程')
	lines.push('2. 每阶段结束后,将完整产出原文传递给下一阶段成员')
	lines.push('3. 每完成一个阶段向用户简要通报')
	lines.push('4. 所有输出使用与用户原始需求相同的语言(默认中文)')
	lines.push('5. 调度成员时,Agent 工具的 `name` 参数传入成员的 **Agent ID**(MD 文件名,不含 .md),`subagent_type` 也传入相同值。禁止使用中文名或自创名称')
	lines.push('6. 用户身份默认为研发/运营专业级,沟通默认按专业级对话,不降智解释基础概念')
	lines.push('')

	return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Member body
// ---------------------------------------------------------------------------

export type MemberBodyInput = {
	roleTitle: string
	flowname: string
	identity: ReadonlyArray<string>
	capabilities: ReadonlyArray<string>
	workflow: ReadonlyArray<string>
	outputStandards: ReadonlyArray<string>
}

/** Build a member .md body. Format mirrors
 *  `scripts/generate-team-md.mjs#buildMemberBody`. */
export function buildMemberBody(m: MemberBodyInput): string {
	const lines: string[] = []
	lines.push(`# ${m.roleTitle} - ${m.flowname}`)
	lines.push('')
	// 身份
	lines.push('## 身份')
	for (const para of m.identity) lines.push(para, '')
	// 核心能力
	lines.push('## 核心能力')
	for (const cap of m.capabilities) lines.push(`- ${cap}`)
	lines.push('')
	// 工作流程
	lines.push('## 工作流程')
	for (const step of m.workflow) lines.push(`- ${step}`)
	lines.push('')
	// 输出规范
	lines.push('## 输出规范')
	for (const s of m.outputStandards) lines.push(`- ${s}`)
	lines.push('')
	// SendMessage 回传
	lines.push('## SendMessage 回传')
	lines.push('完成工作后, **必须通过 SendMessage 将完整产出回传给主理人**。')
	lines.push('回传内容必须包含:')
	lines.push('1. 完整产出(代码 / 文章 / 报告 / 配置等)')
	lines.push('2. 关键指标 / 截图 / 数据支撑')
	lines.push('3. 风险点 / 注意事项')
	lines.push('4. 建议下一步动作')
	lines.push('')
	return lines.join('\n')
}

// ---------------------------------------------------------------------------
// High-level composite builders
// ---------------------------------------------------------------------------

/** Build a full .md file (frontmatter + body) for a team lead. */
export function buildLeadMarkdown(args: {
	id: string
	description: string
	displayName: I18nString
	profession: I18nString
	maxTurns: number
	teamDisplay: string
	leadFlowname: string
	members: ReadonlyArray<LeadSOPMember>
	sopPhases?: ReadonlyArray<LeadSOPPhase>
	routingTable?: ReadonlyArray<readonly [question: string, target: string]>
	workflows?: ReadonlyArray<LeadSOPWorkflow>
}): string {
	const fm = buildAgentFrontmatter({
		id: args.id,
		description: args.description,
		displayName: args.displayName,
		profession: args.profession,
		maxTurns: args.maxTurns,
	})
	const body = buildLeadSOPBody({
		teamDisplay: args.teamDisplay,
		leadFlowname: args.leadFlowname,
		members: args.members,
		sopPhases: args.sopPhases,
		routingTable: args.routingTable,
		workflows: args.workflows,
	})
	return fm + body
}

/** Build a full .md file (frontmatter + body) for a team member. */
export function buildMemberMarkdown(args: {
	id: string
	description: string
	displayName: I18nString
	profession: I18nString
	maxTurns: number
	roleTitle: string
	flowname: string
	identity: ReadonlyArray<string>
	capabilities: ReadonlyArray<string>
	workflow: ReadonlyArray<string>
	outputStandards: ReadonlyArray<string>
}): string {
	const fm = buildAgentFrontmatter({
		id: args.id,
		description: args.description,
		displayName: args.displayName,
		profession: args.profession,
		maxTurns: args.maxTurns,
	})
	const body = buildMemberBody({
		roleTitle: args.roleTitle,
		flowname: args.flowname,
		identity: args.identity,
		capabilities: args.capabilities,
		workflow: args.workflow,
		outputStandards: args.outputStandards,
	})
	return fm + body
}

// ---------------------------------------------------------------------------
// Helpers used by the create_team handler
// ---------------------------------------------------------------------------

/** Resolve a member's "flowname" (Chinese display name) from an i18n value.
 *  Used to build the lead's 团队成员 table. */
export {i18nToZh as resolveFlowname}

/** Default per-member placeholder content. Used when `member_agents` is a
 *  string referencing an existing agent-type expert — we don't want to
 *  author arbitrary prompts at create-time, so we emit a stub that the
 *  user can fill in via `edit`. The stub deliberately avoids `[TODO]`
 *  (which the validator forbids) by phrasing requirements explicitly. */
export function buildPlaceholderMemberBody(args: {
	roleTitle: string
	flowname: string
	referencedAgent?: string
}): string {
	const refs = args.referencedAgent
		? `本成员引用已存在的 agent-type 专家「${args.referencedAgent}」的 prompt 作为完整工作流定义。`
		: '本成员的完整 prompt 待主理人后续通过 `edit` 完善。'
	return buildMemberBody({
		roleTitle: args.roleTitle,
		flowname: args.flowname,
		identity: [
			`${args.flowname}是本团队的${args.roleTitle},负责对应领域的专业产出。`,
			refs,
		],
		capabilities: [
			'对应领域的专业能力(待主理人完善)',
			'独立完成主理人派发的子任务',
			'按规范产出并通过 SendMessage 回传给主理人',
		],
		workflow: [
			'接收主理人派单: 输入 / 产出 / 验收标准',
			'独立完成子任务,按工作流程执行',
			'通过 SendMessage 将完整产出回传给主理人',
		],
		outputStandards: [
			'产出格式遵循团队统一规范',
			'关键决策点附理由说明',
			'风险点显式标注',
		],
	})
}
