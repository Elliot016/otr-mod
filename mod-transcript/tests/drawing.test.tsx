import { expect, mock, test } from 'claude-code/testing'

import { THEME } from '../hooks/theme'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const row = (n: number, type: string, extra: object) => JSON.stringify({ type, uuid: ID(n), parentUuid: n > 1 ? ID(n - 1) : null, ...extra })
const said = (n: number, content: unknown[]) => row(n, 'assistant', { message: { role: 'assistant', content } })
const answered = (n: number, id: string, extra: object = {}) => row(n, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, ...extra })

// One finished turn that edits a file; its diff has an indented line.
const EDIT_TURN = [
  row(1, 'user', { message: { role: 'user', content: 'edit it' } }),
  said(2, [{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: { file_path: '/repo/a.ts' } }]),
  answered(3, 'toolu_e', { toolUseResult: { structuredPatch: [{ lines: [' keep', '+    indented()', '-old'] }] } }),
  said(4, [{ type: 'text', text: 'Done.' }]),
  row(5, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
  row(6, 'user', { message: { role: 'user', content: 'next' } }),
].join('\n') + '\n'

// Two finished turns that each edit a file, so each has its own head to open.
const TWO_TURNS = [
  row(1, 'user', { message: { role: 'user', content: 'first' } }),
  said(2, [{ type: 'tool_use', id: 'toolu_a', name: 'Edit', input: { file_path: '/repo/a.ts' } }]),
  answered(3, 'toolu_a', { toolUseResult: { structuredPatch: [] } }),
  said(4, [{ type: 'text', text: 'one' }]),
  row(5, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
  row(6, 'user', { message: { role: 'user', content: 'second' } }),
  said(7, [{ type: 'tool_use', id: 'toolu_b', name: 'Edit', input: { file_path: '/repo/b.ts' } }]),
  answered(8, 'toolu_b', { toolUseResult: { structuredPatch: [] } }),
  said(9, [{ type: 'text', text: 'two' }]),
  row(10, 'system', { subtype: 'turn_duration', durationMs: 1000 }),
  row(11, 'user', { message: { role: 'user', content: 'third' } }),
].join('\n') + '\n'

// Mounts rows the way the engine draws them, once the transcript `text` is read.
async function open($: any, on: any, text = '', reads: () => string = () => text) {
  on('classic.SessionStart', () => ({}))
  on('classic.PermissionDenied', () => ({}))
  on('classic.StopFailure', () => ({}))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: reads() }))
  mock.clock(on)
  mock.env(on, {})
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  await $.classic.SessionStart({ session_id: 's1', transcript_path: '/t/s1.jsonl', source: 'startup', hook_event_name: 'SessionStart', cwd: '/w' } as never)
  return (component: string, requestId: string, props: object, columns = 120) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns, rows: 40 }, props } as never)
}

const prompt = (text: string, isExpanded = false) => ({ text, origin: { kind: 'composer' }, isExpanded })

test('the normal view still folds the finished turn under its prompt', async ($, on) => {
  const mount = await open($, on, EDIT_TURN)
  const head = await mount('UserMessage', ID(1), prompt('edit it'))
  expect(await head.find({ type: 'Button', text: /^1 tool/ })).toBeDefined()
})

test('a call refused by a hook draws neutral with "declined", not in the failure color', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on)
  await $.classic.PermissionDenied({ tool_name: 'WebFetch', tool_input: {}, tool_use_id: 'toolu_web', reason: 'blocked' } as never)
  const tool = await mount('ToolUse', 'toolu_web', { tool_use_id: 'toolu_web', tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: false, isErrored: true, isInterrupted: false, output: 'blocked' })
  expect((await tool.find({ type: 'Client', key: 'toggle-tool-chip' }))?.props.props.color).toBe(THEME.border)
  expect(await tool.find({ type: 'Button', text: /declined/ })).toBeDefined()
})

test('a failed call that no hook refused stays in the failure color', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on)
  const tool = await mount('ToolUse', 'toolu_web', { tool_use_id: 'toolu_web', tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: false, isErrored: true, isInterrupted: false, output: 'boom' })
  expect((await tool.find({ type: 'Client', key: 'toggle-tool-chip' }))?.props.props.color).toBe(THEME.alert)
  expect(await tool.find({ type: 'Button', text: /declined/ })).toBeUndefined()
})

test('a timed-out call says so after its name, and its name is cut to leave the words room', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on)
  const tool = await mount('ToolUse', 'toolu_web', { tool_use_id: 'toolu_web', tool: 'WebFetch', input: { url: 'https://example.com/a/very/long/path/that/goes/on/and/on/and/on' }, isRunning: false, isErrored: false, isInterrupted: false, output: { timedOutAfterMs: 120000 } }, 60)
  expect(await tool.find({ type: 'Button', text: /^WebFetch\(https.*… · timed out$/ })).toBeDefined()
})

test('a call that ran in the background says so, and an interrupted one says interrupted', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on)
  const background = await mount('ToolUse', 'toolu_bg', { tool_use_id: 'toolu_bg', tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: false, isErrored: false, isInterrupted: false, output: { backgroundTaskId: 'b1' } })
  expect(await background.find({ type: 'Button', text: /· background/ })).toBeDefined()
  const cut = await mount('ToolUse', 'toolu_cut', { tool_use_id: 'toolu_cut', tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: false, isErrored: true, isInterrupted: true, output: 'cut' })
  expect(await cut.find({ type: 'Button', text: /· interrupted/ })).toBeDefined()
})

