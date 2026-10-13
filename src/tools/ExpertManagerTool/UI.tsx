/**
 * React/Ink renderers for the ExpertManager tool.
 *
 * Two renderers matter:
 *   - renderToolUseMessage — a one-line label of what action was taken.
 *   - renderToolResultMessage — a Box/Text rendering of the outcome.
 *
 * For list / view we render a small summary; for create / edit / delete we
 * confirm the path; for validate we surface structured errors; for invoke
 * we show the assistant's final response.
 */
import {Box, Text} from '../../ink.js'
import type {
	ExpertManagerInput,
	ExpertManagerOutput,
} from './types.js'
import type {ThemeName} from '../../utils/theme.js'

const SCOPE_LABEL: Record<'managed' | 'user' | 'project', string> = {
	managed: 'managed',
	user: 'user',
	project: 'project',
}

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

export function renderToolUseMessage(
	input: Partial<ExpertManagerInput>,
	_options: {theme?: ThemeName; verbose?: boolean} = {},
) {
	const action = (input as {action?: string}).action ?? '?'
	const name = (input as {name?: string}).name
	const tag = (input as {tags?: string[]}).tags
	const prompt = (input as {prompt?: string}).prompt

	switch (action) {
		case 'list':
			return (
				<Text>
					<Text color="cyan">ExpertManager</Text> list
				</Text>
			)
		case 'view':
			return (
				<Text>
					<Text color="cyan">ExpertManager</Text> view{' '}
					<Text color="green">{name ?? '(unnamed)'}</Text>
				</Text>
			)
		case 'create':
			return (
				<Text>
					<Text color="cyan">ExpertManager</Text> create{' '}
					<Text color="green">{name ?? '(unnamed)'}</Text>
					{tag?.length ? (
						<Text dimColor>{`  tags=[${tag.join(', ')}]`}</Text>
					) : null}
				</Text>
			)
		case 'create_team':
			return (
				<Text>
					<Text color="cyan">ExpertManager</Text> create_team{' '}
					<Text color="green">{name ?? '(unnamed)'}</Text>
				</Text>
			)
		case 'edit':
			return (
				<Text>
					<Text color="cyan">ExpertManager</Text> edit{' '}
					<Text color="green">{name ?? '(unnamed)'}</Text>
				</Text>
			)
		case 'delete':
			return (
				<Text>
					<Text color="cyan">ExpertManager</Text> delete{' '}
					<Text color="red">{name ?? '(unnamed)'}</Text>
				</Text>
			)
		case 'validate':
			return (
				<Text>
					<Text color="cyan">ExpertManager</Text> validate{' '}
					<Text color="yellow">{name ?? '(unnamed)'}</Text>
				</Text>
			)
		case 'invoke':
			return (
				<Text>
					<Text color="cyan">ExpertManager</Text> invoke{' '}
					<Text color="magenta">{name ?? '(unnamed)'}</Text>
					{prompt ? (
						<Text dimColor>{`  "${truncate(prompt, 60)}"`}</Text>
					) : null}
				</Text>
			)
		default:
			return (
				<Text>
					<Text color="cyan">ExpertManager</Text> {action}
				</Text>
			)
	}
}

export function renderToolUseErrorMessage(
	result: {message?: string} | string | unknown,
	_options: {theme?: ThemeName; verbose?: boolean} = {},
) {
	const text =
		typeof result === 'string'
			? result
			: result && typeof result === 'object' && 'message' in result
				? String((result as {message?: string}).message ?? 'Error')
				: 'Error'
	return (
		<Box flexDirection="column">
			<Text color="red">✗ ExpertManager failed</Text>
			<Text>{text}</Text>
		</Box>
	)
}

function ListResult({out}: {out: Extract<ExpertManagerOutput, {action: 'list'}>}) {
	if (out.experts.length === 0) {
		return (
			<Box flexDirection="column">
				<Text dimColor>No experts found.</Text>
				<Text dimColor>
					Use action=create to add your first expert, or specify a different
					scope.
				</Text>
			</Box>
		)
	}
	return (
		<Box flexDirection="column">
			{out.experts.map(e => (
				<Box key={e.name} flexDirection="column">
					<Text>
						<Text color={e.expertType === 'team' ? 'magenta' : 'green'}>
							{e.expertType === 'team' ? '[team]' : '[agent]'}
						</Text>{' '}
						<Text bold>{e.name}</Text>{' '}
						<Text dimColor>{`(${SCOPE_LABEL[e.scope]})`}</Text>{' '}
						<Text>{displayNameText(e.displayName)}</Text>
					</Text>
					<Text dimColor>{`    ${truncate(e.description, 80)}`}</Text>
					<Text dimColor>{`    tags=[${e.tags.join(', ')}]  category=${e.categoryId}`}</Text>
				</Box>
			))}
			<Text>{`${out.experts.length} expert(s) found.`}</Text>
		</Box>
	)
}

