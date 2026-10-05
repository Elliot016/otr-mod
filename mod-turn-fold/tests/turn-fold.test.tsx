import { expect, mock, test } from 'claude-code/testing'

import { callTime, elapsed, previewOf, rowKey, timeOfDay, turnLine, TurnLog } from '../hooks/turns'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const row = (n: number, type: string, extra: object) => JSON.stringify({ type, uuid: ID(n), parentUuid: n > 1 ? ID(n - 1) : null, ...extra })
const said = (n: number, content: unknown[]) => row(n, 'assistant', { message: { role: 'assistant', content } })
const PATCH = [{ lines: [' keep', '-old', '+new', '+added'] }]

// One turn that edits a file and runs a skill, then a second prompt still running.
const TRANSCRIPT = [
  row(1, 'user', { message: { role: 'user', content: 'fix the bug' } }),
  said(2, [{ type: 'text', text: 'Looking.' }]),
  said(3, [{ type: 'thinking', thinking: 'which file?' }, { type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: 'C:\\repo\\hooks\\a.ts' } }]),
  row(4, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_edit', content: 'ok' }] }, toolUseResult: { structuredPatch: PATCH } }),
  said(5, [{ type: 'tool_use', id: 'toolu_skill', name: 'Skill', input: { skill: 'tidy' } }]),
  row(6, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_skill', content: 'ok' }] } }),
  said(7, [{ type: 'text', text: 'Fixed.' }]),
  row(8, 'system', { subtype: 'turn_duration', durationMs: 64000 }),
  row(9, 'user', { message: { role: 'user', content: '<system-reminder>noise</system-reminder>' } }),
  row(10, 'user', { message: { role: 'user', content: 'now the docs' } }),
  '{"torn',
].join('\n')

// The open turn's chip line, drawn by its Client, and a click at a cell of it.
const chipsOf = async (ui: any) => JSON.stringify(await ui.drawn({ in: 'toggle-chips-line' }))
const pick = (ui: any, x: number) => ui.pointer({ in: 'toggle-chips-line', type: 'down', button: 'left', x, y: 0 })

const logOf = (text: string) => {
  const log = new TurnLog()
  for (const line of text.split('\n')) log.feed(line)
  return log
}

test('the transcript splits into turns at each prompt, with tools, diff counts, reply and time', () => {
  const log = logOf(TRANSCRIPT)
  expect(log.turns.map(turn => turn.prompt)).toEqual([ID(1), ID(10)])
  const [first] = log.turns
  expect(turnLine(first!)).toBe('2 tools · Edit(hooks/a.ts) · Skill(tidy)')
  expect([first!.tools[0]!.added, first!.tools[0]!.removed, first!.durationMs]).toEqual([2, 1, 64000])
  expect(first!.reply).toBe(rowKey(ID(7)))
  expect(log.turnOf('toolu_edit')).toBe(first)
  expect(log.turnOf(`${ID(2).slice(0, 24)}000000000003`)).toBe(first)
  expect(log.turnAt(ID(10))).toBe(log.turns[1])
})

test('a call drawn before its input streams in gets the input later, and never shows empty parentheses', () => {
  const log = logOf(TRANSCRIPT)
  const last = log.turns[log.turns.length - 1]!
  log.claimCall('toolu_live', 'Edit', {}, true, undefined)
  expect(turnLine(last)).toBe('1 tool · Edit')
  expect(turnLine(last)).not.toContain('Edit()')
  log.claimCall('toolu_live', 'Edit', { file_path: '/w/hooks/b.ts', old_string: 'a', new_string: 'b' }, true, undefined)
  expect(turnLine(last)).toContain('Edit(hooks/b.ts)')
})

test('a call first seen finished shows no time, and a later output with the patch fills in its counts', () => {
  const log = new TurnLog()
  log.claim(ID(50), 'prompt')
  log.claimCall('toolu_g', 'Edit', { file_path: '/a.ts' }, false, {})
  expect(callTime(log.callOf('toolu_g'))).toBe('')
  log.claimCall('toolu_g', 'Edit', { file_path: '/a.ts' }, false, { structuredPatch: PATCH })
  expect([log.callOf('toolu_g')!.added, log.callOf('toolu_g')!.removed]).toEqual([2, 1])
})

test('an opened call previews its diff, a new file, or the start of its result', () => {
  const edit = previewOf('Edit', {}, { structuredPatch: PATCH }, 'The file was updated')
  expect(edit.lines.map(line => `${line.kind}:${line.text}`)).toEqual(['same:keep', 'del:old', 'add:new', 'add:added'])
  expect(previewOf('Write', { content: 'a\nb' }, {}, '').lines.map(line => line.kind)).toEqual(['add', 'add'])
  const long = previewOf('Bash', {}, {}, Array.from({ length: 20 }, (_, n) => `line ${n}`).join('\n'))
  expect([long.lines.length, long.more, long.lines[0]!.text]).toEqual([8, 12, 'line 0'])
  // Drawn before the transcript has the result, a call reads its row's output.
  expect(previewOf('Bash', {}, { stdout: 'built\n', stderr: '' }, '').lines).toEqual([{ text: 'built', kind: 'out' }])
})

test('a failed Write counts no lines, read from the transcript or drawn', () => {
  const content = 'line one\nline two\nline three'
  const log = new TurnLog()
  for (const line of [
    row(1, 'user', { message: { role: 'user', content: 'write it' } }),
    said(2, [{ type: 'tool_use', id: 'toolu_bad', name: 'Write', input: { file_path: '/a.ts', content } }]),
    row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bad', content: 'File has not been read yet', is_error: true }] } }),
    said(4, [{ type: 'tool_use', id: 'toolu_good', name: 'Write', input: { file_path: '/b.ts', content } }]),
    row(5, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_good', content: 'ok' }] } }),
  ]) log.feed(line)
  expect([log.callOf('toolu_bad')!.added, log.callOf('toolu_good')!.added]).toEqual([0, 3])

  log.claimCall('toolu_drawn', 'Write', { file_path: '/c.ts', content }, false, {}, true)
  expect(log.callOf('toolu_drawn')!.added).toBe(0)
})

test('calls drawn live learn the thinking before them from the session messages; text and results end a thought', () => {
  const log = new TurnLog()
  log.claim(ID(40), 'prompt')
  for (const id of ['toolu_x', 'toolu_y', 'toolu_z']) log.claimCall(id, 'Read', {}, false, {})
  log.learnThoughts([
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'read x first' }, { type: 'tool_use', id: 'toolu_x' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'now y' }, { type: 'tool_use', id: 'toolu_y' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_y' }] },
    { role: 'assistant', content: [{ type: 'redacted_thinking', data: '…' }, { type: 'tool_use', id: 'toolu_z' }] },
  ])
  expect(log.callOf('toolu_x')?.thought).toBe('read x first')
  expect(log.callOf('toolu_y')?.thought).toBeUndefined()
  expect(log.callOf('toolu_z')?.thought).toBe('')
})

test('times: a prompt keeps when it was sent, a call its start and how long it took', () => {
  const at = (s: string) => ({ timestamp: `2026-10-03T14:${s}.000Z` })
  const log = logOf([
    row(1, 'user', { message: { role: 'user', content: 'run the tests' }, ...at('32:00') }),
    row(2, 'assistant', { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'claude plugin test .' } }] }, ...at('32:05') }),
    row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bash', content: 'ok' }] }, ...at('32:46') }),
  ].join('\n'))
  expect(log.turns[0]!.at).toBe(Date.parse('2026-10-03T14:32:00.000Z'))
  expect(callTime(log.callOf('toolu_bash'))).toBe(`${timeOfDay(Date.parse('2026-10-03T14:32:05.000Z'))} · 41s`)
  expect([elapsed(400), elapsed(41_000), elapsed(372_000), elapsed(3_780_000)]).toEqual(['0.4s', '41s', '6m 12s', '1h 3m'])
  expect(callTime({ id: 'x', name: 'Bash', input: {}, added: 0, removed: 0, startedAt: 1 })).toBe('')
})

