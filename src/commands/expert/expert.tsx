/**
 * /expert command implementation.
 *
 *   - No args    → render a list of available experts (Box/Text) and close.
 *   - With args  → push a meta user message telling the model to invoke the
 *                  named expert via the ExpertManager tool, then close.
 *
 * The invocation pattern (inject a meta message + onDone(shouldQuery=true))
 * is the same one used by SkillTool — it keeps permission semantics,
 * progress rendering, and result display identical to a normal tool call.
 */
import * as React from 'react'
import {Box, Text} from '../../ink.js'
import type {
	LocalJSXCommandCall,
	LocalJSXCommandOnDone,
} from '../../types/command.js'
import {createUserMessage} from '../../utils/messages.js'
import {listExperts} from '../../tools/ExpertManagerTool/expertStorage.js'
import {EXPERT_MANAGER_TOOL_NAME} from '../../tools/ExpertManagerTool/constants.js'

function displayNameText(d: unknown): string {
	if (typeof d === 'string') return d
	if (d && typeof d === 'object') {
		const obj = d as {en?: string; zh?: string}
		return obj.en ?? obj.zh ?? '(unnamed)'
	}
	return '(unnamed)'
}

function truncate(s: string, n: number): string {
	if (s.length <= n) return s
	return s.slice(0, Math.max(0, n - 1)) + '…'
}

function ListView({onDone}: {onDone: LocalJSXCommandOnDone}) {
	const [experts, setExperts] = React.useState<
		Array<{
			name: string
			expertType: 'agent' | 'team'
			displayName: unknown
			description: string
			tags: string[]
			categoryId: string
			scope: 'managed' | 'user' | 'project'
			path: string
		}> | null
	>(null)
	const [error, setError] = React.useState<string | null>(null)

	React.useEffect(() => {
		;(async () => {
			try {
				const all = await listExperts('all', 'all')
				setExperts(
					all.map(e => ({
						name: e.name,
						expertType: e.expertType,
						displayName: e.displayName,
						description: e.description,
						tags: e.tags,
						categoryId: e.categoryId,
						scope: e.source,
						path: e.path,
					})),
				)
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e))
			}
		})()
	}, [])

	React.useEffect(() => {
		// Auto-close after a short pause so the user can read the list but
		// doesn't need to manually dismiss it.
		const t = setTimeout(() => onDone(undefined, {display: 'system'}), 60_000)
		return () => clearTimeout(t)
	}, [onDone])

	if (error) {
		return (
			<Box flexDirection="column">
				<Text color="red">Failed to list experts: {error}</Text>
			</Box>
		)
	}
	if (!experts) {
		return (
			<Box flexDirection="column">
				<Text dimColor>Loading experts…</Text>
			</Box>
		)
	}
	if (experts.length === 0) {
		return (
			<Box flexDirection="column">
				<Text bold>Experts</Text>
				<Text dimColor>
					{`No experts found in ~/.claude/experts/ or <cwd>/.claude/experts/.`}
				</Text>
				<Text dimColor>
					Use the {EXPERT_MANAGER_TOOL_NAME} tool with action=create to add one.
				</Text>
			</Box>
		)
	}
	return (
		<Box flexDirection="column">
			<Text bold>Experts ({experts.length})</Text>
			{experts.map(e => (
				<Box key={`${e.scope}:${e.name}`} flexDirection="column">
					<Text>
						<Text color={e.expertType === 'team' ? 'magenta' : 'green'}>
							{e.expertType === 'team' ? '[team]' : '[agent]'}
						</Text>{' '}
						<Text bold>/expert {e.name}</Text>{' '}
						<Text dimColor>{`(${e.scope})`}</Text>
					</Text>
					<Text>{`    ${displayNameText(e.displayName)}`}</Text>
					<Text dimColor>{`    ${truncate(e.description, 80)}`}</Text>
					<Text dimColor>{`    tags=[${e.tags.join(', ')}]  category=${e.categoryId}`}</Text>
				</Box>
			))}
		</Box>
	)
}

function InvokeView({
	name,
	onDone,
}: {
	name: string
	onDone: LocalJSXCommandOnDone
}) {
	// Inject a meta message asking the model to invoke the expert. Use the
	// standard meta-message path (createUserMessage + isMeta) so the
	// instruction is visible to the model but not displayed in the
	// transcript.
	const instruction = `Use the ${EXPERT_MANAGER_TOOL_NAME} tool with action="invoke", name="${name}" and a prompt that reflects what the user wants to do with this expert. If the user provided additional context after /expert ${name}, use that as the prompt.`
	const message = createUserMessage({content: instruction, isMeta: true})
	onDone(undefined, {display: 'system', shouldQuery: true, metaMessages: [instruction]})
	return (
		<Box flexDirection="column">
			<Text>
				<Text color="cyan">/expert</Text>{' '}
				<Text bold color="green">{name}</Text>
			</Text>
			<Text dimColor>Activating expert…</Text>
		</Box>
	)
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
	const trimmed = (args ?? '').trim()
	if (!trimmed) {
		return <ListView onDone={onDone} />
	}
	// Strip leading slashes if user typed `//expert` etc.
	const name = trimmed.replace(/^\/+/, '').trim()
	return <InvokeView name={name} onDone={onDone} />
}
