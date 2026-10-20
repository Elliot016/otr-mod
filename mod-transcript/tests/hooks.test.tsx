// mod-transcript / tests/hooks.test.tsx, by v-amorim: what SessionStart, PermissionDenied and StopFailure do, and the fallback when SessionStart never arrives.
import { expect, mock, test } from 'claude-code/testing'

import { THEME } from '../hooks/theme'
import { append, feed, reading, sessionStarted } from './bridge-feed'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const row = (n: number, type: string, extra: object) => JSON.stringify({ type, uuid: ID(n), parentUuid: n > 1 ? ID(n - 1) : null, ...extra })
const said = (n: number, content: unknown[]) => row(n, 'assistant', { message: { role: 'assistant', content } })
const answered = (n: number, id: string) => row(n, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })

// One prompt with one edit, and no duration row: the transcript alone cannot say the turn ended.
const OPEN_TURN = [
  row(1, 'user', { message: { role: 'user', content: 'edit it' } }),
  said(2, [{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: { file_path: '/repo/a.ts' } }]),
  answered(3, 'toolu_e'),
  said(4, [{ type: 'text', text: 'Done.' }]),
].join('\n') + '\n'

const NAMED = '/t/s1.jsonl'
const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

// Only NAMED holds the transcript; any other path reads as missing, so a log that fills proves the path was named.
function host($: any, on: any, files: Record<string, string> = { [NAMED]: OPEN_TURN }) {
  const w = { reads: [] as string[], store: new Map<string, unknown>() }
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    const text = files[plain(e.path)]
    if (text === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', reading((_$: unknown, e: { path: string }) => {
    const path = plain(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    w.reads.push(path)
    return { value: files[path] }
  }))
  mock.env(on, { USERPROFILE: '/home' })
  on('fs.list', () => ({ value: [{ name: 'proj', kind: 'dir' }] }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: plain(e.path) in files }))
  on('session.start', () => ({ cwd: '/w' }))
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('command.register', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  const clock = mock.clock(on)
  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  return { w, clock, mount, ...events($, clock) }
}

// The three events as the command hooks write them into the session's bridge file.
function events($: any, clock: any) {
  return {
    sessionStart: (path: string, source = 'startup') => sessionStarted($, clock, 's1', path, source),
    permissionDenied: (id: string) => feed($, clock, { session_id: 's1', hook_event_name: 'PermissionDenied', tool_name: 'WebFetch', tool_input: {}, tool_use_id: id, reason: 'blocked' }),
    stopFailure: (fields: { error: string; error_details?: string; last_assistant_message?: string }) => feed($, clock, { session_id: 's1', hook_event_name: 'StopFailure', ...fields }),
  }
}

const promptProps = { text: 'edit it', origin: { kind: 'composer' }, isExpanded: false }
const textOf = (node: any): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node ? textOf(node.children) : '')
const labelOf = async (ui: any) => textOf(await ui.drawn({ in: 'toggle-turn-colored' }))

test('SessionStart names the transcript: it is stored under the session id and the log is loaded before the hook returns', { options: { expand_live: false } }, async ($, on) => {
  const { w, mount, sessionStart, clock } = host($, on)
  await sessionStart(NAMED)
  await clock.advance(250)
  expect(w.store.get('transcript:s1')).toMatchObject({ path: NAMED, at: expect.any(Number) })
  expect(w.reads).toEqual([NAMED])
  // The log holds the prompt already, so its head folds the turn's one edit.
  expect(await labelOf(await mount('UserMessage', ID(1), promptProps))).toMatch(/^1 tool/)
})

test('a compact keeps the same session and file, so SessionStart reads nothing again', async ($, on) => {
  const { w, sessionStart, clock } = host($, on)
  await sessionStart(NAMED)
  await clock.advance(250)
  await sessionStart(NAMED, 'compact')
  await clock.advance(250)
  expect(w.reads).toEqual([NAMED])
})