test('AskUserQuestion folds to one line per question: its answer, or that it asked', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on)
  const ask = await mount('ToolUse', 'toolu_ask', {
    tool_use_id: 'toolu_ask',
    tool: 'AskUserQuestion',
    input: { questions: [{ question: 'Which db?' }, { question: 'Ship now?' }] },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    output: { questions: [], answers: { 'Which db?': 'Postgres' } },
  })
  expect(await ask.find({ type: 'Text', text: /Which db\? .* Postgres/ })).toBeDefined()
  expect(await ask.find({ type: 'Text', text: /Asked you: Ship now\?/ })).toBeDefined()
})

test('AskUserQuestion draws its question lines with the safe mark in safe mode', { options: { expand_live: false, icons: 'safe' } }, async ($, on) => {
  const mount = await open($, on)
  const ask = await mount('ToolUse', 'toolu_ask', { tool_use_id: 'toolu_ask', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which db?' }] }, isRunning: false, isErrored: false, isInterrupted: false, output: { answers: { 'Which db?': 'Postgres' } } })
  expect(await ask.find({ type: 'Text', text: '? Which db? ▸ Postgres' })).toBeDefined()
})

test('AskUserQuestion draws its question lines with the Nerd search glyph in Nerd mode', { options: { expand_live: false, icons: 'nerd' } }, async ($, on) => {
  const mount = await open($, on)
  const ask = await mount('ToolUse', 'toolu_ask', { tool_use_id: 'toolu_ask', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which db?' }] }, isRunning: false, isErrored: false, isInterrupted: false, output: { answers: { 'Which db?': 'Postgres' } } })
  expect(JSON.stringify(await ask.drawn())).toContain(String.fromCodePoint(0xf002))
})

test('an API error the engine retries ends the reply as one warning line', async ($, on) => {
  const mount = await open($, on)
  await $.classic.StopFailure({ error: 'rate_limit', error_details: 'retry in 20s', last_assistant_message: 'API Error: Rate limit reached' } as never)
  const reply = await mount('AssistantMessage', ID(7), { text: 'API Error: Rate limit reached', isFirstOfReply: true })
  expect(await reply.find({ type: 'Text', text: /rate limit reached · Claude Code retries · retry in 20s/ })).toBeDefined()
  expect((await reply.find({ type: 'Text', text: /rate limit reached/ }))?.props.color).toBe(THEME.warn)
})

test('an API error that needs the person is one red line that says so', async ($, on) => {
  const mount = await open($, on)
  await $.classic.StopFailure({ error: 'billing_error', last_assistant_message: 'API Error: Billing' } as never)
  const reply = await mount('AssistantMessage', ID(7), { text: 'API Error: Billing', isFirstOfReply: true })
  expect(await reply.find({ type: 'Text', text: /billing problem · you must act/ })).toBeDefined()
  expect((await reply.find({ type: 'Text', text: /billing problem/ }))?.props.color).toBe(THEME.alert)
})

test('a subagent report draws a head line with its fields, and a card whose body stops at six lines', async ($, on) => {
  const mount = await open($, on)
  const report = await mount('UserMessage', ID(20), {
    text: 'Found it\nl2\nl3\nl4\nl5\nl6\nl7\nl8',
    origin: { kind: 'task-notification' },
    isExpanded: false,
    task: { id: 'a1', status: 'completed', type: 'local_agent', durationMs: 122000, toolUseId: 'toolu_agent' },
    from: { name: 'researcher' },
  })
  expect(await report.find({ type: 'Text', text: /researcher · completed · 2m 2s · Found it/ })).toBeDefined()
  expect(await report.find({ type: 'Text', text: 'task a1' })).toBeDefined()
  expect(await report.find({ type: 'Text', text: 'l6' })).toBeDefined()
  expect(await report.find({ type: 'Text', text: 'l7' })).toBeUndefined()
  expect(await report.find({ type: 'Text', text: '+ 2 more lines' })).toBeDefined()
})

test('a diff preview keeps the indentation of its lines', async ($, on) => {
  const mount = await open($, on, EDIT_TURN)
  const head = await mount('UserMessage', ID(1), prompt('edit it'))
  await head.press({ key: 'toggle-turn-button' })
  await head.pointer({ in: 'toggle-chips-line', type: 'down', button: 'left', x: 1, y: 0 })
  await head.press({ key: 'toggle-call-0-button' })
  expect(await head.find({ type: 'Text', text: /\+ {5}indented\(\)/ })).toBeDefined()
})

test('turn.complete hands the turn on before it reads the session messages', async ($, on) => {
  const order: string[] = []
  on('session.messages', () => {
    order.push('messages')
    return { value: [] }
  })
  on('turn.complete', () => {
    order.push('next')
    return { text: '' }
  })
  await open($, on, EDIT_TURN)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false } as never)
  expect(order).toEqual(['next', 'messages'])
})

test('a transcript read that failed is read again on the next turn', async ($, on) => {
  let reads = 0
  on('turn.complete', () => ({ text: '' }))
  on('process.spawn', async function* () {
    throw new Error('cat failed')
  })
  await open($, on, EDIT_TURN, () => {
    reads += 1
    return reads === 1 ? '' : EDIT_TURN
  })
  expect(reads).toBe(1)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false } as never)
  expect(reads).toBe(2)
})

test('two turns opened at once both stay open', async ($, on) => {
  const mount = await open($, on, TWO_TURNS)
  const first = await mount('UserMessage', ID(1), prompt('first'))
  const second = await mount('UserMessage', ID(6), prompt('second'))
  await Promise.all([first.press({ key: 'toggle-turn-button' }), second.press({ key: 'toggle-turn-button' })])
  expect((await first.find({ type: 'Client', key: 'toggle-turn-chip' }))?.props.props.isOpen).toBe(true)
  expect((await second.find({ type: 'Client', key: 'toggle-turn-chip' }))?.props.props.isOpen).toBe(true)
})
