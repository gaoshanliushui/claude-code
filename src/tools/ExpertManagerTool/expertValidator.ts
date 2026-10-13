/**
 * Static validator for an Expert definition. Mirrors the rules encoded in
 * WorkBuddy's `validate_expert.py`:
 *
 *   - plugin.json has all required fields
 *   - tags.length === 3, quickPrompts.length === 3
 *   - description: if it contains CJK characters, must be 40-50 chars
 *   - defaultInitPrompt equals quickPrompts[0]
 *   - expertType=team requires non-empty members, each resolvable
 *   - .md frontmatter has agentName (non-empty), no body-level [TODO]s
 *   - teamInfo (if present) has leadAgent and memberAgents
 *   - teamInfo.leadAgent must be in members[]
 *   - version (if present) is semver
 *
 * Returns a list of structured errors so callers can surface them in the
 * tool_result / UI without throwing.
 */
import {readExpert} from './expertStorage.js'
import type {
	Expert,
	ExpertScope,
	I18nString,
	ValidationError,
	ValidationResult,
} from './types.js'

/** Count CJK characters in a string (loose definition: any char in the
 *  CJK Unified Ideographs blocks). Used for the 40-50 char description rule. */
function cjkCharCount(s: string): number {
	let count = 0
	for (const ch of s) {
		const code = ch.codePointAt(0) ?? 0
		if (
			(code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
			(code >= 0x3400 && code <= 0x4dbf) || // CJK Ext A
			(code >= 0xf900 && code <= 0xfaff) // CJK Compat Ideographs
		) {
			count++
		}
	}
	return count
}

/** Extract a string from an i18n value (zh preferred, en fallback, first non-empty). */
function i18nToString(v: I18nString | undefined): string {
	if (!v) return ''
	if (typeof v === 'string') return v
	return v.zh ?? v.en ?? ''
}

/** Pick the i18n text that's most likely to satisfy the CJK 40-50 char rule.
 *  For WorkBuddy-shaped {en, zh} fields, prefer zh when present. */
function pickDescriptionForCjkCheck(v: I18nString | undefined): string {
	if (!v) return ''
	if (typeof v === 'string') return v
	return v.zh ?? v.en ?? ''
}

/** Validate an already-loaded Expert object. Pure function — does no I/O. */
export function validateExpertObject(expert: Expert): ValidationResult {
	const errors: ValidationError[] = []

	if (!expert.name) errors.push({field: 'name', message: 'name is required'})
	if (!expert.agentName)
		errors.push({field: 'agentName', message: 'agentName is required'})
	if (expert.expertType !== 'agent' && expert.expertType !== 'team') {
		errors.push({
			field: 'expertType',
			message: `expertType must be "agent" or "team" (got "${expert.expertType}")`,
		})
	}
	if (!expert.displayName) {
		errors.push({field: 'displayName', message: 'displayName is required'})
	}
	if (!expert.profession) {
		errors.push({field: 'profession', message: 'profession is required'})
	}
	if (!expert.categoryId) {
		errors.push({field: 'categoryId', message: 'categoryId is required'})
	}

	// version (optional, but if present must be semver)
	if (expert.version !== undefined && !/^\d+\.\d+\.\d+/.test(expert.version)) {
		errors.push({
			field: 'version',
			message: `version must be semver (got "${expert.version}")`,
		})
	}

	// author (optional, but if present must have a name)
	if (expert.author && !expert.author.name) {
		errors.push({
			field: 'author',
			message: 'author.name is required when author is set',
		})
	}

	// tags
	if (!Array.isArray(expert.tags) || expert.tags.length !== 3) {
		errors.push({
			field: 'tags',
			message: `tags must contain exactly 3 entries (got ${Array.isArray(expert.tags) ? expert.tags.length : 'not-an-array'})`,
		})
	}

	// quickPrompts
	if (!Array.isArray(expert.quickPrompts) || expert.quickPrompts.length !== 3) {
		errors.push({
			field: 'quickPrompts',
			message: `quickPrompts must contain exactly 3 entries (got ${Array.isArray(expert.quickPrompts) ? expert.quickPrompts.length : 'not-an-array'})`,
		})
	}

	// defaultInitPrompt matches quickPrompts[0]
	if (expert.defaultInitPrompt) {
		const firstRaw = Array.isArray(expert.quickPrompts)
			? expert.quickPrompts[0]
			: undefined
		const first = i18nToString(firstRaw)
		const def = i18nToString(expert.defaultInitPrompt)
		if (first && def && def !== first) {
			errors.push({
				field: 'defaultInitPrompt',
				message: 'defaultInitPrompt must equal quickPrompts[0]',
			})
		}
	} else {
		errors.push({
			field: 'defaultInitPrompt',
			message: 'defaultInitPrompt is required',
		})
	}

	// description length rule (CJK only — English text has no length rule).
	// For i18n description fields, prefer zh (most likely to have CJK).
	if (typeof expert.description === 'string') {
		const cjk = cjkCharCount(expert.description)
		if (cjk > 0 && (cjk < 40 || cjk > 50)) {
			errors.push({
				field: 'description',
				message: `description contains ${cjk} CJK chars; must be 40-50 (WorkBuddy rule)`,
			})
		}
	} else {
		// i18n object
		const desc = pickDescriptionForCjkCheck(expert.description)
		if (!desc) {
			errors.push({field: 'description', message: 'description is required'})
		} else {
			const cjk = cjkCharCount(desc)
			if (cjk > 0 && (cjk < 40 || cjk > 50)) {
				errors.push({
					field: 'description',
					message: `description contains ${cjk} CJK chars; must be 40-50 (WorkBuddy rule)`,
				})
			}
		}
	}

	// team-specific
	if (expert.expertType === 'team') {
		if (!Array.isArray(expert.members) || expert.members.length === 0) {
			errors.push({
				field: 'members',
				message: 'team experts must declare at least one member',
			})
		} else {
			for (const [i, member] of expert.members.entries()) {
				if (!member.id && !member.agentName) {
					errors.push({
						field: `members[${i}]`,
						message: 'member must have at least one of id or agentName',
					})
				}
			}
		}

		// teamInfo (optional, but if present must be self-consistent)
		if (expert.teamInfo) {
			if (!expert.teamInfo.leadAgent) {
				errors.push({
					field: 'teamInfo.leadAgent',
					message: 'teamInfo.leadAgent is required when teamInfo is set',
				})
			}
			if (
				!Array.isArray(expert.teamInfo.memberAgents) ||
				expert.teamInfo.memberAgents.length === 0
			) {
				errors.push({
					field: 'teamInfo.memberAgents',
					message: 'teamInfo.memberAgents must be a non-empty array',
				})
			}
			// leadAgent should be findable in members[]
			if (expert.teamInfo.leadAgent && Array.isArray(expert.members)) {
				const found = expert.members.some(
					m =>
						m.id === expert.teamInfo!.leadAgent ||
						m.agentName === expert.teamInfo!.leadAgent,
				)
				if (!found) {
					errors.push({
						field: 'teamInfo.leadAgent',
						message: `teamInfo.leadAgent "${expert.teamInfo.leadAgent}" not found in members[]`,
					})
				}
			}
			// all memberAgents should be findable in members[]
			if (Array.isArray(expert.teamInfo.memberAgents) && Array.isArray(expert.members)) {
				for (const id of expert.teamInfo.memberAgents) {
					const found = expert.members.some(
						m => m.id === id || m.agentName === id,
					)
					if (!found) {
						errors.push({
							field: 'teamInfo.memberAgents',
							message: `memberAgent "${id}" not found in members[]`,
						})
					}
				}
			}
		}
	}

	// .md frontmatter sanity: no leftover [TODO] placeholders
	if (typeof expert.prompt === 'string' && expert.prompt.includes('[TODO')) {
		errors.push({
			field: 'prompt',
			message: 'prompt body still contains [TODO] placeholders',
		})
	}

	return {valid: errors.length === 0, errors}
}

/** Convenience wrapper that loads + validates. */
export async function validateExpert(
	slug: string,
	scope: ExpertScope | undefined,
): Promise<ValidationResult & {expert: Expert | null}> {
	const expert = await readExpert(slug, scope)
	if (!expert) {
		return {
			valid: false,
			errors: [{field: 'name', message: `expert "${slug}" not found`}],
			expert: null,
		}
	}
	const result = validateExpertObject(expert)
	return {...result, expert}
}
