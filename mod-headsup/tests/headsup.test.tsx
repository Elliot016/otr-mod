import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const PANE_PROPS = { title: 'Heads up', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }

const FULL = [
  'learn: The main agent cached /ask, so one-off questions now cost more.',
  'tag: Heads up',
  'title: One-off /ask questions cost more',
  'explain:',
  '- /ask takes a quick side question.',
  '- Watch how often people ask follow-ups.',
].join('\n')

const answered = (text: string) => ({ isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })

type Setup = { reply?: () => unknown; below?: (elements: any) => unknown }

// Stubs everything the mod touches. `forks` and `completes` record what the model was asked, `store` what the mod saved.
function setup(on: any, { reply = () => answered(FULL), below }: Setup = {}) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 5, 16, 52) })
  const store = new Map<string, unknown>()
  const forks: string[] = []
  const completes: { model: string; effort?: string; prompt: string }[] = []
  const fills: { text: string; mode?: string }[] = []
  const states = new Map<string, unknown>()
  let panes: { id: string; isPlaced: boolean }[] = []
  let draft = ''
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Add follow-ups to /ask', toolUses: [] }] }))
  on('model.fork', async (_$: unknown, e: { prompt: string }) => {
    forks.push(e.prompt)
    return { value: await reply() }
  })
  on('model.complete', async (_$: unknown, e: { model: string; effort?: string; prompt: string }) => {
    completes.push({ model: e.model, effort: e.effort, prompt: e.prompt })
    return { value: await reply() }
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_$: unknown, e: { text: string; mode?: string }) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', (_$: unknown, e: { id: string }) => {
    panes = [...panes.filter(pane => pane.id !== e.id), { id: e.id, isPlaced: true }]
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$: unknown, e: { id: string }) => {
    panes = panes.filter(pane => pane.id !== e.id)
    return { value: undefined }
  })
  on('state.set', (_$: unknown, e: { plugin: string; key: string; value: unknown }) => {
    states.set(`${e.plugin}.${e.key}`, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('fs.read', () => ({ deny: 'no file' }))
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  on('ui.render', ($: any, e: unknown) => {
    const elements = $.ui.resolve(e)
    return below ? below(elements) : <elements.Text key="base">base</elements.Text>
  })
  return { clock, store, forks, completes, fills, states, panes: () => panes, setDraft: (text: string) => (draft = text) }
}

async function step($: any, index: number, extra: object = {}) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, ...extra })
  while ((await stream.next()).done !== true);
}

const band = ($: any) => $.ui.mount({ plugin: 'mod-headsup', surface: 'terminal', ...BAND })
const pane = ($: any) => $.ui.mount({ plugin: 'mod-headsup', surface: 'terminal', component: 'Pane', requestId: 'headsup', props: PANE_PROPS })
const click = (ui: any, key: string) => ui.pointer({ in: key, type: 'down', button: 'left', x: 4, y: 0 })
const drawn = async (ui: any, key: string) => JSON.stringify(await ui.drawn({ in: key }).catch(() => null))

// A finding on the card: a prompt sent, then the sixth step of its turn.
async function finding($: any, clock: any, turnId = 't1') {
  await $.prompt.submit({ text: 'Add follow-ups to /ask' })
  await step($, 6, { turnId })
  await clock.settle()
}

test('a check runs on the sixth main step only, once per turn, and never for a subagent', async ($, on) => {
  const { clock, forks } = setup(on, { reply: () => answered('learn: none') })
  for (const index of [0, 1, 2, 3, 4, 5]) await step($, index)
  await clock.settle()
  expect(forks.length).toBe(0)
  await step($, 6)
  await clock.settle()
  expect(forks.length).toBe(1)
  await step($, 12)
  await clock.settle()
  expect(forks.length).toBe(1)
  await step($, 6, { turnId: 't2', agentId: 'agent-1' })
  await clock.settle()
  expect(forks.length).toBe(1)
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks.length).toBe(2)
  // learn: none shows nothing.
  const ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  await ui.unmount()
})

