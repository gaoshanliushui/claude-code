/**
 * Constants for the ExpertManager tool.
 *
 * Mirrors WorkBuddy's `expert-manager` built-in skill: a single tool that
 * manages custom AI "experts" (expertType=agent) and "expert teams"
 * (expertType=team) — each is a directory under `experts/<slug>/` containing
 * `plugin.json` (identity card) and `agents/<slug>.md` (system prompt).
 */
export const EXPERT_MANAGER_TOOL_NAME = 'ExpertManager'

export const EXPERTS_SUBDIR = 'experts'

export const EXPERT_AGENT_FILENAME = 'agents' // subdir inside an expert dir
export const EXPERT_PLUGIN_FILENAME = 'plugin.json'
export const EXPERT_PROMPT_FILENAME_SUFFIX = '.md'

/**
 * Category IDs for `plugin.json` `categoryId`. Mirrors the WorkBuddy 12/15
 * industry categories. Free-form strings are also accepted, but these are
 * suggested defaults for the model.
 */
export const EXPERT_CATEGORIES = [
	'finance',
	'healthcare',
	'legal',
	'education',
	'engineering',
	'marketing',
	'product',
	'design',
	'research',
	'operations',
	'sales',
	'hr',
	'creative',
	'science',
	'general',
] as const

export type ExpertCategory = (typeof EXPERT_CATEGORIES)[number]

export const EXPERT_SCOPES = ['user', 'project', 'all'] as const
export type ExpertScope = (typeof EXPERT_SCOPES)[number]

export const EXPERT_TYPES = ['agent', 'team', 'all'] as const
export type ExpertTypeFilter = (typeof EXPERT_TYPES)[number]

export const EXPERT_ACTIONS = [
	'list',
	'view',
	'create',
	'create_team',
	'edit',
	'delete',
	'validate',
	'invoke',
] as const
export type ExpertAction = (typeof EXPERT_ACTIONS)[number]

/**
 * Slug regex — kebab-case / snake_case alphanumeric, no slashes, dots, or
 * shell metacharacters. Mirrors the implicit rule used by WorkBuddy's
 * `init_expert.py` (and by Claude Code's agentType field, which must be a
 * single token).
 */
export const EXPERT_SLUG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
