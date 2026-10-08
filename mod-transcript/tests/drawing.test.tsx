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

test('the ctrl+o view draws every row as the engine does, so the mod steps aside', { options: { expand_live: false } }, async ($, on) => {
  const mount = await open($, on, EDIT_TURN)
  const head = await mount('UserMessage', ID(1), prompt('edit it', true))
  expect(await head.find({ type: 'Text', text: 'base UserMessage' })).toBeDefined()
  expect(await head.find({ type: 'Button', text: /tool/ })).toBeUndefined()
})

test('while a subagent transcript is on screen its rows draw as the engine draws them and join no main turn', async ($, on) => {
  const mount = await open($, on, EDIT_TURN)
  const band = (agentId?: string) => mount('AbovePrompt', 'band', { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: agentId ? { agentId } : {} })
  await (await band('a1')).unmount()
  const subPrompt = await mount('UserMessage', ID(50), prompt('the brief'))
  expect(await subPrompt.find({ type: 'Text', text: 'base UserMessage' })).toBeDefined()
  const subCall = await mount('ToolUse', 'toolu_sub', { tool_use_id: 'toolu_sub', tool: 'Read', input: { file_path: '/repo/x.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} })
  expect(await subCall.find({ type: 'Text', text: 'base ToolUse' })).toBeDefined()
  await (await band()).unmount()
  const head = await mount('UserMessage', ID(1), prompt('edit it'))
  expect(await head.find({ type: 'Button', text: /^1 tool/ })).toBeDefined()
})

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

test('a reply naming hex colors gets a strip of colored squares under it, and one naming none stays as drawn', async ($, on) => {
  const mount = await open($, on)
  const reply = await mount('AssistantMessage', ID(7), { text: 'Low is `#ACB9E6` and max is #FF6F7A.', isFirstOfReply: true })
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
  const squares = await reply.findAll({ type: 'Text', text: '■' })
  expect(squares.map((square: any) => square.props.color).filter(Boolean)).toEqual(['#ACB9E6', '#FF6F7A'])
  expect(await reply.find({ type: 'Text', text: ' #FF6F7A' })).toBeDefined()
  const plain = await mount('AssistantMessage', ID(8), { text: 'See prompt #229.', isFirstOfReply: true })
  expect(await plain.find({ type: 'Text', text: '■' })).toBeUndefined()
})

test('an API error that needs the person is one red line that says so', async ($, on) => {
  const mount = await open($, on)
  await $.classic.StopFailure({ error: 'billing_error', last_assistant_message: 'API Error: Billing' } as never)
  const reply = await mount('AssistantMessage', ID(7), { text: 'API Error: Billing', isFirstOfReply: true })
  expect(await reply.find({ type: 'Text', text: /billing problem · you must act/ })).toBeDefined()
  expect((await reply.find({ type: 'Text', text: /billing problem/ }))?.props.color).toBe(THEME.alert)
})

test('a subagent report draws a head line with its fields, and a card whose body stops at six lines after the head\'s summary', async ($, on) => {
  const mount = await open($, on)
  const report = await mount('UserMessage', ID(20), {
    text: 'Found it\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9',
    origin: { kind: 'task-notification' },
    isExpanded: false,
    task: { id: 'a1', status: 'completed', type: 'local_agent', durationMs: 122000, toolUseId: 'toolu_agent' },
    from: { name: 'researcher' },
  })
  expect(await report.find({ type: 'Text', text: /researcher · completed · 2m 2s · Found it/ })).toBeDefined()
  expect(await report.find({ type: 'Text', text: 'task a1' })).toBeDefined()
  expect(await report.find({ type: 'Text', text: /^Found it$/ })).toBeUndefined()
  expect(await report.find({ type: 'Text', text: 'l7' })).toBeDefined()
  expect(await report.find({ type: 'Text', text: 'l8' })).toBeUndefined()
  expect(await report.find({ type: 'Text', text: '+ 2 more lines' })).toBeDefined()
})

test('a notice its head line shows whole draws no card, so its task and tool ids alone never repeat it', async ($, on) => {
  const mount = await open($, on)
  const notice = await mount('UserMessage', ID(22), { text: 'Background command "Render the reel" completed (exit code 0)', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'b5', status: 'completed', toolUseId: 'toolu_render' } })
  expect(await notice.find({ type: 'Text', text: /b5 · completed · Background command "Render the reel"/ })).toBeDefined()
  expect(await notice.find({ type: 'Text', text: 'task b5' })).toBeUndefined()
  expect(await notice.find({ type: 'Text', text: /toolu_render/ })).toBeUndefined()
})

test('a summary too long for the head stays in the card', async ($, on) => {
  const mount = await open($, on)
  const long = `Background shell command ${'x'.repeat(200)}`
  const report = await mount('UserMessage', ID(21), { text: long, origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'b1', status: 'stopped' } })
  expect(await report.find({ type: 'Text', text: /^Background shell command x/ })).toBeDefined()
  expect(await report.find({ type: 'Text', text: /stopped · Background shell command/ })).toBeDefined()
})

// A subagent's hand-back, sent from task a2, and the notice that task a2 finished in 15m 52s.
const HANDBACK = { text: 'Spike and checks: ctrl+o works\nl2', origin: { kind: 'peer', senderTaskId: 'a2' }, from: { name: 'general-purpose' }, isExpanded: false }
const NOTICE = { text: 'Agent "Live checks" finished', origin: { kind: 'task-notification' }, task: { id: 'a2', status: 'completed', durationMs: 952121 }, isExpanded: false }

const REPORT_TURN = [
  row(1, 'user', { message: { role: 'user', content: 'first' } }),
  row(2, 'user', { isMeta: true, origin: { kind: 'peer' }, message: { role: 'user', content: 'Another Claude session sent a message: report' } }),
  said(3, [{ type: 'text', text: 'Noted.' }]),
]
const LATEST_REPORT = REPORT_TURN.join('\n') + '\n'
const OLD_REPORT = [...REPORT_TURN, row(4, 'user', { message: { role: 'user', content: 'second' } })].join('\n') + '\n'

test('a report drawn before its notice takes the notice status and time, and the notice then draws nothing', async ($, on) => {
  const mount = await open($, on)
  const report = await mount('UserMessage', ID(20), HANDBACK)
  expect(await report.find({ type: 'Text', text: /general-purpose · Spike and checks/ })).toBeDefined()
  const notice = await mount('UserMessage', ID(21), NOTICE)
  expect(await notice.find({ type: 'Text', text: /Agent "Live checks" finished/ })).toBeUndefined()
  expect(await report.find({ type: 'Text', text: /general-purpose · completed · 15m 52s · Spike and checks: ctrl\+o works$/ })).toBeDefined()
})

test('a notice drawn before its report draws nothing once the report comes, and the report takes its status and time', async ($, on) => {
  const mount = await open($, on)
  const notice = await mount('UserMessage', ID(21), NOTICE)
  expect(await notice.find({ type: 'Text', text: /Agent "Live checks" finished/ })).toBeDefined()
  const report = await mount('UserMessage', ID(20), HANDBACK)
  expect(await report.find({ type: 'Text', text: /general-purpose · completed · 15m 52s · Spike and checks/ })).toBeDefined()
  expect(await notice.find({ type: 'Text', text: /Agent "Live checks" finished/ })).toBeUndefined()
})

test('a notice with no report keeps its line', async ($, on) => {
  const mount = await open($, on)
  const notice = await mount('UserMessage', ID(21), NOTICE)
  expect(await notice.find({ type: 'Text', text: /a2 · completed · 15m 52s · Agent "Live checks" finished/ })).toBeDefined()
})

test('an old report draws only its head line', async ($, on) => {
  const mount = await open($, on, OLD_REPORT)
  const report = await mount('UserMessage', ID(2), HANDBACK)
  expect(await report.find({ type: 'Button', text: /general-purpose · Spike and checks/ })).toBeDefined()
  expect(await report.find({ type: 'Text', text: /l2/ })).toBeUndefined()
})

test('a click on an old report head opens its body, and a second click folds it again', async ($, on) => {
  const mount = await open($, on, OLD_REPORT)
  const report = await mount('UserMessage', ID(2), HANDBACK)
  await report.press({ key: 'toggle-report-fold-button' })
  expect(await report.find({ type: 'Text', text: /l2/ })).toBeDefined()
  await report.press({ key: 'toggle-report-fold-button' })
  expect(await report.find({ type: 'Text', text: /l2/ })).toBeUndefined()
})

test('the latest report stays open until the next prompt', async ($, on) => {
  const mount = await open($, on, LATEST_REPORT)
  const report = await mount('UserMessage', ID(2), HANDBACK)
  expect(await report.find({ type: 'Text', text: /l2/ })).toBeDefined()
})

test('with fold_turns off, an old report stays open', { options: { fold_turns: false } }, async ($, on) => {
  const mount = await open($, on, OLD_REPORT)
  const report = await mount('UserMessage', ID(2), HANDBACK)
  expect(await report.find({ type: 'Text', text: /l2/ })).toBeDefined()
})

test('a notice that comes after a folded report shows its status and time in the report head', async ($, on) => {
  const mount = await open($, on, OLD_REPORT)
  const report = await mount('UserMessage', ID(2), HANDBACK)
  await mount('UserMessage', ID(21), NOTICE)
  expect(await report.find({ type: 'Button', text: /general-purpose · completed · 15m 52s/ })).toBeDefined()
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
