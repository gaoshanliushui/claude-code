// Verifies that common typo variants of expert subagent_type are not
// silently registered, so the Agent tool's "agent not found" path
// (AgentTool.tsx:400) gives a clear error message.
//
// We just check the registry — the Agent tool itself does the
// helpful error formatting at runtime, so we just need to make sure
// the typo doesn't accidentally match a real agent.
//
// Run: bun run scripts/test-experts-typo.mjs

import {homedir} from 'node:os'

const {getAgentDefinitionsWithOverrides} = await import(
	'../src/tools/AgentTool/loadAgentsDir.ts'
)

const {activeAgents} = await getAgentDefinitionsWithOverrides(homedir())
const registered = new Set(activeAgents.map(a => a.agentType))

const typos = [
	// real IDs
	'expert:software-dev-team',
	'expert:software-dev-team:backend-engineer',
	'expert:software-dev-team:qa-engineer',
	// typos: spaces
	'expert: software-dev-team',
	'expert:software-dev-team: backend-engineer',
	'expert: software-dev-team:backend-engineer',
	// typos: slashes instead of colons
	'expert:software-dev-team/backend-engineer',
	// typos: case mismatch
	'expert:Software-dev-team',
	'expert:software-dev-team:Backend-Engineer',
	// typos: extra colon
	'expert::software-dev-team',
	'expert:software-dev-team::backend-engineer',
	// typos: trailing/leading whitespace
	'expert:software-dev-team:backend-engineer ',
	// typos: missing "expert:" prefix
	'software-dev-team:backend-engineer',
	'software-dev-team',
	// bogus names
	'expert:totally-bogus-team',
	'expert:software-dev-team:nonexistent-member',
]

let failures = 0
for (const t of typos) {
	const isReal = t === 'expert:software-dev-team' || t === 'expert:software-dev-team:backend-engineer' || t === 'expert:software-dev-team:qa-engineer'
	const inRegistry = registered.has(t)
	const ok = isReal ? inRegistry : !inRegistry
	if (!ok) failures++
	console.log(`${ok ? '✓' : '✗'} ${JSON.stringify(t)} — ${isReal ? 'should be REGISTERED' : 'should NOT be registered'} (${inRegistry ? 'registered' : 'absent'})`)
}

console.log()
if (failures === 0) {
	console.log(`✅ all ${typos.length} typo cases behave as expected`)
	process.exit(0)
} else {
	console.log(`❌ ${failures}/${typos.length} typo cases mis-handled`)
	process.exit(1)
}
