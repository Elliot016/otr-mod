import { expect, mock, test } from 'claude-code/testing'

import { parseRow, promptsOf, targetOf } from '../hooks/prompts'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const user = (n: number, parent: number | null, content: unknown, extra: object = {}) =>
  JSON.stringify({ type: 'user', uuid: ID(n), parentUuid: parent === null ? null : ID(parent), timestamp: '2026-10-03T11:58:00Z', message: { role: 'user', content }, ...extra })
const reply = (n: number, parent: number) => JSON.stringify({ type: 'assistant', uuid: ID(n), parentUuid: ID(parent), message: { role: 'assistant', content: [] } })

// One kept prompt, a rewound one, a slash command, a tool result, a hook wrapper, a queued prompt and a second kept prompt.
const TRANSCRIPT = [
  user(1, null, 'first prompt'),
  reply(2, 1),
  user(3, 2, 'abandoned by rewind'),
  user(4, 2, '/mod-menu'),
  reply(5, 4),
  user(6, 5, [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }]),
  user(7, 6, '<system-reminder>noise</system-reminder>'),
  JSON.stringify({ type: 'attachment', uuid: ID(8), parentUuid: ID(7), attachment: { type: 'queued_command', prompt: 'typed mid turn' } }),
  user(9, 8, [{ type: 'text', text: 'second prompt' }]),
  // The second prompt's turn: two tool calls, an edit that changed three lines, a failed write, and its length.
  JSON.stringify({ type: 'assistant', uuid: ID(10), parentUuid: ID(9), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a' }, { type: 'tool_use', id: 'b' }] } }),
  user(11, 10, [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }], { toolUseResult: { type: 'update', structuredPatch: [{ lines: [' same', '+new', '+newer', '-old'] }] } }),
  user(12, 11, [{ type: 'tool_result', tool_use_id: 'b', content: 'denied', is_error: true }], { toolUseResult: { type: 'create', content: 'a\nb\nc' } }),
  JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 23400, uuid: ID(13), parentUuid: ID(12) }),
  '{"torn',
].join('\n')

test('prompts are the live branch, without commands, tool results, wrappers or rewound rows', () => {
  const rows = TRANSCRIPT.split('\n').flatMap(line => parseRow(line) ?? [])
  expect(promptsOf(rows).map(prompt => prompt.text)).toEqual(['first prompt', 'typed mid turn', 'second prompt'])
  expect(promptsOf(rows)[0]!.id).toBe(ID(1))
  // The failed write counts no lines.
  expect(promptsOf(rows)[2]).toMatchObject({ tools: 2, added: 2, removed: 1, durationMs: 23400 })
})

test('the timeline lists prompts and the turn of the open one, a click opens a stop, and jump scrolls', async ($, on) => {
  const scrolled: string[] = []
  const spawned: string[] = []
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('classic.SessionStart', () => ({}))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => {
    spawned.push(neutral(e.path))
    return { value: TRANSCRIPT }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({ value: { isFocused: true } }))
  on('ui.scroll', (_$, e) => {
    scrolled.push(String((e as { to?: { requestId?: string } }).to?.requestId))
    return { value: {} }
  })
  mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.classic.SessionStart({ session_id: 's1', transcript_path: '/t/s1.jsonl', source: 'startup', hook_event_name: 'SessionStart', cwd: '/w' } as never)
  await $.command.run({ command: 'mod-prompts' })

  // Claude Code draws the first prompt's row under a split-row id that keeps the uuid's first four groups.
  const row = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'UserMessage', requestId: `${ID(1).slice(0, 24)}000000000007`, props: { text: 'first prompt', origin: { kind: 'composer' } } } as never)

  const ui = await $.ui.mount({
    plugin: 'mod-prompts',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompts',
    props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  expect(spawned).toEqual(['/t/s1.jsonl'])
  expect(JSON.stringify(await ui.drawn({ in: 'prompts-tab' }))).toContain('3')
  // The last prompt opens first: its stop, then its turn as pills.
  expect(JSON.stringify(await ui.drawn({ in: 'timeline-before' }))).toContain(' second prompt')
  expect(await ui.find({ type: 'Text', text: '23s' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 tools' })).toBeDefined()
  // A stop shows the clock time its prompt was sent; the queued fixture row has no timestamp, so it shows none.
  const sent = new Date('2026-10-03T11:58:00Z')
  const hhmm = `${String(sent.getHours()).padStart(2, '0')}:${String(sent.getMinutes()).padStart(2, '0')}`
  expect(JSON.stringify(await ui.drawn({ in: 'timeline-before' })).split(`${hhmm} `).length - 1).toBe(2)

  // A click on a stop opens it, and the stops after it move under its details; the jump Button scrolls.
  await ui.pointer({ in: 'timeline-before', type: 'down', button: 'left', x: 8, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'timeline-before' }))).toContain(' first prompt')
  expect(JSON.stringify(await ui.drawn({ in: 'timeline-after' }))).toContain('second prompt')
  await ui.press({ key: 'open-jump' })
  // The kit answers no ui.scroll, so the press shows its refusal; targetOf is checked on its own below.
  expect(await ui.find({ type: 'Text', text: /no implementation for ui.scroll/ })).toBeDefined()
  await ui.unmount()
  await row.unmount()

  // Scrolled down, the card stays at the top of the view.
  const scrolledPane = await $.ui.mount({
    plugin: 'mod-prompts',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompts',
    props: { title: 'Prompts', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 12, bodyRows: 20 }, view: {} },
  } as never)
  expect(JSON.stringify(await scrolledPane.drawn())).toContain('"top":12')
  expect(await scrolledPane.find({ type: 'Text', text: 'first prompt' })).toBeDefined()
  await scrolledPane.unmount()

  // A prompt sent later joins the list as its row draws, and the transcript is not read again.
  // The prompt typed mid turn is drawn under an id that is not the file's; drawn again, it stays listed once.
  for (const n of [70, 71]) {
    const redrawn = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'UserMessage', requestId: ID(n), props: { text: 'typed mid turn', origin: { kind: 'composer' } } } as never)
    await redrawn.unmount()
  }
  const later = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'UserMessage', requestId: ID(42), props: { text: 'later prompt', origin: { kind: 'composer' } } } as never)
  await later.unmount()
  const reopened = await $.ui.mount({
    plugin: 'mod-prompts',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompts',
    props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  expect(JSON.stringify(await reopened.drawn({ in: 'prompts-tab' }))).toContain('4')
  expect(spawned).toEqual(['/t/s1.jsonl'])
  await reopened.unmount()
})

