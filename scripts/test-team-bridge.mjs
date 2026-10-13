// Smoke test for the ExpertManager (WorkBuddy-compatible) + bridge to TeamCreate.
//
// Verifies:
//   1. listExperts returns both agent and team experts
//   2. ExpertManagerTool's input schema accepts new WorkBuddy fields:
//        - tags/quickPrompts as {en, zh} objects (or strings)
//        - version, author, displayDescription, avatar, plugin, teamInfo
//        - workflows on create_team
//   3. ExpertManagerTool's output schema accepts new WorkBuddy fields:
//        - leadFile, agentFiles, avatarPath, readmePath
//   4. expertRunner.runExpertTeamReal is exported
//   5. The prompt.ts DESCRIPTION includes the WorkBuddy SOP template
//   6. loadAgentsDir registers team members as `expert:<team>:<member>`
//   7. parseExpertDir can read a .codebuddy-plugin/plugin.json (WorkBuddy format)

import {homedir} from 'node:os'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

const ROOT = join(homedir(), '.claude', 'experts')

async function main() {
	// 1. listExperts works for both agent and team types
	if (!existsSync(ROOT)) {
		console.log('(no ~/.claude/experts — skipping live list test)')
	} else {
		const {listExperts} = await import(
			'../src/tools/ExpertManagerTool/expertStorage.ts'
		)
		const agents = await listExperts('all', 'agent')
		const teams = await listExperts('all', 'team')
		console.log(`listExperts('all','agent'): ${agents.length} agents`)
		console.log(`listExperts('all','team'):  ${teams.length} teams`)
		for (const a of agents.slice(0, 3)) {
			console.log(`  agent: ${a.name} (${a.source}) v${a.version ?? '?'}`)
		}
		for (const t of teams) {
			const memberCount = t.members?.length ?? 0
			const leadFile = t.leadFile ? ' leadFile=✓' : ''
			console.log(
				`  team: ${t.name} (${t.source}) v${t.version ?? '?'} ` +
					`teamInfo=${t.teamInfo ? '✓' : '✗'} members=${memberCount}${leadFile}`,
			)
		}

		// 1a. WorkBuddy layout invariant: team members must NOT exist as
		// separate top-level experts. A team's members live only in
		// <team>/agents/<member>.md. Top-level dirs for member slugs would
		// be a duplicate.
		const topLevel = new Set([
			...agents.map(a => a.name),
			...teams.map(t => t.name),
		])
		const memberAsTopLevel = []
		for (const t of teams) {
			for (const m of t.members ?? []) {
				const id = m.id ?? m.agentName
				if (id && topLevel.has(id) && id !== t.name) {
					memberAsTopLevel.push(`${id} (in ${t.name})`)
				}
			}
		}
		console.log(
			`  invariant: top-level experts not duplicated as team members: ${
				memberAsTopLevel.length === 0 ? '✓' : '✗ ' + memberAsTopLevel.join(', ')
			}`,
		)
		if (memberAsTopLevel.length > 0) {
			throw new Error(
				`WorkBuddy layout violated: ${memberAsTopLevel.length} member(s) exist as top-level experts: ${memberAsTopLevel.join(', ')}. Run scripts/merge-team-members.mjs.`,
			)
		}
	}

	// 2. Input schema accepts WorkBuddy i18n + new fields
	const {inputSchema, outputSchema} = await import(
		'../src/tools/ExpertManagerTool/types.js'
	)

	// 2a. create with i18n tags/quickPrompts/version/author/displayDescription/avatar/plugin
	const createI18nInput = inputSchema.parse({
		action: 'create',
		name: 'smoke-test-i18n',
		displayName: {en: 'Smoke Test', zh: '冒烟测试'},
		profession: {en: 'Tester', zh: '测试员'},
		description: '冒烟测试专家,验证 i18n 字段在 schema 中正确接受对象',
		categoryId: '06-ContentCreative',
		tags: [
			{en: 'Smoke', zh: '冒烟'},
			'en-only-tag',
			{en: 'WorkBuddy'},
		],
		quickPrompts: [
			{en: 'Run a smoke test', zh: '跑一次冒烟测试'},
			'Quick prompt 2',
			{en: 'Quick prompt 3', zh: '快速提示 3'},
		],
		prompt: 'You are a smoke test expert.',
		version: '1.0.0',
		author: {name: 'Smoke Test', email: 'tester' + '@' + 'example.com'},
		displayDescription: {en: 'Long description', zh: '长描述'},
		avatar: 'avatars/team.png',
		plugin: 'smoke-test-i18n',
	})
	console.log('create i18n parsed:', {
		name: createI18nInput.name,
		version: createI18nInput.version,
		avatar: createI18nInput.avatar,
		plugin: createI18nInput.plugin,
		tagsType: Array.isArray(createI18nInput.tags)
			? typeof createI18nInput.tags[0]
			: '?',
	})
	if (createI18nInput.version !== '1.0.0') throw new Error('version not preserved')
	if (createI18nInput.avatar !== 'avatars/team.png') throw new Error('avatar not preserved')
	if (createI18nInput.plugin !== 'smoke-test-i18n') throw new Error('plugin not preserved')

	// 2b. create_team with teamInfo / agents / workflows
	const createTeamI18nInput = inputSchema.parse({
		action: 'create_team',
		name: 'smoke-test-team',
		displayName: {en: 'Smoke Test Team', zh: '冒烟测试团'},
		profession: {en: 'Team Tester', zh: '团队测试员'},
		description: '冒烟测试团队,验证 teamInfo / workflows / 多成员',
		categoryId: '06-ContentCreative',
		tags: [
			{en: 'Team', zh: '团队'},
			{en: 'Smoke', zh: '冒烟'},
			{en: 'WorkBuddy'},
		],
		quickPrompts: [
			{en: 'Run team smoke test', zh: '跑团队冒烟测试'},
			'q2',
			'q3',
		],
		leader_agent: 'smoke-test-i18n',
		member_agents: ['smoke-test-i18n'],
		version: '1.0.0',
		author: {name: 'Smoke Test'},
		avatar: 'avatars/team.png',
		plugin: 'smoke-test-team',
		workflows: [
			{id: 'A', name: 'Workflow A', trigger: 'Full SOP', scope: 'Phase 1-5'},
			{id: 'B', name: 'Single agent', trigger: 'Direct question', scope: 'Skip SOP'},
		],
	})
	console.log('create_team i18n parsed:', {
		name: createTeamI18nInput.name,
		workflows: createTeamI18nInput.workflows?.length,
	})
	if (createTeamI18nInput.workflows?.length !== 2) {
		throw new Error('workflows not preserved')
	}

	// 2c. edit accepts new fields
	const editInput = inputSchema.parse({
		action: 'edit',
		name: 'smoke-test-i18n',
		version: '1.1.0',
		author: {name: 'New Author'},
		avatar: 'avatars/v2.png',
		teamInfo: {leadAgent: 'lead-x', memberAgents: ['m1']},
	})
	console.log('edit parsed:', {
		version: editInput.version,
		avatar: editInput.avatar,
		teamInfo: editInput.teamInfo,
	})

	// 3. Output schema accepts WorkBuddy fields
	const viewOutput = outputSchema.parse({
		action: 'view',
		expert: {
			meta: {
				name: 'smoke-test-team',
				expertType: 'team',
				agentName: 'smoke-test-team',
				displayName: {en: 'Smoke', zh: '冒烟'},
				profession: {zh: '冒烟'},
				description: '冒烟测试',
				categoryId: '06-ContentCreative',
				tags: [{en: 't1', zh: '标1'}, {en: 't2', zh: '标2'}, {en: 't3', zh: '标3'}],
				quickPrompts: [
					{en: 'q1', zh: '问1'},
					{en: 'q2', zh: '问2'},
					{en: 'q3', zh: '问3'},
				],
				defaultInitPrompt: {en: 'q1', zh: '问1'},
				version: '1.0.0',
				author: {name: 'Test'},
				displayDescription: {en: 'long', zh: '长描述'},
				avatar: 'avatars/team.png',
				plugin: 'smoke-test-team',
				teamInfo: {leadAgent: 'smoke-test-i18n', memberAgents: ['m1']},
				agents: ['./agents/lead.md', './agents/m1.md'],
			},
			prompt: 'You are a smoke test team.',
			scope: 'user',
			path: '/tmp',
			leadFile: '/tmp/agents/lead.md',
			agentFiles: [{id: 'lead', path: '/tmp/agents/lead.md'}],
			avatarPath: '/tmp/avatars/team.png',
			readmePath: '/tmp/README.md',
		},
	})
	console.log('view output parsed:', {
		hasLeadFile: 'leadFile' in viewOutput.expert,
		hasAgentFiles: 'agentFiles' in viewOutput.expert,
		hasAvatarPath: 'avatarPath' in viewOutput.expert,
		hasReadmePath: 'readmePath' in viewOutput.expert,
	})

	// 4. expertRunner.runExpertTeamReal is exported
	const runner = await import(
		'../src/tools/ExpertManagerTool/expertRunner.js'
	)
	const hasReal = typeof runner.runExpertTeamReal === 'function'
	const hasCleanup = typeof runner.cleanupTeamIfPresent === 'function'
	const hasRunExpert = typeof runner.runExpert === 'function'
	const hasRunExpertTeam = typeof runner.runExpertTeam === 'function'
	console.log('runExpert:', hasRunExpert)
	console.log('runExpertTeam:', hasRunExpertTeam)
	console.log('runExpertTeamReal:', hasReal)
	console.log('cleanupTeamIfPresent:', hasCleanup)
	if (!hasReal) throw new Error('runExpertTeamReal not exported')
	if (!hasCleanup) throw new Error('cleanupTeamIfPresent not exported')

	// 5. prompt.ts DESCRIPTION includes WorkBuddy SOP template
	const {DESCRIPTION, getPrompt} = await import(
		'../src/tools/ExpertManagerTool/prompt.js'
	)
	const hasWorkBuddy = DESCRIPTION.includes('WorkBuddy') || DESCRIPTION.includes('workbuddy')
	const hasSOP = DESCRIPTION.includes('SOP') || DESCRIPTION.includes('工作流程')
	const hasIronRules = DESCRIPTION.includes('铁律') || DESCRIPTION.includes('Iron rules')
	const hasRuntimeDoc = DESCRIPTION.includes('`auto`') && DESCRIPTION.includes('`team`')
	const hasTeamNaming = DESCRIPTION.includes('-team-lead')
	console.log('prompt DESCRIPTION:')
	console.log('  has WorkBuddy refs:', hasWorkBuddy)
	console.log('  has SOP:', hasSOP)
	console.log('  has iron rules:', hasIronRules)
	console.log('  has runtime doc:', hasRuntimeDoc)
	console.log('  has team-lead naming convention:', hasTeamNaming)
	if (!hasWorkBuddy) throw new Error('WorkBuddy refs missing from prompt')
	if (!hasSOP) throw new Error('SOP template missing from prompt')
	if (!hasIronRules) throw new Error('iron rules missing from prompt')
	if (!hasRuntimeDoc) throw new Error('runtime field docs missing from prompt')
	if (!hasTeamNaming) throw new Error('team-lead naming convention missing from prompt')

	// 6. loadAgentsDir references expert registration including team members
	const ROOT_DIR = join(import.meta.dir, '..')
	const loadSrc = await Bun.file(
		join(ROOT_DIR, 'src/tools/AgentTool/loadAgentsDir.ts'),
	).text()
	const hasExpertReg = /ExpertManagerTool\/expertStorage/.test(loadSrc)
	const hasTeamMemberReg = /expert:\$\{team\.name\}:\$\{memberId\}/.test(loadSrc)
	const hasLeadReg = /expert:\$\{expert\.name\}/.test(loadSrc)
	const hasMaxTurnsPlumb = /fm\.maxTurns|maxTurns !== undefined/.test(loadSrc)
	console.log('loadAgentsDir:')
	console.log('  imports expertStorage:', hasExpertReg)
	console.log('  registers team members:', hasTeamMemberReg)
	console.log('  registers agent/team-lead:', hasLeadReg)
	console.log('  plumbs maxTurns:', hasMaxTurnsPlumb)
	if (!hasExpertReg) throw new Error('loadAgentsDir does not import expertStorage')
	if (!hasTeamMemberReg) throw new Error('loadAgentsDir does not register team members')
	if (!hasLeadReg) throw new Error('loadAgentsDir does not register agent/team-lead')
	if (!hasMaxTurnsPlumb) throw new Error('loadAgentsDir does not plumb maxTurns')

	// 7. parseExpertDir reads .codebuddy-plugin/plugin.json (WorkBuddy format)
	const parseSrc = await Bun.file(
		join(ROOT_DIR, 'src/tools/ExpertManagerTool/src/parseExpert.ts'),
	).text()
	const hasWbPath = /\.codebuddy-plugin/.test(parseSrc)
	const hasLegacyFallback = /legacyPath/.test(parseSrc)
	const hasAgentName = /agentName/.test(parseSrc) && /name/.test(parseSrc)
	console.log('parseExpert:')
	console.log('  reads .codebuddy-plugin/plugin.json:', hasWbPath)
	console.log('  has legacy fallback:', hasLegacyFallback)
	console.log('  supports name + agentName frontmatter:', hasAgentName)
	if (!hasWbPath) throw new Error('parseExpert does not read .codebuddy-plugin/plugin.json')
	if (!hasLegacyFallback) throw new Error('parseExpert missing legacy fallback')

	// 8. types.ts has the new WorkBuddy fields
	const typesSrc = await Bun.file(
		join(ROOT_DIR, 'src/tools/ExpertManagerTool/types.ts'),
	).text()
	const hasI18n = /i18nStringSchema|i18nBilingualSchema/.test(typesSrc)
	const hasVersion = /version:\s*z\.string\(\)\.regex/.test(typesSrc)
	const hasAuthor = /author:\s*authorSchema/.test(typesSrc)
	const hasDisplayDesc = /displayDescription/.test(typesSrc)
	const hasAvatar = /avatar:\s*z\.string\(\)\.optional/.test(typesSrc)
	const hasTeamInfo = /teamInfo:\s*teamInfoSchema/.test(typesSrc)
	const hasAgents = /agents:\s*z\s*\n\s*\.array\(/.test(typesSrc)
	console.log('types.ts:')
	console.log('  has i18n schemas:', hasI18n)
	console.log('  has version field:', hasVersion)
	console.log('  has author field:', hasAuthor)
	console.log('  has displayDescription:', hasDisplayDesc)
	console.log('  has avatar:', hasAvatar)
	console.log('  has teamInfo:', hasTeamInfo)
	console.log('  has agents[]:', hasAgents)
	if (!hasI18n) throw new Error('types.ts missing i18n schemas')
	if (!hasVersion) throw new Error('types.ts missing version field')
	if (!hasAuthor) throw new Error('types.ts missing author field')
	if (!hasDisplayDesc) throw new Error('types.ts missing displayDescription')
	if (!hasAvatar) throw new Error('types.ts missing avatar field')
	if (!hasTeamInfo) throw new Error('types.ts missing teamInfo field')
	if (!hasAgents) throw new Error('types.ts missing agents[] field')

	// 9. Verify the imported WorkBuddy team is visible (if user ran the importer)
	if (existsSync(ROOT)) {
		const {listExperts: listExperts2} = await import(
			'../src/tools/ExpertManagerTool/expertStorage.ts'
		)
		const allExperts = await listExperts2('all', 'all')
		const wbTeam = allExperts.find(e => e.name === 'toutiao-finance-account-ops-team')
		if (wbTeam) {
			console.log()
			console.log('WorkBuddy team imported:')
			console.log('  name:', wbTeam.name)
			console.log('  expertType:', wbTeam.expertType)
			console.log('  version:', wbTeam.version)
			console.log('  author:', wbTeam.author?.name)
			console.log('  teamInfo:', wbTeam.teamInfo ? 'present' : 'missing')
			console.log('  members:', wbTeam.members?.length ?? 0)
			console.log('  agentFiles:', wbTeam.agentFiles?.size ?? 0)
			console.log('  avatarPath:', wbTeam.avatarPath ?? '(not found)')
			console.log('  readmePath:', wbTeam.readmePath ?? '(not present)')
		} else {
			console.log()
			console.log('(WorkBuddy team not imported — run scripts/import-workbuddy-team.mjs)')
		}
	}

	// 10. NEW: create_team schema accepts both legacy (string) and rich (object)
	// member_agents forms, plus lead-specific overrides and custom SOP.
	const {inputSchema: schema10} = await import(
		'../src/tools/ExpertManagerTool/types.js'
	)

	// 10a. Legacy string form (backward compat)
	const legacyInput = schema10.parse({
		action: 'create_team',
		name: 'smoke-team-legacy',
		displayName: {en: 'Legacy Team', zh: '老格式团队'},
		profession: {en: 'Legacy', zh: '老格式'},
		description: '老格式成员验证,确认 string[] 仍被接受',
		categoryId: '06-ContentCreative',
		tags: [{en: 'a', zh: '甲'}, {en: 'b', zh: '乙'}, {en: 'c', zh: '丙'}],
		quickPrompts: [{en: 'q1', zh: '问1'}, {en: 'q2', zh: '问2'}, {en: 'q3', zh: '问3'}],
		leader_agent: 'smoke-test-i18n',
		member_agents: ['smoke-test-i18n'],
	})
	if (!Array.isArray(legacyInput.member_agents)) {
		throw new Error('legacy string[] not accepted by create_team schema')
	}
	if (legacyInput.member_agents[0] !== 'smoke-test-i18n') {
		throw new Error('legacy member_agents content not preserved')
	}
	console.log('10a. legacy string[] form: ✓')

	// 10b. Rich object form
	const richInput = schema10.parse({
		action: 'create_team',
		name: 'smoke-team-rich',
		displayName: {en: 'Rich Team', zh: '富对象团队'},
		profession: {en: 'Rich', zh: '富对象'},
		description: '富对象成员验证,确认每个成员可传 displayName 等元数据',
		categoryId: '06-ContentCreative',
		tags: [{en: 'a', zh: '甲'}, {en: 'b', zh: '乙'}, {en: 'c', zh: '丙'}],
		quickPrompts: [{en: 'q1', zh: '问1'}, {en: 'q2', zh: '问2'}, {en: 'q3', zh: '问3'}],
		// leader_agent omitted — the lead is created as an internal role
		leadDisplayName: {en: 'Architect Chen', zh: '陈架构'},
		leadProfession: {en: 'Chief Architect', zh: '首席架构师'},
		leadFlowname: '陈架构',
		leadMaxTurns: 250,
		member_agents: [
			{
				id: 'backend',
				agentName: 'smoke-test-i18n',
				displayName: {en: 'Backend Zhang', zh: '后端张'},
				profession: {en: 'Backend Engineer', zh: '后端工程师'},
				description: 'Backend engineer on the smoke team.',
				maxTurns: 60,
			},
			{
				id: 'frontend',
				displayName: {en: 'Frontend Li', zh: '前端李'},
				profession: {en: 'Frontend Engineer', zh: '前端工程师'},
			},
		],
		sopPhases: [
			{phase: 1, name: '需求立项', steps: ['解析需求', '拆任务']},
			{phase: 2, name: '执行', steps: ['后端写', '前端写']},
			{phase: 3, name: '终审签发', steps: ['主理人验收', '交付']},
		],
		routingTable: [['实现接口', 'backend'], ['做页面', 'frontend']],
		workflows: [
			{id: 'A', name: '完整', trigger: '完整需求', scope: '全部 Phase'},
		],
	})
	if (!Array.isArray(richInput.member_agents)) {
		throw new Error('rich object[] not accepted by create_team schema')
	}
	const member0 = richInput.member_agents[0]
	if (typeof member0 !== 'object' || member0.id !== 'backend') {
		throw new Error('rich member_agents[0] not parsed as object with id=backend')
	}
	if (member0.maxTurns !== 60) {
		throw new Error('per-member maxTurns not preserved')
	}
	if (richInput.leadMaxTurns !== 250) {
		throw new Error('leadMaxTurns not preserved')
	}
	if (richInput.sopPhases?.length !== 3) {
		throw new Error('sopPhases not preserved')
	}
	if (richInput.routingTable?.length !== 2) {
		throw new Error('routingTable not preserved')
	}
	console.log('10b. rich object[] form + lead overrides + sopPhases: ✓')

	// 10c. leadPrompt override (skip auto-SOP)
	const overrideInput = schema10.parse({
		action: 'create_team',
		name: 'smoke-team-override',
		displayName: {en: 'Override', zh: '覆盖'},
		profession: {en: 'Override', zh: '覆盖'},
		description: '验证 leadPrompt 覆盖自动生成的 SOP 模板',
		categoryId: '06-ContentCreative',
		tags: [{en: 'a', zh: '甲'}, {en: 'b', zh: '乙'}, {en: 'c', zh: '丙'}],
		quickPrompts: [{en: 'q1', zh: '问1'}, {en: 'q2', zh: '问2'}, {en: 'q3', zh: '问3'}],
		member_agents: ['smoke-test-i18n'],
		leadPrompt: '# Custom lead prompt\n\nI am the lead.',
	})
	if (overrideInput.leadPrompt !== '# Custom lead prompt\n\nI am the lead.') {
		throw new Error('leadPrompt not preserved')
	}
	console.log('10c. leadPrompt override: ✓')

	// 11. SOP template module produces WorkBuddy-shape output
	const {buildLeadSOPBody, buildMemberBody, buildAgentFrontmatter, resolveFlowname} =
		await import('../src/tools/ExpertManagerTool/sopTemplate.js')

	// 11a. Frontmatter contains the right keys
	const fm = buildAgentFrontmatter({
		id: 'test-id',
		description: 'A test frontmatter',
		displayName: {en: 'Test EN', zh: '测试'},
		profession: {en: 'Tester', zh: '测试员'},
		maxTurns: 50,
	})
	for (const key of ['name: test-id', 'description: A test frontmatter', 'displayName:', 'en: Test EN', 'zh: 测试', 'profession:', 'en: Tester', 'zh: 测试员', 'maxTurns: 50']) {
		if (!fm.includes(key)) {
			throw new Error(`buildAgentFrontmatter missing "${key}":\n${fm}`)
		}
	}
	console.log('11a. buildAgentFrontmatter shape: ✓')

	// 11b. Lead body contains the standard sections
	const leadBody = buildLeadSOPBody({
		teamDisplay: '测试团队',
		leadFlowname: '主理人甲',
		members: [
			{id: 'team-lead', flowname: '主理人甲', duty: '调度 + 签发'},
			{id: 'm1', flowname: '成员乙', duty: '领域专家'},
		],
	})
	for (const section of [
		'# 测试团队 - 主理人 主理人甲',
		'## 团队成员',
		'## 标准工作流程(SOP)',
		'### Phase 1:',
		'## 预设 Workflow',
		'## 团队协作机制(铁律)',
		'### 严禁行为',
		'## 协作规则',
	]) {
		if (!leadBody.includes(section)) {
			throw new Error(`buildLeadSOPBody missing "${section}":\n${leadBody}`)
		}
	}
	if (leadBody.includes('[TODO')) {
		throw new Error('buildLeadSOPBody emitted [TODO] placeholder (validator would reject)')
	}
	console.log('11b. buildLeadSOPBody sections: ✓')

	// 11c. Member body contains the standard sections
	const memberBody = buildMemberBody({
		roleTitle: '工程师',
		flowname: '成员乙',
		identity: ['我是成员乙。', '负责工程。'],
		capabilities: ['写代码', '测试'],
		workflow: ['接单', '完成', '回传'],
		outputStandards: ['代码风格一致'],
	})
	for (const section of [
		'# 工程师 - 成员乙',
		'## 身份',
		'## 核心能力',
		'## 工作流程',
		'## 输出规范',
		'## SendMessage 回传',
	]) {
		if (!memberBody.includes(section)) {
			throw new Error(`buildMemberBody missing "${section}":\n${memberBody}`)
		}
	}
	console.log('11c. buildMemberBody sections: ✓')

	// 11d. resolveFlowname picks zh over en
	if (resolveFlowname({en: 'English', zh: '中文'}) !== '中文') {
		throw new Error('resolveFlowname should prefer zh')
	}
	if (resolveFlowname({en: 'English only'}) !== 'English only') {
		throw new Error('resolveFlowname should fall back to en')
	}
	if (resolveFlowname(undefined) !== '') {
		throw new Error('resolveFlowname should return empty for undefined')
	}
	console.log('11d. resolveFlowname: ✓')

	// 11e. ExpertManagerTool.create_team handler exists and uses the SOP template
	const toolSrc = await Bun.file(
		join(ROOT_DIR, 'src/tools/ExpertManagerTool/ExpertManagerTool.ts'),
	).text()
	const usesSopTemplate = /buildLeadSOPBody/.test(toolSrc) && /buildMemberBody/.test(toolSrc)
	const populatesTeamMemberMeta = /teamMemberMeta\.set/.test(toolSrc)
	if (!usesSopTemplate) throw new Error('create_team handler does not call sopTemplate')
	if (!populatesTeamMemberMeta) throw new Error('create_team handler does not populate teamMemberMeta')
	console.log('11e. ExpertManagerTool.create_team wired to sopTemplate: ✓')

	console.log()
	console.log('✅ WorkBuddy compatibility smoke test passed')
}

main().catch(e => {
	console.error('❌ test failed:', e)
	process.exit(1)
})
