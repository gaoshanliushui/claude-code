import {homedir} from 'node:os'
import {existsSync} from 'node:fs'
import {readFile, rm} from 'node:fs/promises'
import {join} from 'node:path'

const TEAM_NAME = 'test-legacy-form'
const TEAM_DIR = join(homedir(), '.claude', 'experts', TEAM_NAME)

if (existsSync(TEAM_DIR)) {
	await rm(TEAM_DIR, {recursive: true, force: true})
}

const {ExpertManagerTool} = await import(
	'../src/tools/ExpertManagerTool/ExpertManagerTool.ts'
)

// Step 1: create a base agent (no leader_agent)
const baseInput = {
	action: 'create',
	name: 'test-base-agent',
	displayName: {en: 'Base', zh: '基座'},
	profession: {en: 'Base', zh: '基座'},
	description: '临时基座专家用于 legacy form 测试,验证后清理,仅作测试目的用于回归验证,稍后清理掉,快速验证用完即丢',
	categoryId: '06-ContentCreative',
	tags: [{en: 'a', zh: '甲'}, {en: 'b', zh: '乙'}, {en: 'c', zh: '丙'}],
	quickPrompts: [{en: 'q1', zh: '问1'}, {en: 'q2', zh: '问2'}, {en: 'q3', zh: '问3'}],
	prompt: 'You are a base agent.',
}
await ExpertManagerTool.call(baseInput, {}, () => true)
console.log('Created base agent')

// Step 2: create team with leader_agent + string[] members (legacy form)
const teamInput = {
	action: 'create_team',
	name: TEAM_NAME,
	displayName: {en: 'Legacy Form', zh: '老格式测试团'},
	profession: {en: 'Tester', zh: '测试员'},
	description: '老格式 create_team 测试验证 leader_agent 与 string[] member_agents 仍能产出 WorkBuddy 格式目录结构与文件内容,完整复现回归测试场景验证后清理掉哦',
	categoryId: '06-ContentCreative',
	tags: [{en: 'a', zh: '甲'}, {en: 'b', zh: '乙'}, {en: 'c', zh: '丙'}],
	quickPrompts: [{en: 'q1', zh: '问1'}, {en: 'q2', zh: '问2'}, {en: 'q3', zh: '问3'}],
	leader_agent: 'test-base-agent',
	member_agents: ['test-base-agent'],
}
const result = await ExpertManagerTool.call(teamInput, {}, () => true)
console.log('Team created:', result.data.created.path)

// Verify
const leadMd = await readFile(join(TEAM_DIR, 'agents', `${TEAM_NAME}-team-lead.md`), 'utf-8')
if (!leadMd.includes('maxTurns: 200')) {
	throw new Error('legacy form: lead should have maxTurns: 200 (default)')
}
if (!leadMd.includes('## 标准工作流程(SOP)')) {
	throw new Error('legacy form: lead .md missing SOP')
}
console.log('✓ legacy form produces WorkBuddy format')

// Cleanup
await rm(TEAM_DIR, {recursive: true, force: true})
await rm(join(homedir(), '.claude', 'experts', 'test-base-agent'), {recursive: true, force: true})
console.log('Cleaned up')
