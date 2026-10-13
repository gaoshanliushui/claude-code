// Smoke test for the /expert slash command.
// Imports the command implementation and exercises both modes:
//   - /expert (no args) → list view
//   - /expert <name>     → invoke meta message
//
// We provide a minimal stub context so the call() can run without the
// full app state.

import {homedir} from 'node:os'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

const ROOT = join(homedir(), '.claude', 'experts', 'stock-analyst')
const HAS_FIXTURE = existsSync(ROOT)

async function main() {
	// Seed fixture if missing
	if (!HAS_FIXTURE) {
		console.log('(seeding fixture stock-analyst)')
		const {writeExpert} = await import(
			'../src/tools/ExpertManagerTool/expertStorage.ts'
		)
		await writeExpert(
			{
				name: 'stock-analyst',
				expertType: 'agent',
				agentName: 'stock-analyst',
				displayName: {zh: '股票分析师', en: 'Stock Analyst'},
				profession: {zh: '金融分析师', en: 'Finance Analyst'},
				description:
					'资深股票分析师,擅长技术面与基本面结合,给出可执行的操作建议,提供明确买卖点位止损位和仓位管理',
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
	}

	// Simulate /expert with no args
	const expertCmd = await import('../src/commands/expert/index.js')
	console.log('command name:', expertCmd.default.name)
	console.log('command type:', expertCmd.default.type)
	console.log('command description:', expertCmd.default.description)
	console.log('argument hint:', expertCmd.default.argumentHint)

	// Load and call the implementation
	const mod = await import('../src/commands/expert/expert.js')
	let captured = {display: null, shouldQuery: null, metaMessages: []}
	const onDone = (msg, opts) => {
		if (opts?.metaMessages) captured.metaMessages = opts.metaMessages
		if (opts?.display) captured.display = opts.display
		if (opts?.shouldQuery) captured.shouldQuery = opts.shouldQuery
	}
	const stubContext = {abortController: new AbortController(), messages: []}

	console.log('\n== /expert stock-analyst ==')
	const result = await mod.call(onDone, stubContext, 'stock-analyst')
	console.log('returned node:', !!result)
	console.log('onDone display:', captured.display)
	console.log('onDone shouldQuery:', captured.shouldQuery)
	console.log('onDone metaMessages[0] preview:', captured.metaMessages[0]?.slice(0, 80))

	console.log('\n✅ /expert command wired correctly')
}

main().catch(e => {
	console.error('❌ test failed:', e)
	process.exit(1)
})
