/**
 * Public surface of the read-side expert discovery module.
 *
 * The claude-code CLI does not create or modify experts — that is the
 * `expert-manager` skill's job (~/.claude/skills/expert-manager/).
 *
 * This module only handles discovery: it scans `~/.claude/experts/`
 * (and project-level `<cwd>/.claude/experts/`), parses the on-disk
 * WorkBuddy format, and returns assembled `Expert` objects.
 *
 * Used by the Agent tool's expert → agent bridge in
 * `src/tools/AgentTool/loadAgentsDir.ts` to make skill-generated experts
 * invocable as `Agent(subagent_type="expert:<slug>")` /
 * `Agent(subagent_type="expert:<team>:<member-id>")`.
 */
export {listExperts, readExpert, clearExpertsCache, clearProjectDirsCache} from './listExperts.js'
export {parseExpertDir} from './parseExpert.js'
export {
	EXPERTS_SUBDIR,
	EXPERT_SLUG_REGEX,
	expertMetaSchema,
} from './types.js'
export type {
	Expert,
	ExpertMeta,
	MemberAgentInfo,
	ExpertRoot,
	ExpertScope,
	ExpertTypeFilter,
} from './types.js'