const TIMED = [
  row(1, 'user', { message: { role: 'user', content: 'run the tests' }, timestamp: '2026-10-03T14:32:00.000Z' }),
  row(2, 'assistant', { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'claude plugin test .' } }] }, timestamp: '2026-10-03T14:32:05.000Z' }),
  row(3, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bash', content: 'ok' }] }, timestamp: '2026-10-03T14:32:46.000Z' }),
  said(4, [{ type: 'text', text: 'Done.' }]),
  row(5, 'system', { subtype: 'turn_duration', durationMs: 47000 }),
  // The next prompt is what folds the turn before it.
  row(6, 'user', { message: { role: 'user', content: 'now the docs' }, timestamp: '2026-10-03T14:34:00.000Z' }),
].join('\n') + '\n'

// isLive writes the transcript after the session starts, so its last turn counts as still running.
async function mountTimed($: any, on: any, text = TIMED, isLive = false, startsTurn = true) {
  let written = isLive ? '' : text
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('classic.SessionStart', () => ({}))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: written.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: written }))
  mock.clock(on)
  on('session.start', (_$: unknown, e: unknown) => e)
  on('command.register', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, {})
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  await $.classic.SessionStart({ session_id: 's1', transcript_path: '/t/s1.jsonl', source: 'startup', hook_event_name: 'SessionStart', cwd: '/w' } as never)
  written = text
  if (isLive && startsTurn) await $.turn.start({ turnId: 't1' } as never)
  // A reload fires session.start, not turn.start.
  if (isLive && !startsTurn) await $.session.start({ cwd: '/w' } as never)
  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-turn-fold', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  return {
    prompt: await mount('UserMessage', ID(1), { text: 'run the tests', origin: { kind: 'composer' }, isExpanded: true }),
    tool: await mount('ToolUse', 'toolu_bash', { tool_use_id: 'toolu_bash', tool: 'Bash', input: { command: 'claude plugin test .' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} }),
  }
}

