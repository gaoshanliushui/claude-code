// Live end-to-end test: call ExpertManagerTool.create_team and verify
// the resulting directory structure matches the WorkBuddy format.
//
// Run: bun run scripts/test-create-team-e2e.mjs

import {homedir} from 'node:os'
import {existsSync} from 'node:fs'
import {readFile, readdir, rm} from 'node:fs/promises'
import {join} from 'node:path'

const TEAM_NAME = 'test-create-team-e2e'
const TEAM_DIR = join(homedir(), '.claude', 'experts', TEAM_NAME)

async function main() {
	// Pre-clean (in case prior run failed)
	if (existsSync(TEAM_DIR)) {
		await rm(TEAM_DIR, {recursive: true, force: true})
	}

	// Load the tool. We invoke the tool's `call` directly so we exercise
	// the real handler (create_team path) end-to-end.
	const {ExpertManagerTool} = await import(
		'../src/tools/ExpertManagerTool/ExpertManagerTool.ts'
	)

	const input = {
		action: 'create_team',
		name: TEAM_NAME,
		displayName: {en: 'E2E Test Team', zh: '端到端测试团'},
		profession: {en: 'E2E Tester', zh: '端到端测试员'},
		description: '端到端测试专家团用于验证 create_team 调用生成的目录结构是否符合 WorkBuddy 格式规范预期的详细效果完整说明',
		categoryId: '06-ContentCreative',
		tags: [
			{en: 'E2E', zh: '端到端'},
			{en: 'Smoke', zh: '冒烟'},
			{en: 'WorkBuddy'},
		],
		quickPrompts: [
			{en: 'Run e2e test', zh: '跑端到端测试'},
			{en: 'Verify team', zh: '验证团队'},
			{en: 'Cleanup', zh: '清理'},
		],
		// leader_agent omitted — exercise the new "internal lead" path
		leadDisplayName: {en: 'Lead E2E', zh: '主理人测'},
		leadProfession: {en: 'Team Lead', zh: '主理人'},
		leadFlowname: '主理人测',
		leadMaxTurns: 250,
		member_agents: [
			{
				id: 'frontend-tester',
				displayName: {en: 'Frontend Li', zh: '前端李'},
				profession: {en: 'Frontend Engineer', zh: '前端工程师'},
				description: '前端工程师,负责 UI 与交互',
				maxTurns: 80,
			},
			{
				id: 'backend-tester',
				displayName: {en: 'Backend Zhang', zh: '后端张'},
				profession: {en: 'Backend Engineer', zh: '后端工程师'},
				description: '后端工程师,负责 API 与业务逻辑',
				maxTurns: 100,
			},
		],
	}

	console.log(`Creating team "${TEAM_NAME}" at ${TEAM_DIR}...`)
	const result = await ExpertManagerTool.call(input, {}, () => true)
	if (!result.data) {
		throw new Error('create_team returned no data')
	}
	const created = result.data.created
	console.log('  created at:', created.path)
	console.log('  members:', created.members.length)

	// 1. Layout: .codebuddy-plugin/plugin.json + agents/<id>.md (one per member + lead)
	const required = [
		join(TEAM_DIR, '.codebuddy-plugin', 'plugin.json'),
		join(TEAM_DIR, 'agents', `${TEAM_NAME}-team-lead.md`),
		join(TEAM_DIR, 'agents', 'frontend-tester.md'),
		join(TEAM_DIR, 'agents', 'backend-tester.md'),
	]
	for (const p of required) {
		if (!existsSync(p)) {
			throw new Error(`expected file missing: ${p}`)
		}
	}
	console.log('  layout: ✓ (plugin.json + 3 .md files)')

	// 2. plugin.json members[] has rich WorkBuddy shape
	const plugin = JSON.parse(
		await readFile(join(TEAM_DIR, '.codebuddy-plugin', 'plugin.json'), 'utf-8'),
	)
	if (plugin.expertType !== 'team') {
		throw new Error('plugin.json expertType is not "team"')
	}
	if (!Array.isArray(plugin.members) || plugin.members.length !== 3) {
		throw new Error(`plugin.json members[] should have 3 entries, got ${plugin.members?.length}`)
	}
	const leadEntry = plugin.members.find((m) => m.id === `${TEAM_NAME}-team-lead`)
	if (!leadEntry) throw new Error('plugin.json members[] missing lead')
	if (leadEntry.role !== 'lead') throw new Error('lead entry should have role=lead')
	if (leadEntry.displayName?.zh !== '主理人测') {
		throw new Error(`lead displayName.zh should be "主理人测", got ${JSON.stringify(leadEntry.displayName)}`)
	}
	const frontendEntry = plugin.members.find((m) => m.id === 'frontend-tester')
	if (!frontendEntry.displayName) throw new Error('member displayName missing')
	if (!frontendEntry.profession) throw new Error('member profession missing')
	console.log('  plugin.json members[] shape: ✓')

	// 3. Lead .md has frontmatter + body
	const leadMd = await readFile(join(TEAM_DIR, 'agents', `${TEAM_NAME}-team-lead.md`), 'utf-8')
	if (!leadMd.startsWith('---\n')) throw new Error('lead .md missing leading frontmatter')
	if (!leadMd.includes('name: ' + TEAM_NAME + '-team-lead')) {
		throw new Error('lead .md frontmatter missing name')
	}
	if (!leadMd.includes('maxTurns: 250')) {
		throw new Error('lead .md frontmatter missing maxTurns: 250')
	}
	if (!leadMd.includes('displayName:')) {
		throw new Error('lead .md frontmatter missing displayName')
	}
	if (!leadMd.includes('## 标准工作流程(SOP)')) {
		throw new Error('lead .md body missing SOP section')
	}
	if (!leadMd.includes('### Phase 1:')) {
		throw new Error('lead .md body missing Phase 1')
	}
	if (!leadMd.includes('## 团队协作机制(铁律)')) {
		throw new Error('lead .md body missing 铁律 section')
	}
	if (!leadMd.includes('### 严禁行为')) {
		throw new Error('lead .md body missing 严禁行为 section')
	}
	if (!leadMd.includes('| 成员 ID | 花名 | 职责 |')) {
		throw new Error('lead .md body missing 团队成员 table')
	}
	console.log('  lead .md (frontmatter + SOP body): ✓')

	// 4. Member .md has frontmatter + body
	const frontendMd = await readFile(join(TEAM_DIR, 'agents', 'frontend-tester.md'), 'utf-8')
	if (!frontendMd.startsWith('---\n')) throw new Error('frontend .md missing frontmatter')
	if (!frontendMd.includes('name: frontend-tester')) {
		throw new Error('frontend .md frontmatter missing name')
	}
	if (!frontendMd.includes('maxTurns: 80')) {
		throw new Error('frontend .md frontmatter missing maxTurns: 80')
	}
	if (!frontendMd.includes('displayName:')) {
		throw new Error('frontend .md frontmatter missing displayName')
	}
	for (const section of ['## 身份', '## 核心能力', '## 工作流程', '## 输出规范', '## SendMessage 回传']) {
		if (!frontendMd.includes(section)) {
			throw new Error(`frontend .md body missing "${section}"`)
		}
	}
	console.log('  member .md (frontmatter + 5 sections): ✓')

	// 5. parseExpert can read back what we wrote (round-trip)
	const {readExpert} = await import(
		'../src/tools/ExpertManagerTool/expertStorage.ts'
	)
	const reread = await readExpert(TEAM_NAME, 'user')
	if (!reread) throw new Error('readExpert returned null after writing team')
	if (reread.expertType !== 'team') throw new Error('round-trip: expertType lost')
	if (reread.members?.length !== 3) {
		throw new Error(`round-trip: members count should be 3, got ${reread.members?.length}`)
	}
	const leadMeta = reread.teamMemberMeta?.get(`${TEAM_NAME}-team-lead`)
	if (!leadMeta) throw new Error('round-trip: lead teamMemberMeta missing')
	if (leadMeta.maxTurns !== 250) {
		throw new Error(`round-trip: lead maxTurns should be 250, got ${leadMeta.maxTurns}`)
	}
	if (!leadMeta.body.includes('## 标准工作流程(SOP)')) {
		throw new Error('round-trip: lead body lost SOP section')
	}
	const frontendMeta = reread.teamMemberMeta?.get('frontend-tester')
	if (!frontendMeta) throw new Error('round-trip: frontend teamMemberMeta missing')
	if (frontendMeta.maxTurns !== 80) {
		throw new Error(`round-trip: frontend maxTurns should be 80, got ${frontendMeta.maxTurns}`)
	}
	if (!frontendMeta.body.includes('## SendMessage 回传')) {
		throw new Error('round-trip: frontend body lost SendMessage section')
	}
	console.log('  round-trip via readExpert: ✓')

	// 6. Validator passes on the round-tripped expert
	const {validateExpertObject} = await import(
		'../src/tools/ExpertManagerTool/expertValidator.ts'
	)
	const validation = validateExpertObject(reread)
	if (!validation.valid) {
		console.error('  validation errors:', JSON.stringify(validation.errors, null, 2))
		throw new Error('round-tripped team failed validation')
	}
	console.log('  validateExpertObject: ✓')

	console.log()
	console.log('✅ create_team e2e test passed')
	console.log()
	console.log('Files written:')
	const files = await readdir(join(TEAM_DIR, 'agents'))
	for (const f of files) console.log('  ' + join(TEAM_DIR, 'agents', f))
	console.log('  ' + join(TEAM_DIR, '.codebuddy-plugin', 'plugin.json'))

	// Cleanup
	await rm(TEAM_DIR, {recursive: true, force: true})
	console.log()
	console.log(`(cleaned up ${TEAM_DIR})`)
}

main().catch(async (e) => {
	console.error('❌ test failed:', e)
	if (existsSync(TEAM_DIR)) {
		await rm(TEAM_DIR, {recursive: true, force: true})
		console.error(`(cleaned up ${TEAM_DIR})`)
	}
	process.exit(1)
})
