/**
 * Read-side expert discovery (skill-managed).
 *
 * Searches three roots, in priority order: managed → user → project. The
 * project root is itself multiple directories (one per .claude/ found
 * walking from cwd up to git root), matching
 * `markdownConfigLoader.getProjectDirsUpToHome`. Within a single expert
 * lookup, project shadows user shadows managed (later wins on conflict).
 *
 * Reads are memoized per (slug, scope) pair.
 *
 * The CLI does NOT write experts — that's the `expert-manager` skill's job.
 * This module is purely for discovery and bridging into the Agent tool
 * registry. If you need to invalidate the cache (e.g. after installing a
 * new expert via the skill), call `clearExpertsCache()` or run /clear in
 * the REPL.
 */
import {existsSync, statSync} from 'fs'
import memoize from 'lodash-es/memoize.js'
import {homedir} from 'os'
import {dirname, join, resolve} from 'path'
import {getClaudeConfigHomeDir} from '../envUtils.js'
import {getManagedFilePath} from '../settings/managedPath.js'
import {getCwd} from '../cwd.js'
import {logForDebugging} from '../debug.js'
import {findGitRoot} from '../git.js'
import {normalizePathForComparison} from '../file.js'
import {parseExpertDir} from './parseExpert.js'
import type {Expert, ExpertRoot, ExpertScope, ExpertTypeFilter} from './types.js'
import {EXPERTS_SUBDIR} from './types.js'

/** Path to the experts dir for a given root. */
function getExpertRootDir(root: ExpertRoot): string {
	switch (root) {
		case 'managed':
			return join(getManagedFilePath(), '.claude', EXPERTS_SUBDIR)
		case 'user':
			return join(getClaudeConfigHomeDir(), EXPERTS_SUBDIR)
		case 'project':
			return join('.claude', EXPERTS_SUBDIR) // base name; project is multi-dir
	}
}

/** All project-level experts dirs (from cwd up to git root). Cached because
 *  the projectDirs walk is moderately expensive and is called per read.
 *
 *  Mirrors the logic in `markdownConfigLoader.getProjectDirsUpToHome` but
 *  is independent (the loader's `ClaudeConfigDirectory` union doesn't
 *  include `experts`). */
const projectDirsCache = new Map<string, string[]>()

function getProjectExpertDirs(cwd: string): string[] {
	const cached = projectDirsCache.get(cwd)
	if (cached) return cached
	const home = resolve(homedir()).normalize('NFC')
	const gitRoot = findGitRoot(cwd)
	let current = resolve(cwd)
	const dirs: string[] = []

	while (true) {
		if (normalizePathForComparison(current) === normalizePathForComparison(home)) {
			break
		}
		const claudeSubdir = join(current, '.claude', EXPERTS_SUBDIR)
		try {
			statSync(claudeSubdir)
			dirs.push(claudeSubdir)
		} catch {
			// ENOENT or inaccessible — skip
		}
		if (
			gitRoot &&
			normalizePathForComparison(current) === normalizePathForComparison(gitRoot)
		) {
			break
		}
		const parent = dirname(current)
		if (parent === current) break
		current = parent
	}

	projectDirsCache.set(cwd, dirs)
	return dirs
}

/** Invalidate the project dirs cache. */
export function clearProjectDirsCache(): void {
	projectDirsCache.clear()
}

/** All roots that should be searched for an expert read. */
function getSearchRoots(
	scope: ExpertScope | undefined,
): Array<{root: ExpertRoot; dir: string}> {
	const effective: ExpertScope = scope ?? 'all'
	const roots: Array<{root: ExpertRoot; dir: string}> = []

	if (effective === 'managed' || effective === 'all') {
		roots.push({root: 'managed', dir: getExpertRootDir('managed')})
	}
	if (effective === 'user' || effective === 'all') {
		roots.push({root: 'user', dir: getExpertRootDir('user')})
	}
	if (effective === 'project' || effective === 'all') {
		for (const dir of getProjectExpertDirs(getCwd())) {
			roots.push({root: 'project', dir})
		}
	}
	return roots
}

/** Internal: read a single expert from one specific root dir. */
async function readExpertFromRoot(
	dir: string,
	slug: string,
	root: ExpertRoot,
): Promise<Expert | null> {
	const expertDir = join(dir, slug)
	if (!existsSync(expertDir)) return null
	return parseExpertDir(expertDir, slug, root)
}

/** Read a single expert by slug. Project shadows user shadows managed. */
export const readExpert = memoize(
	async (
		slug: string,
		scope: ExpertScope | undefined,
	): Promise<Expert | null> => {
		const roots = getSearchRoots(scope)
		// Iterate managed → user → project; first hit wins.
		for (const {root, dir} of roots) {
			const expert = await readExpertFromRoot(dir, slug, root)
			if (expert) return expert
		}
		return null
	},
	(slug, scope) => `${slug}::${scope ?? 'all'}`,
)

/** List all experts. Project experts shadow user experts of the same name;
 *  user experts shadow managed experts. */
export const listExperts = memoize(
	async (
		scope: ExpertScope | undefined,
		typeFilter: ExpertTypeFilter | undefined,
	): Promise<Expert[]> => {
		const roots = getSearchRoots(scope)
		const byName = new Map<string, Expert>()

		// managed first, then user, then project — later (higher priority) overwrites.
		for (const {root, dir} of roots) {
			if (!existsSync(dir)) continue
			let entries: string[]
			try {
				const dirEntries = await import('fs/promises').then(m =>
					m.readdir(dir, {withFileTypes: true}),
				)
				entries = dirEntries
					.filter(e => e.isDirectory() || e.isSymbolicLink())
					.map(e => e.name)
			} catch {
				continue
			}
			for (const slug of entries) {
				if (byName.has(slug)) continue // higher-priority root already won
				const expert = await readExpertFromRoot(dir, slug, root)
				if (!expert) continue
				if (typeFilter && typeFilter !== 'all' && expert.expertType !== typeFilter) {
					continue
				}
				byName.set(slug, expert)
			}
		}
		return Array.from(byName.values()).sort((a, b) =>
			a.name.localeCompare(b.name),
		)
	},
	(scope, type) => `${scope ?? 'all'}::${type ?? 'all'}`,
)

/** Invalidate the read cache. Call this if a new expert appears on disk
 *  (e.g. installed via the skill) and you want the next call to see it
 *  without restarting the CLI. /clear also calls this transitively. */
export function clearExpertsCache(): void {
	// lodash-es memoize exposes cache.clear()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cache = (readExpert as any).cache
	if (cache && typeof cache.clear === 'function') cache.clear()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const listCache = (listExperts as any).cache
	if (listCache && typeof listCache.clear === 'function') listCache.clear()
	clearProjectDirsCache()
	logForDebugging('Expert cache cleared; next listExperts() will re-scan the experts dir')
}
