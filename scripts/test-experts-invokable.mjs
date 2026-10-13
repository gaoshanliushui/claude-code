// Smoke test: verify that experts installed in ~/.claude/experts/ are
// correctly bridged into the Agent tool's subagent_type registry.
//
// We DO NOT call the API. We just exercise the discovery + registration
// path that the main REPL hits on every agent lookup. Specifically we
// verify three things for the real installed team `software-dev-team`:
//
//   1. `expert:software-dev-team` (team lead) is registered
//   2. `expert:software-dev-team:backend-engineer` (team member) is registered
//   3. A bogus agentType is NOT registered
//
// We also verify that for members the `getSystemPrompt()` returns the
// member .md body, so the runtime path will actually inject that body as
// the subagent's system prompt.
//
// Run: bun run scripts/test-experts-invokable.mjs

import {homedir} from 'node:os'
import {join} from 'node:path'

const TEAM = 'software-dev-team'

// Load the bridge code from the running CLI. We need to point loadAgentsDir
// at the user's actual home (not Bun's process cwd) so it finds
// ~/.claude/experts/. The function is memoized on cwd, so we pass homedir
// explicitly.
const {getAgentDefinitionsWithOverrides} = await import(
	'../src/tools/AgentTool/loadAgentsDir.ts'
)

const {activeAgents} = await getAgentDefinitionsWithOverrides(homedir())

// Index by agentType for easy lookup
const byType = new Map(activeAgents.map(a => [a.agentType, a]))

const checks = []

function check(label, ok, detail) {
	checks.push({label, ok, detail})
	console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

// 1. Team lead registered
const lead = byType.get(`expert:${TEAM}`)
check(
	`team lead "expert:${TEAM}" registered`,
	Boolean(lead),
	lead ? `whenToUse="${(lead.whenToUse ?? '').slice(0, 80)}..."` : 'NOT REGISTERED',
)

// 2. Team member registered
const backend = byType.get(`expert:${TEAM}:backend-engineer`)
check(
	`team member "expert:${TEAM}:backend-engineer" registered`,
	Boolean(backend),
	backend ? `whenToUse="${(backend.whenToUse ?? '').slice(0, 80)}..."` : 'NOT REGISTERED',
)

// 3. Bogus agentType NOT registered
const bogus = byType.get(`expert:${TEAM}:does-not-exist`)
check(
	`bogus "expert:${TEAM}:does-not-exist" is NOT registered`,
	!bogus,
)

// 4. Member's getSystemPrompt returns the .md body (not the plugin.json prompt)
if (backend) {
	const sysPrompt = backend.getSystemPrompt()
	const containsIdentity = sysPrompt.includes('身份') || sysPrompt.includes('后端') || sysPrompt.includes('张')
	check(
		`member system prompt contains member body markers`,
		containsIdentity,
		`len=${sysPrompt.length}, first 60 chars: ${JSON.stringify(sysPrompt.slice(0, 60))}`,
	)
}

// 5. Member's maxTurns is from frontmatter (not plugin.json)
if (backend) {
	check(
		`member maxTurns resolved from frontmatter`,
		typeof backend.maxTurns === 'number' && backend.maxTurns > 0,
		`maxTurns=${backend.maxTurns}`,
	)
}

// 6. Lead system prompt is from lead .md body, not the plugin.json "prompt" field.
//    (The .md body has "标准工作流程" / SOP markers; plugin.json "prompt" is just
//    a one-paragraph role description.)
if (lead) {
	const sysPrompt = lead.getSystemPrompt()
	const hasSop = sysPrompt.includes('标准工作流程') || sysPrompt.includes('SOP')
	check(
		`team lead system prompt contains SOP markers (i.e. from .md, not plugin.json)`,
		hasSop,
		`first 60 chars: ${JSON.stringify(sysPrompt.slice(0, 60))}`,
	)
}

// 7. All declared members of software-dev-team are registered
if (lead) {
	// We need plugin.json to know declared members. Read it.
	const pluginPath = join(homedir(), '.claude', 'experts', TEAM, '.codebuddy-plugin', 'plugin.json')
	const {readFile} = await import('node:fs/promises')
	const plugin = JSON.parse(await readFile(pluginPath, 'utf-8'))
	const declaredMembers = (plugin.members ?? []).map(m => m.id).filter(Boolean)
	for (const memberId of declaredMembers) {
		const def = byType.get(`expert:${TEAM}:${memberId}`)
		check(
			`member "${memberId}" registered`,
			Boolean(def),
		)
	}
}

// Summary
console.log()
const failed = checks.filter(c => !c.ok)
if (failed.length === 0) {
	console.log(`✅ all ${checks.length} checks passed`)
	process.exit(0)
} else {
	console.log(`❌ ${failed.length}/${checks.length} checks failed`)
	process.exit(1)
}
