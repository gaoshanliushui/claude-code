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
			{id: 'A', name: {en: 'Workflow A', zh: '工作流 A'}, phases: ['1', '2']},
			{id: 'B', phases: ['1']},
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

	console.log()
	console.log('✅ WorkBuddy compatibility smoke test passed')
}

main().catch(e => {
	console.error('❌ test failed:', e)
	process.exit(1)
})