test('the prompt row shows when it was sent, the head how long the turn took, and a picked chip how long each call took', async ($, on) => {
  const { prompt, tool } = await mountTimed($, on)
  expect(await prompt.find({ type: 'Text', text: `${timeOfDay(Date.parse('2026-10-03T14:32:00.000Z'))} ` })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: '47s ' })).toBeDefined()
  // The finished turn starts folded; its chip line shows under the head once it opens, and the tool row itself draws nothing.
  await prompt.press({ key: 'toggle-turn-button' })
  expect(await chipsOf(prompt)).toContain('Ran')
  expect(await tool.find({ type: 'Text' })).toBeUndefined()
  expect(await prompt.find({ type: 'Text', text: '41s ' })).toBeUndefined()
  await pick(prompt, 1)
  expect(await prompt.find({ type: 'Button', text: /^ \S Bash\(claude plugin test/ })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: '41s ' })).toBeDefined()
  // A click on a call's line opens it: what the call gave back shows under the line, the tool row stays hidden, and a second click closes it.
  await prompt.press({ key: 'toggle-call-0-button' })
  expect(await prompt.find({ type: 'Text', text: 'ok' })).toBeDefined()
  expect(await tool.find({ type: 'Text' })).toBeUndefined()
  await prompt.press({ key: 'toggle-call-0-button' })
  expect(await prompt.find({ type: 'Text', text: 'ok' })).toBeUndefined()
  // A second click on the open chip closes it.
  await pick(prompt, 1)
  expect(await prompt.find({ type: 'Button', text: /^ \S Bash\(claude plugin test/ })).toBeUndefined()
})

// The same turn still running: no turn_duration row yet, and Claude is working.
const LIVE = TIMED.split('\n').slice(0, 4).join('\n')

