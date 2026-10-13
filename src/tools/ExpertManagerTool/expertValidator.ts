/**
 * Static validator for an Expert definition. Mirrors the rules encoded in
 * WorkBuddy's `validate_expert.py`:
 *
 *   - plugin.json has all required fields
 *   - tags.length === 3, quickPrompts.length === 3
 *   - description: if it contains CJK characters, must be 40-50 chars
 *   - defaultInitPrompt === quickPrompts[0]
 *   - expertType=team requires non-empty members, each resolvable
 *   - .md frontmatter has agentName (non-empty), no body-level [TODO]s
 *
 * Returns a list of structured errors so callers can surface them in the
 * tool_result / UI without throwing.
 */
import {readExpert} from './expertStorage.js'
import type {
	Expert,
	ExpertScope,
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
		const first = Array.isArray(expert.quickPrompts)
			? expert.quickPrompts[0]
			: undefined
		if (first !== undefined && expert.defaultInitPrompt !== first) {
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

	// description length rule (CJK only — English text has no length rule)
	if (typeof expert.description === 'string') {
		const cjk = cjkCharCount(expert.description)
		if (cjk > 0 && (cjk < 40 || cjk > 50)) {
			errors.push({
				field: 'description',
				message: `description contains ${cjk} CJK chars; must be 40-50 (WorkBuddy rule)`,
			})
		}
	} else {
		errors.push({
			field: 'description',
			message: 'description is required',
		})
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
				if (!member.agentName) {
					errors.push({
						field: `members[${i}].agentName`,
						message: 'member.agentName is required',
					})
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