test('a SessionStart for another file starts a new log and reads that file', { options: { expand_live: false } }, async ($, on) => {
  const { w, mount, sessionStart, clock } = host($, on, { [NAMED]: OPEN_TURN, '/t/other.jsonl': OPEN_TURN.replace('edit it', 'other prompt') })
  await sessionStart(NAMED)
  await clock.advance(250)
  await sessionStart('/t/other.jsonl', 'clear')
  await clock.advance(250)
  expect(w.reads).toEqual([NAMED, '/t/other.jsonl'])
  expect(w.store.get('transcript:s1')).toMatchObject({ path: '/t/other.jsonl' })
  expect(await labelOf(await mount('UserMessage', ID(1), { ...promptProps, text: 'other prompt' }))).toMatch(/^1 tool/)
})

test('SessionStart ends the turn the transcript still holds: with expand_live off it folds at once, with it on it stays live', { options: { expand_live: false } }, async ($, on) => {
  const { mount, sessionStart, clock } = host($, on)
  await sessionStart(NAMED)
  await clock.advance(250)
  const head = await mount('UserMessage', ID(1), promptProps)
  const tool = await mount('ToolUse', 'toolu_e', { tool_use_id: 'toolu_e', tool: 'Edit', input: { file_path: '/repo/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} })
  expect(await labelOf(head)).toMatch(/^1 tool/)
  // Folded, the call's own row draws nothing.
  expect(await tool.find({ key: 'toggle-tool-colored' })).toBeUndefined()
})

test('with expand_live on, the same transcript keeps its last turn open after SessionStart', async ($, on) => {
  const { mount, sessionStart, clock } = host($, on)
  await sessionStart(NAMED)
  await clock.advance(250)
  // The turn is the latest and nothing ended it, so it draws open under its prompt, with no fold line.
  expect(await (await mount('UserMessage', ID(1), promptProps)).find({ key: 'toggle-turn-colored' })).toBeUndefined()
})

const webFetch = (output: string) => ({ tool_use_id: 'toolu_web', tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: false, isErrored: true, isInterrupted: false, output })

test('PermissionDenied adds the call\'s id to the declined ones: the failed call draws neutral with "declined"', { options: { expand_live: false } }, async ($, on) => {
  const { mount, permissionDenied, clock } = host($, on)
  await permissionDenied('toolu_web')
  await clock.advance(250)
  const tool = await mount('ToolUse', 'toolu_web', webFetch('blocked'))
  expect((await tool.find({ type: 'Client', key: 'toggle-tool-chip' }))?.props.props.color).toBe(THEME.muted)
  expect(textOf(await tool.drawn({ in: 'toggle-tool-colored' }))).toMatch(/declined/)
  // Another failed call stays a failure.
  const other = await mount('ToolUse', 'toolu_other', { ...webFetch('boom'), tool_use_id: 'toolu_other' })
  expect((await other.find({ type: 'Client', key: 'toggle-tool-chip' }))?.props.props.color).toBe(THEME.alert)
})

test('the same PermissionDenied twice, as a replay after a reload delivers it, still draws one "declined"', { options: { expand_live: false } }, async ($, on) => {
  const { mount, permissionDenied, clock } = host($, on)
  await permissionDenied('toolu_web')
  await permissionDenied('toolu_web')
  await clock.advance(250)
  const tool = await mount('ToolUse', 'toolu_web', webFetch('blocked'))
  expect(textOf(await tool.drawn({ in: 'toggle-tool-colored' })).match(/declined/g)).toHaveLength(1)
})

const reply = (text: string) => ({ text, isFirstOfReply: true })

test('StopFailure with a retried error ends the reply as one muted line built from error, error_details and the last message', async ($, on) => {
  const { mount, sessionStart, stopFailure, clock } = host($, on)
  await sessionStart(NAMED)
  await stopFailure({ error: 'rate_limit', error_details: 'retry in 20s', last_assistant_message: '  API Error: Rate limit reached  ' })
  await clock.advance(250)
  const ui = await mount('AssistantMessage', ID(7), reply('API Error: Rate limit reached'))
  expect(await ui.find({ type: 'Text', text: /rate limit reached · Claude Code retries · retry in 20s/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /rate limit reached/ }))?.props.color).toBe(THEME.muted)
})

test('StopFailure without details or a matching reply: an error needing the person is one red line, another reply is left as drawn', async ($, on) => {
  const { mount, sessionStart, stopFailure, clock } = host($, on)
  await sessionStart(NAMED)
  await stopFailure({ error: 'billing_error', last_assistant_message: 'API Error: Billing' })
  await clock.advance(250)
  const ui = await mount('AssistantMessage', ID(7), reply('API Error: Billing'))
  expect(await ui.find({ type: 'Text', text: /billing problem · you must act/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /billing problem/ }))?.props.color).toBe(THEME.alert)
  const other = await mount('AssistantMessage', ID(8), reply('A normal reply.'))
  expect(await other.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
})

test('the same StopFailure twice, as a replay delivers it, draws one failure line', async ($, on) => {
  const { mount, sessionStart, stopFailure, clock } = host($, on)
  const failure = { error: 'rate_limit', error_details: 'retry in 20s', last_assistant_message: 'API Error: Rate limit reached' }
  await sessionStart(NAMED)
  await stopFailure(failure)
  await sessionStart(NAMED)
  await stopFailure(failure)
  await clock.advance(250)
  const ui = await mount('AssistantMessage', ID(7), reply('API Error: Rate limit reached'))
  expect(await ui.findAll({ type: 'Text', text: /rate limit reached/ })).toHaveLength(1)
})

test('the fallback that runs today: with no SessionStart at all, the transcript is found by session id and its prompt is numbered from it', async ($, on) => {
  const { w, mount, clock } = host($, on, { '/home/.claude/projects/proj/s1.jsonl': OPEN_TURN })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(250)
  expect(w.reads).toEqual(['/home/.claude/projects/proj/s1.jsonl'])
  expect(JSON.stringify(await (await mount('UserMessage', ID(1), promptProps)).drawn({ in: 'toggle-prompt-number' }))).toMatch(/" ?#1 ?"/)
})

test('a reload finds the file with its history: each event replays once, its last record, and a replayed failure draws one line', { options: { expand_live: false } }, async ($, on) => {
  const { w, mount, clock } = host($, on)
  const at = (event: string, fields: object) => append('s1', { session_id: 's1', hook_event_name: event, ...fields })
  // The file is not written yet, so the log stays empty and the tool row below draws on its own.
  at('SessionStart', { transcript_path: '/t/new.jsonl', source: 'startup' })
  at('PermissionDenied', { tool_use_id: 'toolu_old', reason: 'blocked' })
  at('PermissionDenied', { tool_use_id: 'toolu_web', reason: 'blocked' })
  at('StopFailure', { error: 'rate_limit', last_assistant_message: 'API Error: Older' })
  at('StopFailure', { error: 'rate_limit', error_details: 'retry in 20s', last_assistant_message: 'API Error: Rate limit reached' })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(250)
  expect(w.store.get('transcript:s1')).toMatchObject({ path: '/t/new.jsonl' })
  const ui = await mount('AssistantMessage', ID(7), reply('API Error: Rate limit reached'))
  expect(await ui.findAll({ type: 'Text', text: /rate limit reached/ })).toHaveLength(1)
  expect(await (await mount('AssistantMessage', ID(8), reply('API Error: Older'))).find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
  const tool = await mount('ToolUse', 'toolu_web', webFetch('blocked'))
  expect(textOf(await tool.drawn({ in: 'toggle-tool-colored' }))).toMatch(/declined/)
})

test('a SessionStart naming the file a read already found by id, in other slashes, does not read it again', async ($, on) => {
  const { w, sessionStart, clock } = host($, on, { '/home/.claude/projects/proj/s1.jsonl': OPEN_TURN })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(250)
  await sessionStart('\\home\\.claude\\projects\\proj\\s1.jsonl')
  expect(w.reads).toEqual(['/home/.claude/projects/proj/s1.jsonl'])
  expect(w.store.get('transcript:s1')).toMatchObject({ path: '\\home\\.claude\\projects\\proj\\s1.jsonl' })
})