test('the running turn shows its tool rows in full, then folds once it ends', async ($, on) => {
  const { tool } = await mountTimed($, on, LIVE, true)
  expect(await tool.find({ type: 'Text', text: 'base ToolUse' })).toBeDefined()
  expect(await tool.find({ type: 'Button', text: /^Bash\(claude plugin test/ })).toBeUndefined()
})

test('a mod reload mid-turn misses turn.start and still shows the running turn in full', async ($, on) => {
  const { tool } = await mountTimed($, on, LIVE, true, false)
  expect(await tool.find({ type: 'Text', text: 'base ToolUse' })).toBeDefined()
})

test('a tool row drawn before the transcript holds it counts as the running turn and shows in full', async ($, on) => {
  const { tool } = await mountTimed($, on, TIMED.split('\n').slice(0, 1).join('\n'), true)
  expect(await tool.find({ type: 'Text', text: 'base ToolUse' })).toBeDefined()
})

test('a finished turn stays open until the next prompt', async ($, on) => {
  // Its turn_duration row is read, so the turn has ended; only the next prompt folds it.
  const { tool } = await mountTimed($, on, TIMED.split('\n').slice(0, 5).join('\n') + '\n')
  expect(await tool.find({ type: 'Text', text: 'base ToolUse' })).toBeDefined()
})

test('with expand_live off, the running turn folds its finished tool rows at once', { options: { expand_live: false } }, async ($, on) => {
  const { tool } = await mountTimed($, on, LIVE, true)
  expect(await tool.find({ type: 'Button', text: /^Bash\(claude plugin test/ })).toBeDefined()
})

test('icons=nerd draws the times as rounded pills', { options: { icons: 'nerd' } }, async ($, on) => {
  const { prompt, tool } = await mountTimed($, on)
  const drawn = JSON.stringify(await prompt.drawn())
  expect(drawn).toContain(String.fromCodePoint(0xe0b6))
  // The time's column carries the prompt's background down a wrapped prompt, and the pill a lighter one so it still shows.
  expect(drawn).toMatch(/"key":"toggle-prompt-time-row"[^}]*"backgroundColor":"#1C2033"/)
  expect(drawn).toMatch(/"key":"toggle-prompt-time-body","backgroundColor":"#252A42"/)
  expect(await prompt.find({ type: 'Text', text: timeOfDay(Date.parse('2026-10-03T14:32:00.000Z')) })).toBeDefined()
  await prompt.press({ key: 'toggle-turn-button' })
  await pick(prompt, 1)
  expect(await prompt.find({ type: 'Text', text: '41s' })).toBeDefined()
  expect(await tool.find({ type: 'Text' })).toBeUndefined()
})

test('icons=safe draws the times as plain muted text, with no Nerd caps', { options: { icons: 'safe' } }, async ($, on) => {
  const { prompt } = await mountTimed($, on)
  const drawn = JSON.stringify(await prompt.drawn())
  expect(drawn).not.toContain(String.fromCodePoint(0xe0b6))
  expect(await prompt.find({ type: 'Text', text: `${timeOfDay(Date.parse('2026-10-03T14:32:00.000Z'))} ` })).toBeDefined()
})

test('with timestamps off, rows show no times', { options: { timestamps: false } }, async ($, on) => {
  const { prompt, tool } = await mountTimed($, on)
  expect(await prompt.find({ type: 'Text', text: /^\d\d:\d\d $/ })).toBeUndefined()
  await prompt.press({ key: 'toggle-turn-button' })
  await pick(prompt, 1)
  expect(await prompt.find({ type: 'Button', text: /^ \S Bash\(claude plugin test/ })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: /41s/ })).toBeUndefined()
  expect(await tool.find({ type: 'Text' })).toBeUndefined()
})

test('a subagent report opens its own turn, so the prompt keeps its own reply; a mid-turn report does not', () => {
  const log = logOf([
    row(1, 'user', { message: { role: 'user', content: 'plan the layout' } }),
    said(2, [{ type: 'text', text: 'Here is the layout.' }]),
    row(3, 'user', { isMeta: true, origin: { kind: 'peer' }, message: { role: 'user', content: 'Another Claude session sent a message: report' } }),
    said(4, [{ type: 'text', text: 'Collision Guard is done.' }]),
    row(5, 'attachment', { attachment: { type: 'queued_command', prompt: '<agent-message from="a1">report</agent-message>', isMeta: true } }),
    said(6, [{ type: 'text', text: 'Noted.' }]),
  ].join('\n'))
  expect(log.turns.map(turn => turn.prompt)).toEqual([ID(1), ID(3)])
  expect(log.turns[0]!.reply).toBe(rowKey(ID(2)))
  expect(log.turns[1]!.reply).toBe(rowKey(ID(6)))
})

