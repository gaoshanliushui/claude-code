// Smoke test for the ExpertManagerTool storage + validator layer.
// Runs without Claude — directly imports and exercises expertStorage +
// expertValidator, mimicking what the tool's `call()` would do for
// create / list / view / validate actions.
//
// Usage: bun run scripts/test-experts.mjs

import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'

const ROOT = join(homedir(), '.claude', 'experts', 'stock-analyst')

async function main() {
	const {writeExpert, listExperts, readExpert, deleteExpert, clearExpertsCache} = await import(
		'../src/tools/ExpertManagerTool/expertStorage.ts'
	)
	const {validateExpertObject} = await import(
		'../src/tools/ExpertManagerTool/expertValidator.ts'
	)

	// 1. CREATE
	console.log('== create ==')
	const created = await writeExpert(
		{
			name: 'stock-analyst',
			expertType: 'agent',
			agentName: 'stock-analyst',
			displayName: {zh: '股票分析师', en: 'Stock Analyst'},
			profession: {zh: '金融分析师', en: 'Finance Analyst'},
			description: '资深股票分析师,擅长技术面与基本面结合,给出可执行的操作建议,提供明确买卖点位止损位和仓位管理',
			categoryId: 'finance',
			tags: ['finance', 'stock', 'analysis'],
			quickPrompts: ['分析最近走势', '对比同业', '给出操作建议'],
			defaultInitPrompt: '分析最近走势',
			prompt: '你是一位资深股票分析师,精通技术面与基本面分析。',
			promptFrontmatter: {},
			source: 'user',
			path: '',
		},
		'user',
	)
	console.log('wrote at:', created.path)

	// 2. LIST
	console.log('\n== list ==')
	const list = await listExperts('all', 'all')
	const found = list.find(e => e.name === 'stock-analyst')
	console.log('found:', found?.name, found?.expertType, found?.description?.slice(0, 20))

	// 3. VIEW
	console.log('\n== view ==')
	const expert = await readExpert('stock-analyst', 'all')
	console.log('prompt len:', expert?.prompt.length, 'tags:', expert?.tags?.length)

	// 4. VALIDATE
	console.log('\n== validate ==')
	const result = validateExpertObject(expert)
	console.log('valid:', result.valid, 'errors:', result.errors.length)

	// 5. ON-DISK FILES
	console.log('\n== on-disk files ==')
	const pluginPath = join(ROOT, 'plugin.json')
	const mdPath = join(ROOT, 'agents', 'stock-analyst.md')
	console.log('plugin.json exists:', existsSync(pluginPath))
	console.log('plugin.json content:', readFileSync(pluginPath, 'utf-8').slice(0, 120))
	console.log('agents/.md exists:', existsSync(mdPath))
	console.log('agents/.md head:', readFileSync(mdPath, 'utf-8').split('\n').slice(0, 5).join('\\n'))

	// 6. DELETE
	console.log('\n== delete ==')
	const del = await deleteExpert('stock-analyst', 'all')
	console.log('deleted:', del?.path, 'root:', del?.root)
	console.log('dir exists after delete:', existsSync(ROOT))

	clearExpertsCache()
	console.log('\n✅ All paths verified')
}

main().catch(e => {
	console.error('❌ test failed:', e)
	process.exit(1)
})