function ViewResult({out}: {out: Extract<ExpertManagerOutput, {action: 'view'}>}) {
	const e = out.expert
	return (
		<Box flexDirection="column">
			<Text>
				<Text bold>{e.meta.name}</Text>{' '}
				<Text dimColor>{`(${SCOPE_LABEL[e.scope]})`}</Text>{' '}
				<Text>{e.meta.expertType === 'team' ? '[team]' : '[agent]'}</Text>
			</Text>
			<Text>{`displayName: ${displayNameText(e.meta.displayName)}`}</Text>
			<Text>{`profession: ${displayNameText(e.meta.profession)}`}</Text>
			<Text>{`description: ${e.meta.description}`}</Text>
			<Text>{`categoryId: ${e.meta.categoryId}`}</Text>
			<Text>{`tags: [${e.meta.tags.join(', ')}]`}</Text>
			<Text>{`quickPrompts:`}</Text>
			{e.meta.quickPrompts.map((q, i) => (
				<Text key={i}>{`  ${i + 1}. ${q}`}</Text>
			))}
			{e.meta.expertType === 'team' && e.meta.members ? (
				<>
					<Text>{`members:`}</Text>
					{e.meta.members.map((m, i) => (
						<Text key={i}>{`  - ${m.agentName}${m.role ? ` (${m.role})` : ''}`}</Text>
					))}
				</>
			) : null}
			{e.model ? <Text>{`model: ${e.model}`}</Text> : null}
			<Text>{`path: ${e.path}`}</Text>
			<Text>{`--- prompt ---`}</Text>
			<Text>{e.prompt || '(empty)'}</Text>
		</Box>
	)
}

function CreateResult({out}: {out: Extract<ExpertManagerOutput, {action: 'create' | 'create_team'}>}) {
	const created = out.created
	return (
		<Box flexDirection="column">
			<Text>
				<Text color="green">✓</Text> Created {created.expertType}{' '}
				<Text bold>{created.name}</Text>{' '}
				<Text dimColor>{`(${SCOPE_LABEL[created.scope]})`}</Text>
			</Text>
			<Text>{`path: ${created.path}`}</Text>
			{out.action === 'create_team' && 'members' in created ? (
				<Text>{`members: ${created.members.map(m => m.agentName).join(', ')}`}</Text>
			) : null}
		</Box>
	)
}

function EditResult({out}: {out: Extract<ExpertManagerOutput, {action: 'edit'}>}) {
	const u = out.updated
	return (
		<Box flexDirection="column">
			<Text>
				<Text color="green">✓</Text> Updated{' '}
				<Text bold>{u.name}</Text>{' '}
				<Text dimColor>{`(${SCOPE_LABEL[u.scope]})`}</Text>
			</Text>
			{u.changedFields.length > 0 ? (
				<Text>{`changed: ${u.changedFields.join(', ')}`}</Text>
			) : (
				<Text dimColor>(no fields changed)</Text>
			)}
			<Text>{`path: ${u.path}`}</Text>
		</Box>
	)
}

function DeleteResult({out}: {out: Extract<ExpertManagerOutput, {action: 'delete'}>}) {
	return (
		<Box flexDirection="column">
			<Text>
				<Text color="red">✗ deleted</Text> <Text bold>{out.deleted_name}</Text>{' '}
				<Text dimColor>{`(${SCOPE_LABEL[out.scope]})`}</Text>
			</Text>
			<Text>{`path: ${out.path}`}</Text>
		</Box>
	)
}

function ValidateResult({out}: {out: Extract<ExpertManagerOutput, {action: 'validate'}>}) {
	return (
		<Box flexDirection="column">
			<Text>
				{out.valid ? (
					<Text color="green">✓ valid</Text>
				) : (
					<Text color="red">✗ invalid</Text>
				)}{' '}
				<Text bold>{out.name}</Text>{' '}
				<Text dimColor>{`(${SCOPE_LABEL[out.scope]})`}</Text>
			</Text>
			{out.errors.length > 0 ? (
				<>
					<Text>{`${out.errors.length} error(s):`}</Text>
					{out.errors.map((e, i) => (
						<Text key={i}>{`  - ${e.field}: ${e.message}`}</Text>
					))}
				</>
			) : null}
		</Box>
	)
}

function InvokeResult({out}: {out: Extract<ExpertManagerOutput, {action: 'invoke'}>}) {
	return (
		<Box flexDirection="column">
			<Text>
				<Text color="green">✓</Text> Invoked{' '}
				<Text bold>{out.expertName}</Text>{' '}
				<Text dimColor>{`(${out.expertType})`}</Text>{' '}
				<Text>{`(${out.durationMs}ms, agentId=${out.agentId})`}</Text>
			</Text>
			<Text>{out.content || '(no output)'}</Text>
		</Box>
	)
}

export function renderToolResultMessage(
	out: ExpertManagerOutput,
	_options: {
		theme?: ThemeName
		verbose?: boolean
		isTranscriptMode?: boolean
		input?: unknown
	} = {},
) {
	switch (out.action) {
		case 'list':
			return <ListResult out={out} />
		case 'view':
			return <ViewResult out={out} />
		case 'create':
			return <CreateResult out={out} />
		case 'create_team':
			return <CreateResult out={out} />
		case 'edit':
			return <EditResult out={out} />
		case 'delete':
			return <DeleteResult out={out} />
		case 'validate':
			return <ValidateResult out={out} />
		case 'invoke':
			return <InvokeResult out={out} />
	}
}