test('the transcript is read once; rows drawn later join their turn and fold at the next prompt', async ($, on) => {
  let reads = 0
  on('classic.SessionStart', () => ({}))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => {
    reads += 1
    return { value: TRANSCRIPT }
  })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  await $.classic.SessionStart({ session_id: 's1', transcript_path: '/t/s1.jsonl', source: 'startup', hook_event_name: 'SessionStart', cwd: '/w' } as never)
  // A compact keeps the same transcript, so it is not read again.
  await $.classic.SessionStart({ session_id: 's1', transcript_path: '/t/s1.jsonl', source: 'compact', hook_event_name: 'SessionStart', cwd: '/w' } as never)
  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-turn-fold', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const toolProps = { tool_use_id: 'toolu_new', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} }

  // The transcript never sees this turn; its rows are claimed as they draw, and the latest turn stays open.
  await $.turn.start({ turnId: 't2' } as never)
  const fresh = await mount('UserMessage', ID(20), { text: 'list the files', origin: { kind: 'composer' }, isExpanded: true })
  const tool = await mount('ToolUse', 'toolu_new', toolProps)
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'ok', isAborted: false } as never)
  expect(await tool.find({ type: 'Text', text: 'base ToolUse' })).toBeDefined()
  await fresh.unmount()
  await tool.unmount()

  // The next prompt folds it: its row draws nothing, and its prompt carries the fold line.
  await mount('UserMessage', ID(21), { text: 'and the docs', origin: { kind: 'composer' }, isExpanded: true })
  const folded = await mount('ToolUse', 'toolu_new', toolProps)
  expect(await folded.find({ type: 'Text' })).toBeUndefined()
  const head = await mount('UserMessage', ID(20), { text: 'list the files', origin: { kind: 'composer' }, isExpanded: true })
  expect(await head.find({ type: 'Button', text: /^1 tool$/ })).toBeDefined()
  expect(reads).toBe(1)
})

test('a new session, whose transcript is not written yet, folds its turns; a group claims calls that draw no rows of their own', async ($, on) => {
  // Only session.start arrives, before the transcript file exists.
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's2' }))
  on('env.get', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', () => ({ cwd: '/w' }))
  mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{e.component === 'ToolGroup' ? 'Thought for 6s, ran 2 shell commands' : `base ${e.component}`}</Text>
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)

  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-turn-fold', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const shell = (id: string) => ({ tool_use_id: id, tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} })
  const live = [
    await mount('UserMessage', ID(30), { text: 'list the files', origin: { kind: 'composer' }, isExpanded: true }),
    await mount('ToolGroup', 'collapsed-toolu_a', { calls: [shell('toolu_a'), shell('toolu_b')], isActive: false, isExpanded: false }),
    await mount('ToolGroup', `collapsed-${ID(32)}`, { calls: [], isActive: false, isExpanded: false }),
    await mount('TurnDuration', ID(33), { word: 'Cooked', durationMs: 12000 }),
  ]
  for (const ui of live) await ui.unmount()

  await mount('UserMessage', ID(31), { text: 'and the docs', origin: { kind: 'composer' }, isExpanded: true })
  const head = await mount('UserMessage', ID(30), { text: 'list the files', origin: { kind: 'composer' }, isExpanded: true })
  const group = await mount('ToolGroup', 'collapsed-toolu_a', { calls: [shell('toolu_a'), shell('toolu_b')], isActive: false, isExpanded: false })
  expect(await head.find({ type: 'Button', text: /^2 tools$/ })).toBeDefined()
  // The live turn's duration comes from its own duration line, since the transcript was never read for it.
  expect(await head.find({ type: 'Text', text: '12s ' })).toBeDefined()
  expect(await group.find({ type: 'Text' })).toBeUndefined()
  // A group of thinking alone belongs to the turn too: it never draws outside the card, folded or open.
  const thinking = await mount('ToolGroup', `collapsed-${ID(32)}`, { calls: [], isActive: false, isExpanded: false })
  expect(await thinking.find({ type: 'Text' })).toBeUndefined()
  await head.press({ key: 'toggle-turn-button' })
  expect(await chipsOf(head)).toMatch(/Ran .*"2"/)
  expect(await thinking.find({ type: 'Text' })).toBeUndefined()
  expect(await group.find({ type: 'Text' })).toBeUndefined()
})