test('the entry shimmers while the check runs, then the card shows the note above next steps with an unread count', async ($, on) => {
  let release = (_: unknown) => {}
  const pending = new Promise(resolve => (release = resolve))
  const { clock } = setup(on, {
    reply: () => pending,
    below: ({ Box, Text }: any) => (
      <Box key="menu-rows" flexDirection="column">
        <Box key="nextsteps-rows"><Text>Run the full suite</Text></Box>
        <Box key="menu-row" flexDirection="row"><Text key="pill">Files</Text></Box>
      </Box>
    ),
  })
  await finding($, clock)
  const ui = await band($)
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).toContain('"isBusy":true')
  release(answered(FULL))
  await clock.settle()
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('The main agent cached /ask')
  expect(tree.indexOf('headsup-card') < tree.indexOf('nextsteps-rows')).toBe(true)
  // One pill row: the card joins the shared row instead of wrapping it.
  expect(tree.split('"menu-rows"').length - 1).toBe(1)
  const entry = JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))
  expect(entry).toContain('"isBusy":false')
  expect(entry).toContain('"text":"1"')
  expect(await drawn(ui, 'headsup-card-learn')).toContain('Learn more')
  expect(await drawn(ui, 'headsup-card-know')).toContain('Know this already')
  await ui.unmount()
})

