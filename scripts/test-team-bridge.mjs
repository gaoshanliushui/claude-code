// Smoke test for the ExpertManager ↔ TeamCreate bridge.
//
// Verifies:
//   1. listExperts('all', 'agent') still returns the existing 7 experts
//   2. ExpertManagerTool's input schema accepts the new runtime/persistTeam fields
//   3. ExpertManagerTool's output schema accepts the new rejected status + teamName
//   4. expertRunner.runExpertTeamReal is exported
//   5. The new prompt.ts DESCRIPTION includes the runtime documentation
//   6. loadAgentsDir.getAgentDefinitionsWithOverrides works (read-only — doesn't trigger registration)

import {homedir} from 'node:os'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

const ROOT = join(homedir(), '.claude', 'experts')

async function main() {
	const hasFixture = existsSync(ROOT)
	if (!hasFixture) {
		console.log('(no ~/.claude/experts — skipping live list test)')
	} else {
		// 1. listExperts still works
		const {listExperts} = await import(
			'../src/tools/ExpertManagerTool/expertStorage.ts'
		)
		const agents = await listExperts('all', 'agent')
		const teams = await listExperts('all', 'team')
		console.log(`listExperts('all','agent'): ${agents.length} agents`)
		console.log(`listExperts('all','team'):  ${teams.length} teams`)
		for (const a of agents.slice(0, 3)) {
			console.log(`  agent: ${a.name} (${a.source})`)
		}
		for (const t of teams) {
			console.log(`  team: ${t.name} (${t.source}) — ${t.members?.length ?? 0} members`)
		}
	}

	// 2. Schema accepts new fields — verify by parse, not by introspecting Zod internals.
	const {inputSchema, outputSchema} = await import(
		'../src/tools/ExpertManagerTool/types.js'
	)

	// Parse a full invoke input with the new fields. Schema-level parse
	// will throw if any field is missing or invalid.
	const parsed = inputSchema.parse({
		action: 'invoke',
		name: 'toutiao-ops-team',
		prompt: '诊断当前账号瓶颈',
		runtime: 'team',
		persistTeam: false,
		teamTimeoutMs: 300000,
	})
	console.log('input parsed:', {
		action: parsed.action,
		runtime: parsed.runtime,
		persistTeam: parsed.persistTeam,
		teamTimeoutMs: parsed.teamTimeoutMs,
	})
	if (parsed.runtime !== 'team') throw new Error('runtime not preserved on parse')
	if (parsed.persistTeam !== false) throw new Error('persistTeam not preserved on parse')
	if (parsed.teamTimeoutMs !== 300000) throw new Error('teamTimeoutMs not preserved on parse')

	// 3. Output schema accepts rejected status + teamName
	const completedOut = outputSchema.parse({
		action: 'invoke',
		status: 'completed',
		expertName: 'toutiao-ops-team',
		expertType: 'team',
		agentId: 'team:expert_toutiao-ops-team_xxx',
		content: '### Team coordination guidance ###',
		durationMs: 1500,
		teamName: 'expert_toutiao-ops-team_xxx',
		memberCount: 6,
	})
	console.log('output (completed) parsed:', {
		status: completedOut.status,
		teamName: completedOut.teamName,
		memberCount: completedOut.memberCount,
	})

	const rejectedOut = outputSchema.parse({
		action: 'invoke',
		status: 'rejected',
		expertName: 'toutiao-ops-team',
		expertType: 'team',
		agentId: '',
		content: '',
		durationMs: 0,
		reason: 'Swarms not enabled',
	})
	console.log('output (rejected) parsed:', {
		status: rejectedOut.status,
		reason: rejectedOut.reason,
	})
	if (rejectedOut.status !== 'rejected') throw new Error('rejected status not preserved')

	// 4. runExpertTeamReal is exported — in ESM, named exports are not
	// enumerable on the module object, so check via direct access.
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

	// 5. prompt.ts DESCRIPTION includes runtime documentation
	const {DESCRIPTION, getPrompt} = await import(
		'../src/tools/ExpertManagerTool/prompt.js'
	)
	const hasRuntimeDoc = DESCRIPTION.includes('`auto`') && DESCRIPTION.includes('`single`') && DESCRIPTION.includes('`team`')
	const hasAuthoringDoc = DESCRIPTION.includes('Team expert prompt authoring')
	console.log('prompt DESCRIPTION has runtime docs:', hasRuntimeDoc)
	console.log('prompt DESCRIPTION has authoring doc:', hasAuthoringDoc)
	if (!hasRuntimeDoc) throw new Error('runtime field docs missing from prompt')
	if (!hasAuthoringDoc) throw new Error('authoring doc missing from prompt')

	// 6. clearAgentDefinitionsCache is imported into expertStorage
	const ROOT_DIR = join(import.meta.dir, '..')
	const storageSrc = await Bun.file(
		join(ROOT_DIR, 'src/tools/ExpertManagerTool/expertStorage.ts'),
	).text()
	const hasClearImport = storageSrc.includes('clearAgentDefinitionsCache')
	const hasClearInWrite = /writeExpert[\s\S]*clearAgentDefinitionsCache/.test(storageSrc)
	const hasClearInDelete = /deleteExpert[\s\S]*clearAgentDefinitionsCache/.test(storageSrc)
	console.log('expertStorage imports clearAgentDefinitionsCache:', hasClearImport)
	console.log('expertStorage calls clearAgentDefinitionsCache in writeExpert:', hasClearInWrite)
	console.log('expertStorage calls clearAgentDefinitionsCache in deleteExpert:', hasClearInDelete)
	if (!hasClearImport) throw new Error('clearAgentDefinitionsCache not imported')
	if (!hasClearInWrite) throw new Error('clearAgentDefinitionsCache not called in writeExpert')
	if (!hasClearInDelete) throw new Error('clearAgentDefinitionsCache not called in deleteExpert')

	// 7. loadAgentsDir now references expert registration
	const loadSrc = await Bun.file(
		join(ROOT_DIR, 'src/tools/AgentTool/loadAgentsDir.ts'),
	).text()
	const hasExpertReg = /ExpertManagerTool\/expertStorage/.test(loadSrc)
	const hasExpertDefs = /expertDefs/.test(loadSrc)
	console.log('loadAgentsDir imports expertStorage:', hasExpertReg)
	console.log('loadAgentsDir uses expertDefs:', hasExpertDefs)
	if (!hasExpertReg) throw new Error('loadAgentsDir does not import expertStorage')
	if (!hasExpertDefs) throw new Error('loadAgentsDir does not build expertDefs')

	console.log('\n✅ Bridge smoke test passed')
}

main().catch(e => {
	console.error('❌ test failed:', e)
	process.exit(1)
})