test('a finished turn folds under its prompt, keeps its reply, and a click unfolds it', async ($, on) => {
  on('classic.SessionStart', () => ({}))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: TRANSCRIPT }))
  mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })

  await $.classic.SessionStart({ session_id: 's1', transcript_path: '/t/s1.jsonl', source: 'startup', hook_event_name: 'SessionStart', cwd: '/w' } as never)

  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-turn-fold', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const prompt = await mount('UserMessage', ID(1), { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: true })
  const step = await mount('AssistantMessage', ID(2), { text: 'Looking.', isFirstOfReply: true })
  const reply = await mount('AssistantMessage', ID(7), { text: 'Fixed.', isFirstOfReply: false })
  const edit = await mount('ToolUse', 'toolu_edit', { tool_use_id: 'toolu_edit', tool: 'Edit', input: { file_path: '/repo/hooks/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: { structuredPatch: PATCH } })
  const result = await mount('ToolResult', 'toolu_edit', { tool_use_id: 'toolu_edit', tool: 'Edit', output: { structuredPatch: PATCH }, isErrored: false })

  // Folded: the prompt and its summary line, the reply; the step, the tool row and its result draw nothing.
  expect(await prompt.find({ type: 'Text', text: 'base UserMessage' })).toBeDefined()
  expect(await prompt.find({ type: 'Button', text: '2 tools · Edit(hooks/a.ts) · Skill(tidy)' })).toBeDefined()
  expect(await prompt.find({ type: 'Button', text: /^ \+ $/ })).toBeDefined()
  expect(await reply.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
  expect(await step.find({ type: 'Text' })).toBeUndefined()
  expect(await edit.find({ type: 'Button' })).toBeUndefined()
  expect(await result.find({ type: 'Text' })).toBeUndefined()

  // Unfolded: the step draws again in the card; the head lists the work by kind, so the tool row and result draw nothing.
  await prompt.press({ key: 'toggle-turn-button' })
  expect(await prompt.find({ type: 'Button', text: /^ \u2212 $/ })).toBeDefined()
  expect(await step.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()
  // Unfolded rows sit in the turn's card; the reply stays outside it.
  expect(await step.find({ key: 'toggle-card-bar' })).toBeDefined()
  expect(await reply.find({ key: 'toggle-card-bar' })).toBeUndefined()
  expect(await chipsOf(prompt)).toContain('Edited')
  expect(await chipsOf(prompt)).toContain('Other')
  // The head carries the turn's counts as a pill and its time on the right.
  expect(await prompt.find({ type: 'Text', text: /^\+2$/ })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: /^ \u22121$/ })).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: '1m 4s ' })).toBeDefined()
  expect(await edit.find({ type: 'Text' })).toBeUndefined()
  expect(await result.find({ type: 'Text' })).toBeUndefined()

  // A click on a chip lists its calls under the line; Thought comes first, so Edited starts at cell 16.
  expect(await prompt.find({ type: 'Button', text: / Edit\(hooks\/a\.ts\) $/ })).toBeUndefined()
  await pick(prompt, 17)
  expect(await prompt.find({ type: 'Button', text: / Edit\(hooks\/a\.ts\) $/ })).toBeDefined()

  // A click on the card's strip folds the turn back.
  await step.pointer({ in: 'toggle-card-strip', type: 'down', button: 'left', x: 0, y: 0 })
  expect(await prompt.find({ type: 'Button', text: /^ \+ $/ })).toBeDefined()
  expect(await step.find({ type: 'Text' })).toBeUndefined()

  for (const ui of [prompt, step, reply, edit, result]) await ui.unmount()
})

