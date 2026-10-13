import {homedir} from 'node:os'
import {existsSync} from 'node:fs'
import {rm} from 'node:fs/promises'
import {join} from 'node:path'

const TEAM_NAME = 'test-create-team-keep'
const TEAM_DIR = join(homedir(), '.claude', 'experts', TEAM_NAME)

if (existsSync(TEAM_DIR)) {
	await rm(TEAM_DIR, {recursive: true, force: true})
}

const {ExpertManagerTool} = await import(
	'../src/tools/ExpertManagerTool/ExpertManagerTool.ts'
)

const input = {
	action: 'create_team',
	name: TEAM_NAME,
	displayName: {en: 'Visual Check', zh: '可视化检查'},
	profession: {en: 'Tester', zh: '测试员'},
	description: '可视化检查 create_team 生成的 lead 与 member .md 实际渲染效果',
	categoryId: '06-ContentCreative',
	tags: [{en: 'a', zh: '甲'}, {en: 'b', zh: '乙'}, {en: 'c', zh: '丙'}],
	quickPrompts: [{en: 'q1', zh: '问1'}, {en: 'q2', zh: '问2'}, {en: 'q3', zh: '问3'}],
	leadDisplayName: {en: 'Lead Check', zh: '主理验'},
	leadFlowname: '主理验',
	member_agents: [
		{
			id: 'role-alpha',
			displayName: {en: 'Alpha', zh: '甲'},
			profession: {en: 'Alpha Engineer', zh: '甲工程师'},
			description: 'Member alpha on the visual check team.',
			maxTurns: 70,
		},
		{
			id: 'role-beta',
			displayName: {en: 'Beta', zh: '乙'},
			profession: {en: 'Beta Engineer', zh: '乙工程师'},
		},
	],
}
await ExpertManagerTool.call(input, {}, () => true)
console.log(`Created. Inspect at: ${TEAM_DIR}`)
console.log(`Run: rm -rf ${TEAM_DIR} to clean up`)