test('above medium effort the check goes to the session model at medium with the packed conversation', async ($, on) => {
  const { clock, forks, completes } = setup(on)
  await $.prompt.submit({ text: 'Add follow-ups to /ask' })
  await step($, 6, { effort: 'high' })
  await clock.settle()
  expect(forks.length).toBe(0)
  expect(completes.length).toBe(1)
  expect(completes[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' })
  expect(completes[0]!.prompt).toContain('Person: Add follow-ups to /ask')
})

test('with nothing to fork yet the check falls back to the uncached route', async ($, on) => {
  let calls = 0
  const { clock, completes } = setup(on, { reply: () => (calls++ === 0 ? { isAnswered: false, reason: 'nothing-to-fork' } : answered(FULL)) })
  await finding($, clock)
  expect(completes.length).toBe(1)
  const ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeDefined()
  await ui.unmount()
})

test('Know this already stores the topic, closes the card, and the next check is told to skip it', async ($, on) => {
  const { clock, store, forks } = setup(on)
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-know')
  await clock.settle()
  expect(store.get('known')).toEqual(['One-off /ask questions cost more'])
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  await ui.unmount()
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks[1]).toContain('- One-off /ask questions cost more')
  // The same learn line, offered again, never shows twice.
  const again = await band($)
  expect(await again.find({ key: 'headsup-card' })).toBeUndefined()
  await again.unmount()
})

test('the card clears after two prompts, or at once on ×, and stays in the panel', async ($, on) => {
  let n = 0
  const { clock } = setup(on, { reply: () => answered(FULL.replace('one-off questions', `one-off questions (${++n})`)) })
  await finding($, clock)
  await $.prompt.submit({ text: 'next' })
  let ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeDefined()
  await ui.unmount()
  await $.prompt.submit({ text: 'and next' })
  ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  await ui.unmount()

  await step($, 6, { turnId: 't2' })
  await clock.settle()
  ui = await band($)
  await click(ui, 'headsup-card-dismiss')
  await clock.settle()
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  // Dismissed reads it; the first note, cleared by prompts, stays unread.
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).toContain('"text":"1"')
  await ui.unmount()
  const panel = await pane($)
  expect(JSON.stringify(await panel.drawn()).match(/"key":"headsup-note-/g)?.length).toBe(2)
  await panel.unmount()
})

test('Learn more opens the panel on that note: its turn, the explanation, Chat fills the prompt, Simpler words rewrites it, ↗ scrolls', async ($, on) => {
  let rewritten = false
  const { clock, panes, fills, forks, states } = setup(on, { reply: () => answered(rewritten ? 'title: Plainer\nexplain:\n- in short words' : FULL) })
  await $.ui.mount({ plugin: 'mod-headsup', surface: 'terminal', component: 'UserMessage', requestId: 'row-1', props: { text: 'Add follow-ups to /ask', origin: { kind: 'composer' } } } as never)
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-learn')
  await clock.settle()
  expect(panes().map(each => each.id)).toEqual(['headsup'])
  expect(states.get('mod-headsup.pane')).toBe(true)
  // Read on open: no unread count, and the card is gone.
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).not.toContain('"badge"')
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  await ui.unmount()

  const panel = await pane($)
  const tree = JSON.stringify(await panel.drawn())
  expect(tree).toContain('#1')
  expect(tree).toContain('Add follow-ups to /ask')
  expect(tree).toContain('One-off /ask questions cost more')
  expect(tree).toContain('Watch how often people ask follow-ups.')

  const id = String(tree.match(/"id":"headsup-understood-([^"]+)"/)?.[1])
  await click(panel, `headsup-chat-${id}`)
  expect(fills).toEqual([{ text: 'Tell me more about this: The main agent cached /ask, so one-off questions now cost more.', mode: 'replace' }])

  rewritten = true
  await click(panel, `headsup-redo-simpler-${id}`)
  await clock.settle()
  expect(forks.at(-1)).toContain('more plainly')
  const after = JSON.stringify(await panel.drawn())
  expect(after).toContain('Plainer')
  expect(after).toContain('in short words')

  // The kit answers no ui.scroll, so a found row shows the kit's refusal; a row never drawn would say it is not on screen.
  await panel.press({ key: 'turn-jump-1' })
  await clock.settle()
  expect(await panel.find({ type: 'Text', text: /ui\.scroll/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /not on screen/ })).toBeUndefined()
  await panel.unmount()
})

test('the panel contract: the command toggles the panel and the settings, and the pane state follows', async ($, on) => {
  const { panes, states } = setup(on)
  await $.command.run({ command: 'mod-headsup', args: '' } as never)
  expect(panes().map(each => each.id)).toEqual(['headsup'])
  await $.command.run({ command: 'mod-headsup', args: '' } as never)
  expect(panes()).toEqual([])
  expect(states.get('mod-headsup.pane')).toBe(false)

  await $.command.run({ command: 'mod-headsup', args: 'settings' } as never)
  expect(panes().map(each => each.id)).toEqual(['headsup-settings'])
  expect(states.get('mod-headsup.pane')).toBe(true)
  await $.command.run({ command: 'mod-headsup', args: 'settings' } as never)
  expect(panes()).toEqual([])
  expect(states.get('mod-headsup.pane')).toBe(false)
})

test('enabled off makes no model call; forget empties the known topics', { options: { enabled: false } }, async ($, on) => {
  const { clock, store, forks, completes } = setup(on)
  store.set('known', ['A topic'])
  await finding($, clock)
  expect(forks.length + completes.length).toBe(0)
  await $.command.run({ command: 'mod-headsup', args: 'forget' } as never)
  expect(store.get('known')).toEqual([])
})

test('icons=safe draws the plain close mark and bracket-free subpills', { options: { icons: 'safe' } }, async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  expect(await drawn(ui, 'headsup-card-dismiss')).toContain('×')
  expect(await drawn(ui, 'headsup-card-learn')).toContain('↵')
  expect(await drawn(ui, 'headsup-card-learn')).not.toContain('[↵]')
  await ui.unmount()
})

test('icons=nerd draws the Nerd close glyph', { options: { icons: 'nerd' } }, async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  const close = await drawn(ui, 'headsup-card-dismiss')
  expect(close).toContain(String.fromCodePoint(0xf00d))
  expect(close).not.toContain('×')
  await ui.unmount()
})