test('a long session pages by 100, each page split across several timeline Clients', async ($, on) => {
  const many = Array.from({ length: 342 }, (_, n) => user(n + 1, n === 0 ? null : n, `prompt number ${n + 1} with a few more words to make the row long enough`)).join('\n')
  on('store.get', () => ({ value: '/t/long.jsonl' }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's2' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: many.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: `${many}\n` }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, {})
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'prompts-tab' }))).toContain('342')
  // The newest prompt is open, so the last page shows, with a Prev pill and no Next.
  expect(await ui.find({ type: 'Text', text: 'Page 4 of 4 · 301–342' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'timeline-before' }))).toContain('prompt number 301 ')
  expect(JSON.stringify(await ui.drawn())).toContain('prompt number 342')
  expect(JSON.stringify(await ui.drawn())).not.toContain('prompt number 300 ')
  expect(JSON.stringify(await ui.drawn())).not.toContain('prompts-page-next')
  // Prev goes back a page; the open prompt's details stay off it.
  await ui.pointer({ in: 'prompts-page-prev', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: 'Page 3 of 4 · 201–300' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'timeline-before' }))).toContain('prompt number 201 ')
  expect(JSON.stringify(await ui.drawn())).not.toContain('timeline-after')
  // Scrolled down, the pager stays at the top of the view with the card.
  await ui.unmount()
  const scrolled = await $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 90, bodyRows: 40 }, view: {} } } as never)
  const card = JSON.stringify(await scrolled.drawn())
  expect(card).toContain('"top":90')
  expect(card.indexOf('Page 3 of 4')).toBeGreaterThan(card.indexOf('"top":90'))
  await scrolled.unmount()
})

test('a jump targets the id the row was drawn under, else the uuid', () => {
  const drawn = new Map([[ID(1).slice(0, 24), `${ID(1).slice(0, 24)}000000000007`]])
  expect(targetOf(drawn, ID(1))).toBe(`${ID(1).slice(0, 24)}000000000007`)
  expect(targetOf(drawn, ID(2))).toBe(ID(2))
})

test('the title tabs swap the sidebar and its settings', async ($, on) => {
  const opened: string[] = []
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('config.list', () => ({ value: [{ key: 'mod-prompts.animations', label: 'Animations', kind: 'boolean', value: true, description: 'd' }] }) as never)
  on('fs.list', () => ({ value: [] }))
  mock.env(on, {})
  mock.clock(on)
  const pane = (requestId: string) =>
    ({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId, props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } }) as never

  const ui = await $.ui.mount(pane('prompts'))
  await ui.pointer({ in: 'prompts-settings', type: 'down', button: 'left', x: 1, y: 0 })
  expect(opened).toEqual(['prompts-settings'])
  await ui.unmount()

  const settings = await $.ui.mount(pane('prompts-settings'))
  expect(await settings.find({ type: 'Text', text: 'Animations' })).toBeDefined()
  await settings.pointer({ in: 'prompts-tab', type: 'down', button: 'left', x: 1, y: 0 })
  expect(opened).toEqual(['prompts-settings', 'prompts'])
  await settings.unmount()
})

// The sidebar with nothing in the transcript, enough to draw the title row's settings pill.
async function emptyPane($: any, on: any) {
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
  on('fs.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, {})
  mock.clock(on)
  return $.ui.mount({ plugin: 'mod-prompts', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as never)
}

test('icons=nerd draws the settings pill with the Nerd gear', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await emptyPane($, on)
  expect(JSON.stringify(await ui.drawn({ in: 'prompts-settings' }))).toContain(String.fromCodePoint(0xf013))
  await ui.unmount()
})

test('icons=safe draws the settings pill with the plain gear', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await emptyPane($, on)
  const pill = JSON.stringify(await ui.drawn({ in: 'prompts-settings' }))
  expect(pill).toContain('⊛')
  expect(pill).not.toContain(String.fromCodePoint(0xf013))
  await ui.unmount()
})