test('an open turn shows a chip per kind in order of first use, Thought first, one open at a time', async ($, on) => {
  on('classic.SessionStart', () => ({}))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: TRANSCRIPT }))
  mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{e.component === 'ToolGroup' ? 'Thought for 56s, read 1 file, edited 1 file' : `base ${e.component}`}</Text>
  })
  await $.classic.SessionStart({ session_id: 's1', transcript_path: '/t/s1.jsonl', source: 'startup', hook_event_name: 'SessionStart', cwd: '/w' } as never)

  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-turn-fold', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const prompt = await mount('UserMessage', ID(1), { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: true })
  const calls = [
    { tool_use_id: 'toolu_edit', tool: 'Edit', input: { file_path: '/repo/hooks/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: { structuredPatch: PATCH } },
    { tool_use_id: 'toolu_read', tool: 'Read', input: { file_path: '/repo/hooks/b.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: {} },
  ]
  const group = await mount('ToolGroup', 'toolu_edit', { calls, isActive: false, isExpanded: false })

  // Folded or open, the group itself draws nothing: the head lists the turn's work.
  expect(await group.find({ type: 'Text' })).toBeUndefined()
  await prompt.press({ key: 'toggle-turn-button' })
  expect(await group.find({ type: 'Text' })).toBeUndefined()
  // Thought first, then each kind in the order the turn first used it: the edit came before the skill.
  const line = await chipsOf(prompt)
  expect([line.indexOf('Thought '), line.indexOf('Edited '), line.indexOf('Other ')].every((at, n, all) => at >= 0 && (n === 0 || at > all[n - 1]!))).toBe(true)

  // The transcript has a thinking block before the edit; its time lives only in Claude Code's sealed drawing.
  expect(await prompt.find({ type: 'Text', text: 'which file?' })).toBeUndefined()
  await pick(prompt, 1)
  expect(await prompt.find({ type: 'Text', text: 'which file?' })).toBeDefined()
  // One chip open at a time: picking Edited closes Thought.
  await pick(prompt, 17)
  expect(await prompt.find({ type: 'Text', text: 'which file?' })).toBeUndefined()
  expect(await prompt.find({ type: 'Button', text: / Edit\(hooks\/a\.ts\) $/ })).toBeDefined()
  expect(await prompt.find({ type: 'Button', text: /^ \S Skill\(/ })).toBeUndefined()
  for (const ui of [prompt, group]) await ui.unmount()
})

test('with fold_turns off, finished turns start open and the line folds them', { options: { fold_turns: false } }, async ($, on) => {
  on('classic.SessionStart', () => ({}))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: TRANSCRIPT }))
  mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })

  await $.classic.SessionStart({ session_id: 's1', transcript_path: '/t/s1.jsonl', source: 'startup', hook_event_name: 'SessionStart', cwd: '/w' } as never)

  const mount = (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-turn-fold', surface: 'terminal', component, requestId, viewport: { columns: 120, rows: 40 }, props } as never)
  const prompt = await mount('UserMessage', ID(1), { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: true })
  const step = await mount('AssistantMessage', ID(2), { text: 'Looking.', isFirstOfReply: true })

  expect(await prompt.find({ type: 'Button', text: /^ − $/ })).toBeDefined()
  expect(await step.find({ type: 'Text', text: 'base AssistantMessage' })).toBeDefined()

  await prompt.press({ key: 'toggle-turn-button' })
  expect(await prompt.find({ type: 'Button', text: /^ \+ $/ })).toBeDefined()
  expect(await step.find({ type: 'Text' })).toBeUndefined()

  for (const ui of [prompt, step]) await ui.unmount()
})

test('/mod-turn-fold settings opens its own panel: a click saves a setting, an action runs, and actions wait while Claude works', async ($, on) => {
  const saved: unknown[] = []
  const ran: string[] = []
  const ROWS = [
    { key: 'mod-turn-fold.fold_turns', label: 'Fold finished turns', description: 'Starts folded', kind: 'boolean', value: true, provider: { kind: 'plugin', name: 'mod-turn-fold' }, isLocked: false },
  ]
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) =>
    String(e.path).endsWith('showcase.json') ? { value: JSON.stringify({
            actions: [{ label: 'Say hi', command: 'other', args: 'hi' }, { label: 'Fold all', command: 'mod-turn-fold' }],
            previews: { fold_turns: { true: [{ bar: 'border', spans: [{ text: ' + ', bg: 'accent' }, { text: ' 2 tools · Edit', color: 'muted' }] }, { spans: [{ text: '● Fixed.' }] }] } },
          }) } : { value: '' },
  )
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('config.list', () => ({ value: ROWS }))
  on('config.set', (_$, e) => {
    saved.push([e.key, e.value])
    return { value: e.value }
  })
  on('command.run', (_$, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  mock.clock(on)

  await $.command.run({ command: 'mod-turn-fold', args: 'settings' })
  const ui = await $.ui.mount({
    plugin: 'mod-turn-fold',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'toggle-settings',
    props: { title: 'mod-turn-fold', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  expect(await ui.find({ type: 'Text', text: /^Fold finished turns$/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'setting-0-flip' }))).toContain('On')
  // The example card shows the folded turn this value draws: the prompt, its + line, the reply.
  expect(await ui.find({ key: 'setting-preview-0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ 2 tools · Edit$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^● Fixed.$/ })).toBeDefined()

  await ui.pointer({ in: 'setting-0-flip', type: 'down', button: 'left', x: 1, y: 0 })
  expect(saved).toEqual([['mod-turn-fold.fold_turns', false]])

  await ui.press({ key: 'action-0' })
  expect(ran).toEqual(['other hi'])
  // Its own command skips $.command.run, which never reaches the calling plugin, and answers in the status line.
  await ui.press({ key: 'action-1' })
  expect(ran).toEqual(['other hi'])
  expect(await ui.find({ type: 'Text', text: /every finished turn/ })).toBeDefined()

  await $.turn.start({ turnId: 't1', prompt: 'x' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Button', text: /Say hi/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Say hi · available once Claude is idle/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Fold all/ })).toBeDefined()
  await ui.unmount()
})
