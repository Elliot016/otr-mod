// mod-heads-up / tests/heads-up.test.tsx, by v-amorim
// Tests the panel above the prompt: rendering, pill, pane and note cards.
import { expect, mock, test } from 'claude-code/testing'

// The host test types ship no DOM or node globals.
declare const setTimeout: (handler: (value: unknown) => void, ms: number) => unknown

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const PANE_PROPS = { title: 'Heads up', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }

const FULL_LEARN = 'The main agent cached /ask, so one-off questions now cost more.'
const FULL = [
  `learn: ${FULL_LEARN}`,
  'tag: Heads up',
  'title: One-off /ask questions cost more',
  'explain:',
  '- /ask takes a quick side question.',
  '- Watch how often people ask follow-ups.',
].join('\n')
// The same finding in other words: its topic words all appear in FULL_LEARN's.
const REWORDED = 'One-off /ask questions cost more because the main agent cached them.'
const OTHER_TOPIC = 'Each upload retries five times at once, so a slow server gets hammered.'
const about = (learn: string) => FULL.replace(FULL_LEARN, learn)

const answered = (text: string) => ({ isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })

const TRANSCRIPT = '/t/s1.jsonl'
// The engine answers a path in its own form (C:\t\s1.jsonl on Windows), so the file is matched by its name.
const isTranscript = (path: string) => path.endsWith('s1.jsonl')
// One user row per prompt, each the child of the row before, as Claude Code writes them.
const transcriptFor = (prompts: string[]) =>
  prompts.map((text, index) => JSON.stringify({ type: 'user', uuid: `p${index}`, parentUuid: index ? `p${index - 1}` : null, message: { role: 'user', content: text } })).join('\n') + '\n'
// The file and process reads answer bytes as base64, which the test runtime encodes with btoa.
const encoder = new TextEncoder()
const base64Of = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))

type Setup = { reply?: () => unknown; below?: (elements: any) => unknown; isUnplaced?: boolean; gate?: Promise<unknown>; oversize?: boolean; session?: { id: string } }

// Stubs everything the mod touches. `forks` and `completes` record what the model was asked, `store` what the mod saved, `reads` and `runs` the file and process calls, and the transcript holds each prompt the test sent. `gate` holds every read of a session's notes until it resolves; `oversize` makes the file read past 4 MiB, as the engine refuses it.
function setup(on: any, { reply = () => answered(FULL), below, isUnplaced, gate, oversize = false, session = { id: 's1' } }: Setup = {}) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 5, 16, 52) })
  const store = new Map<string, unknown>([['transcript:s1', TRANSCRIPT], ['transcript:s2', TRANSCRIPT]])
  const sent: string[] = []
  const forks: string[] = []
  const completes: { model: string; effort?: string; prompt: string }[] = []
  const fills: { text: string; mode?: string }[] = []
  const states = new Map<string, unknown>()
  const reads: { path: string; as?: string }[] = []
  const runs: string[][] = []
  let panes: { id: string; isPlaced: boolean }[] = []
  let draft = ''
  const transcript = () => transcriptFor(sent)
  on('store.get', async (_$: unknown, e: { key: string }) => {
    if (gate && e.key.startsWith('notes:')) await gate
    return { value: store.get(e.key) }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.id', () => ({ value: session.id }))
  on('session.start', () => ({ cwd: '/w' }))
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
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', (_$: unknown, e: { id: string }) => {
    if (isUnplaced) return { value: { isPlaced: false, reason: 'too narrow' } }
    panes = [...panes.filter(pane => pane.id !== e.id), { id: e.id, isPlaced: true }]
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$: unknown, e: { id: string }) => {
    panes = panes.filter(pane => pane.id !== e.id)
    return { value: undefined }
  })
  on('state.get', (_$: unknown, e: { plugin: string; key: string }) => ({ value: { value: states.get(`${e.plugin}.${e.key}`) } }))
  on('state.set', (_$: unknown, e: { plugin: string; key: string; value: unknown }) => {
    states.set(`${e.plugin}.${e.key}`, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('fs.stat', (_$: unknown, e: { path: string }) => (isTranscript(e.path) ? { value: { kind: 'file', size: encoder.encode(transcript()).length, mtimeMs: 0, isLink: false } } : { deny: 'no file' }))
  on('fs.read', (_$: unknown, e: { path: string; as?: string }) => {
    reads.push({ path: e.path, as: e.as })
    if (!isTranscript(e.path)) return { deny: 'no file' }
    if (e.as !== 'bytes') return { value: transcript() }
    if (oversize) return { deny: 'the file is over 4 MiB' }
    return { value: { base64: base64Of(encoder.encode(transcript())) } }
  })
  // The POSIX form of a read from an offset: sh -c script sh path, from plus one, length.
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    runs.push(e.argv)
    const from = Number(e.argv[5]) - 1
    const slice = encoder.encode(transcript()).subarray(from, from + Number(e.argv[6]))
    return { value: { exitCode: 0, stdout: base64Of(slice), stderr: '' } }
  })
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  on('ui.render', ($: any, e: unknown) => {
    const elements = $.ui.resolve(e)
    return below ? below(elements) : <elements.Text key="base">base</elements.Text>
  })
  return { clock, store, forks, completes, fills, states, reads, runs, panes: () => panes, setDraft: (text: string) => (draft = text) }
}

async function step($: any, index: number, extra: object = {}) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, ...extra })
  while ((await stream.next()).done !== true);
}

const band = ($: any) => $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', ...BAND })
const pane = ($: any) => $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', component: 'Pane', requestId: 'headsup', props: PANE_PROPS })
const click = (ui: any, key: string) => ui.pointer({ in: key, type: 'down', button: 'left', x: 4, y: 0 })
const drawn = async (ui: any, key: string) => JSON.stringify(await ui.drawn({ in: key }).catch(() => null))

// A finding on the card: a prompt sent, then the sixth step of its turn.
async function finding($: any, clock: any, turnId = 't1') {
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
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

test('a headless session never checks: no fork, no completion, until a session that is interactive', async ($, on) => {
  const { clock, forks, completes } = setup(on)
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false } as never)
  await finding($, clock)
  expect(forks.length + completes.length).toBe(0)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks.length).toBe(1)
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
  expect(await drawn(ui, 'headsup-card-open')).toContain('Open')
  await ui.unmount()
})

for (const [verdict, isShown] of [['drop', false], ['keep', true]] as const) {
  test(`when the main turn moves on while the check runs, a recheck answering ${verdict} ${isShown ? 'shows' : 'drops'} the note`, async ($, on) => {
    let release = (_: unknown) => {}
    const first = new Promise(resolve => (release = resolve))
    let calls = 0
    const { clock, forks } = setup(on, { reply: () => (calls++ === 0 ? first : answered(verdict)) })
    await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
    await step($, 6)
    await clock.settle()
    // The main agent takes another step before the check answers.
    await step($, 7)
    release(answered(FULL))
    await clock.settle()
    expect(forks.length).toBe(2)
    expect(forks[1]).toContain('keep or drop')
    const ui = await band($)
    expect(Boolean(await ui.find({ key: 'headsup-card' }))).toBe(isShown)
    await ui.unmount()
  })
}

test('with no newer step there is no recheck', async ($, on) => {
  const { clock, forks } = setup(on)
  await finding($, clock)
  expect(forks.length).toBe(1)
})

test('above medium effort the check goes to the session model at medium with the packed conversation', async ($, on) => {
  const { clock, forks, completes } = setup(on)
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
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

test('Got it in the panel stores the topic, closes the card and reads the note, and the next check is told to skip it', async ($, on) => {
  const { clock, store, forks } = setup(on)
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-open')
  await clock.settle()
  await ui.unmount()
  const panel = await pane($)
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-understood-([^"]+)"/)?.[1])
  await click(panel, `headsup-understood-${id}`)
  await clock.settle()
  expect(store.get('known')).toEqual(['One-off /ask questions cost more'])
  await panel.unmount()
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks[1]).toContain('- One-off /ask questions cost more')
  const again = await band($)
  expect(await again.find({ key: 'headsup-card' })).toBeUndefined()
  await again.unmount()
})

test('a reworded repeat of a note already shown is not shown again', async ($, on) => {
  let learn = FULL_LEARN
  const { clock, forks } = setup(on, { reply: () => answered(about(learn)) })
  await finding($, clock)
  await $.prompt.submit({ text: 'next' } as never)
  await $.prompt.submit({ text: 'and next' } as never)
  learn = REWORDED
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(forks.length).toBe(2)
  const ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  await ui.unmount()
  const panel = await pane($)
  expect(JSON.stringify(await panel.drawn()).match(/"key":"headsup-note-/g)?.length).toBe(1)
  await panel.unmount()
})

test('seen topics are stored under their session; the known topics stay global', async ($, on) => {
  const { clock, store } = setup(on)
  await finding($, clock)
  expect(store.get('seen:s1')).toEqual([FULL_LEARN])
  expect(store.has('seen')).toBe(false)
})

test('the store keeps the notes and seen topics of the 40 most recent sessions, and deletes the rest', async ($, on) => {
  const { store } = setup(on)
  const older = Array.from({ length: 40 }, (_, index) => `old-${index}`)
  store.set('sessions', older)
  for (const session of older) {
    store.set(`notes:${session}`, { notes: [], card: null, since: 0, checked: null })
    store.set(`seen:${session}`, [])
  }
  const ui = await band($)
  await ui.unmount()
  expect(store.get('sessions')).toEqual([...older.slice(1), 's1'])
  expect(store.has('notes:old-0')).toBe(false)
  expect(store.has('seen:old-0')).toBe(false)
  expect(store.has('notes:old-1')).toBe(true)
})

test('the pane says when the last check ran: no check yet, then the turn it read and whether it flagged a note', async ($, on) => {
  let answer = 'learn: none'
  const { clock } = setup(on, { reply: () => answered(answer) })
  const panel = await pane($)
  expect(JSON.stringify(await panel.drawn())).toContain('No check yet')
  await finding($, clock)
  expect(JSON.stringify(await panel.drawn())).toContain('Last check: turn 1, under a minute ago. Nothing to flag.')
  answer = FULL
  await $.prompt.submit({ text: 'and next' } as never)
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(JSON.stringify(await panel.drawn())).toContain('Last check: turn 2, under a minute ago. Flagged a note.')
  await panel.unmount()
})

test('two hooks that ask at once share one load, so the second reads the notes the first loads', async ($, on) => {
  let open = (_: unknown) => {}
  const gate = new Promise(resolve => (open = resolve))
  const { store } = setup(on, { gate })
  store.set('notes:s1', {
    notes: [{ id: 'n1-1', turn: 1, prompt: 'Add follow-ups to /ask', at: 1, isRead: false, learn: FULL_LEARN, tag: 'Heads up', title: 'One-off /ask questions cost more', body: ['/ask takes a quick side question.'] }],
    card: null,
    since: 0,
    checked: null,
  })
  const bandMounting = band($)
  const paneMounting = pane($)
  await new Promise(resolve => setTimeout(resolve, 50))
  open(undefined)
  const ui = await bandMounting
  const panel = await paneMounting
  expect(JSON.stringify(await panel.drawn())).toContain('The main agent cached /a')
  await ui.unmount()
  await panel.unmount()
})

test('the timeline dot marks what is unread: a filled badge-blue dot, and a read note goes back to the muted or selected look', async ($, on) => {
  const { store } = setup(on)
  const note = (n: number, isRead: boolean) => ({ id: `n${n}-${n}`, turn: n, prompt: `prompt ${n}`, at: n, isRead, learn: `learn ${n}`, tag: 'Heads up', title: `title ${n}`, body: [`body ${n}`] })
  store.set('notes:s1', { notes: [note(1, true), note(2, false), note(3, false)], card: null, since: 0, checked: null })
  const panel = await pane($)
  const dot = async (n: number) => {
    const props = JSON.stringify(await panel.find({ key: `note-dot-n${n}-${n}` }))
    return [props.match(/"lead":"([^"]*)"/)?.[1], props.match(/"leadColor":"([^"]*)"/)?.[1]]
  }
  // Muted and hollow when read, the menu badge's blue and filled when unread, whether or not the note is the one open in the card.
  expect(await dot(1)).toEqual(['○', '#9BA3C4'])
  expect(await dot(2)).toEqual(['●', '#7386D0'])
  expect(await dot(3)).toEqual(['●', '#7386D0'])
  await click(panel, 'headsup-note-n3-3')
  expect(await dot(3)).toEqual(['●', '#CED9FF'])
  expect(await dot(2)).toEqual(['●', '#7386D0'])
  await panel.unmount()
})

test('the card has two actions, Open and ×, and no Know this already', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  const tree = JSON.stringify(await ui.drawn())
  const ids = [...tree.matchAll(/"id":"(headsup-card-[a-z]+)"/g)].map(each => each[1])
  expect([...new Set(ids.filter(id => id !== 'headsup-card-tag'))].sort()).toEqual(['headsup-card-dismiss', 'headsup-card-open'])
  expect(tree).not.toContain('Know this')
  await ui.unmount()
})

test('an open note has Got it, Ask Claude and Reword, the summary once, and the three rewordings only after Reword', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-open')
  await clock.settle()
  await ui.unmount()
  const panel = await pane($)
  const tree = JSON.stringify(await panel.drawn())
  const ids = [...tree.matchAll(/"id":"(headsup-(?:understood|chat|reword|redo-[a-z]+)-[^"]+)"/g)].map(each => each[1]!.replace(/-n1-.*$/, ''))
  expect([...new Set(ids)].sort()).toEqual(['headsup-chat', 'headsup-reword', 'headsup-understood'])
  expect(tree.split('"key":"summary-').length - 1).toBe(1)
  const id = String(tree.match(/"id":"headsup-reword-([^"]+)"/)?.[1])
  await click(panel, `headsup-reword-${id}`)
  await clock.settle()
  const after = JSON.stringify(await panel.drawn())
  for (const direction of ['simpler', 'less', 'more']) expect(after).toContain(`headsup-redo-${direction}-${id}`)
  await panel.unmount()
})

test('the panel shows the newest note in a card over a timeline of every note, a click on a row selects it, and Got it reads it', async ($, on) => {
  const { clock, states } = setup(on)
  await finding($, clock)
  const panel = await pane($)
  const shown = JSON.stringify(await panel.drawn())
  const id = String(shown.match(/"id":"headsup-note-([^"]+)"/)?.[1])
  // The newest note is in the card without a click; its row sits in the timeline, whose rail and jump belong to the row.
  const card = JSON.stringify(await panel.find({ key: 'note-card' }))
  expect(card).toContain('#1')
  expect(card).toContain('Watch how often people ask follow-ups.')
  expect(shown.split('"key":"note-row-').length - 1).toBe(1)
  expect(shown).toContain('Heads up')
  // The actions ride in one row inside the card.
  const bar = JSON.stringify(await panel.find({ key: 'headsup-actions' }))
  expect(JSON.stringify(await panel.find({ key: 'note-card' }))).toContain('headsup-actions')
  for (const action of ['understood', 'chat', 'reword']) expect(bar).toContain(`headsup-${action}-${id}`)
  await click(panel, `headsup-note-${id}`)
  await clock.settle()
  expect(states.get('mod-heads-up.open')).toEqual([id])
  expect(JSON.stringify(await panel.find({ key: 'note-card' }))).toContain('Watch how often people ask follow-ups.')
  await click(panel, `headsup-understood-${id}`)
  await clock.settle()
  expect(states.get('mod-heads-up.open')).toEqual([])
  const ui = await band($)
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).not.toContain('"badge"')
  await ui.unmount()
  await panel.unmount()
})

test('the X on the panel card hides it and keeps the timeline, and a click on a row shows the card again', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const panel = await pane($)
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-note-([^"]+)"/)?.[1])
  expect(JSON.stringify(await panel.find({ key: 'note-card' }))).toContain('"id":"headsup-close"')
  await click(panel, 'headsup-close')
  await clock.settle()
  const closed = JSON.stringify(await panel.drawn())
  expect(closed).not.toContain('"key":"note-card"')
  expect(closed).toContain(`"key":"note-row-${id}"`)
  expect(closed).not.toContain('No notes yet')
  await click(panel, `headsup-note-${id}`)
  await clock.settle()
  expect(JSON.stringify(await panel.find({ key: 'note-card' }))).toContain('Watch how often people ask follow-ups.')
  await panel.unmount()
})

test('a card closed in one session shows again after a /resume away and back', async ($, on) => {
  const session = { id: 's1' }
  const { clock } = setup(on, { session })
  await finding($, clock)
  let panel = await pane($)
  await click(panel, 'headsup-close')
  await clock.settle()
  expect(JSON.stringify(await panel.drawn())).not.toContain('"key":"note-card"')
  await panel.unmount()
  for (const id of ['s2', 's1']) {
    session.id = id
    panel = await pane($)
    await clock.settle()
    await panel.unmount()
  }
  panel = await pane($)
  expect(JSON.stringify(await panel.drawn())).toContain('"key":"note-card"')
  await panel.unmount()
})

test('the card keeps the three buttons in one row, and Reword puts its three choices in that same row', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const panel = await pane($)
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-note-([^"]+)"/)?.[1])
  const before = JSON.stringify(await panel.find({ key: 'headsup-actions' }))
  expect(before).not.toContain('headsup-redo-')
  await click(panel, `headsup-reword-${id}`)
  await clock.settle()
  const after = JSON.stringify(await panel.find({ key: 'headsup-actions' }))
  for (const direction of ['simpler', 'less', 'more']) expect(after).toContain(`headsup-redo-${direction}-${id}`)
  expect(after).toContain(`headsup-reword-${id}`)
  expect(JSON.stringify(await panel.drawn()).split('"key":"headsup-actions"').length - 1).toBe(1)
  await panel.unmount()
})

test('hovering a note header posts its tip into the footer', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const panel = await pane($)
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-note-([^"]+)"/)?.[1])
  await panel.pointer({ in: `headsup-note-${id}`, type: 'move', x: 1, y: 0 })
  await clock.settle()
  const footer = JSON.stringify(await panel.find({ key: 'pane-footer' }))
  expect(footer).toContain('Open note')
  expect(footer).toContain('shows this note in the card')
  await panel.unmount()
})

test('a hovered pane control posts its tip into the footer, and the card and the pill show theirs in the band tip row', async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  await ui.pointer({ in: 'headsup-card-dismiss', type: 'move', x: 1, y: 0 })
  await clock.settle()
  expect(JSON.stringify(await ui.drawn())).toContain('Dismiss:')
  await ui.pointer({ in: 'menu-entry-headsup', type: 'move', x: 1, y: 0 })
  await clock.settle()
  expect(JSON.stringify(await ui.drawn())).toContain('notes on things you should know')
  await click(ui, 'headsup-card-open')
  await clock.settle()
  await ui.unmount()
  const panel = await pane($)
  expect(JSON.stringify(await panel.find({ key: 'pane-footer' }))).not.toContain('Ask Claude')
  const id = String(JSON.stringify(await panel.drawn()).match(/"id":"headsup-chat-([^"]+)"/)?.[1])
  await panel.pointer({ in: `headsup-chat-${id}`, type: 'move', x: 1, y: 0 })
  await clock.settle()
  const hovered = JSON.stringify(await panel.find({ key: 'pane-footer' }))
  expect(hovered).toContain('Ask Claude')
  expect(hovered).toContain('drafts a follow-up in your prompt')
  await panel.pointer({ in: 'headsup-settings', type: 'move', x: 1, y: 0 })
  await clock.settle()
  expect(JSON.stringify(await panel.find({ key: 'pane-footer' }))).toContain('opens this mod')
  await panel.unmount()
})

test('the card clears after two prompts, or at once on ×, and stays in the panel', async ($, on) => {
  const topics = [FULL_LEARN, OTHER_TOPIC]
  let n = 0
  const { clock } = setup(on, { reply: () => answered(about(topics[n++] ?? FULL_LEARN)) })
  await finding($, clock)
  await $.prompt.submit({ text: 'next' } as never)
  let ui = await band($)
  expect(await ui.find({ key: 'headsup-card' })).toBeDefined()
  await ui.unmount()
  await $.prompt.submit({ text: 'and next' } as never)
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

test('Open opens the panel on that note: its turn, the explanation, Chat fills the prompt, Simpler words rewrites it, ↗ scrolls', async ($, on) => {
  let rewritten = false
  const { clock, panes, fills, forks, states } = setup(on, { reply: () => answered(rewritten ? 'title: Plainer\nexplain:\n- in short words' : FULL) })
  await $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', component: 'UserMessage', requestId: 'row-1', props: { text: 'Add follow-ups to /ask', origin: { kind: 'composer' } } } as never)
  await finding($, clock)
  const ui = await band($)
  await click(ui, 'headsup-card-open')
  await clock.settle()
  expect(panes().map(each => each.id)).toEqual(['headsup'])
  expect(states.get('mod-heads-up.pane')).toBe(true)
  // Read on open: no unread count, and the card is gone.
  expect(JSON.stringify(await ui.find({ key: 'menu-entry-headsup' }))).not.toContain('"badge"')
  expect(await ui.find({ key: 'headsup-card' })).toBeUndefined()
  await ui.unmount()

  const panel = await pane($)
  const tree = JSON.stringify(await panel.drawn())
  expect(tree).toContain('#1')
  expect(tree).toContain('One-off /ask questions cost more')
  expect(tree).toContain('Watch how often people ask follow-ups.')

  const id = String(tree.match(/"id":"headsup-understood-([^"]+)"/)?.[1])
  await click(panel, `headsup-chat-${id}`)
  expect(fills).toEqual([{ text: 'Tell me more about this: The main agent cached /ask, so one-off questions now cost more.', mode: 'replace' }])

  rewritten = true
  await click(panel, `headsup-reword-${id}`)
  await clock.settle()
  await click(panel, `headsup-redo-simpler-${id}`)
  await clock.settle()
  expect(forks.at(-1)).toContain('more plainly')
  const after = JSON.stringify(await panel.drawn())
  expect(after).toContain('Plainer')
  expect(after).toContain('in short words')

  // The kit answers no ui.scroll, so a found row shows the kit's refusal; a row never drawn would say it is not on screen.
  await panel.press({ key: `note-jump-${id}` })
  await clock.settle()
  expect(await panel.find({ type: 'Text', text: /ui\.scroll/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /not on screen/ })).toBeUndefined()
  await panel.unmount()
})

test('a note keeps the row of its own prompt, so its jump does not reach a later copy of the same text', async ($, on) => {
  const topics = [FULL_LEARN, OTHER_TOPIC]
  let n = 0
  const { clock, store } = setup(on, { reply: () => answered(about(topics[n++] ?? FULL_LEARN)) })
  const row = (requestId: string) => $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', component: 'UserMessage', requestId, props: { text: 'Add follow-ups to /ask', origin: { kind: 'composer' } } } as never)
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
  await row('p0')
  await step($, 6, { turnId: 't1' })
  await clock.settle()
  await $.prompt.submit({ text: 'next' } as never)
  await $.prompt.submit({ text: 'and next' } as never)
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
  await row('p3')
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  const stored = (store.get('notes:s1') as { notes: { turn: number; promptId?: string }[] }).notes
  expect(stored.map(note => [note.turn, note.promptId])).toEqual([[1, 'p0'], [4, 'p3']])
  const panel = await pane($)
  const first = JSON.stringify(await panel.drawn()).match(/note-jump-(n1-\d+)/)?.[1]
  expect(first).toBeDefined()
  await panel.press({ key: `note-jump-${first}` })
  await clock.settle()
  expect(await panel.find({ type: 'Text', text: /ui.scroll/ })).toBeDefined()
  await panel.unmount()
})

test('the panel contract: the command toggles the panel and the settings, and the pane state follows', async ($, on) => {
  const { panes, states } = setup(on)
  await $.command.run({ command: 'mod-heads-up', args: '' } as never)
  expect(panes().map(each => each.id)).toEqual(['headsup'])
  await $.command.run({ command: 'mod-heads-up', args: '' } as never)
  expect(panes()).toEqual([])
  expect(states.get('mod-heads-up.pane')).toBe(false)

  await $.command.run({ command: 'mod-heads-up', args: 'settings' } as never)
  expect(panes().map(each => each.id)).toEqual(['headsup-settings'])
  expect(states.get('mod-heads-up.pane')).toBe(true)
  await $.command.run({ command: 'mod-heads-up', args: 'settings' } as never)
  expect(panes()).toEqual([])
  expect(states.get('mod-heads-up.pane')).toBe(false)
})

test('enabled off makes no model call; forget empties the known topics', { options: { enabled: false } }, async ($, on) => {
  const { clock, store, forks, completes } = setup(on)
  store.set('known', ['A topic'])
  await finding($, clock)
  expect(forks.length + completes.length).toBe(0)
  await $.command.run({ command: 'mod-heads-up', args: 'forget' } as never)
  expect(store.get('known')).toEqual([])
})

test('a check reads only the bytes the transcript gained since the last check', async ($, on) => {
  const { clock, reads, runs } = setup(on, { reply: () => answered('learn: none') })
  await $.prompt.submit({ text: 'Add follow-ups to /ask' } as never)
  const gainedFrom = encoder.encode(transcriptFor(['Add follow-ups to /ask'])).length
  await step($, 6)
  await clock.settle()
  expect(reads.filter(each => each.as === 'bytes').length).toBe(1)
  await $.prompt.submit({ text: 'and next' } as never)
  await step($, 6, { turnId: 't2' })
  await clock.settle()
  expect(reads.filter(each => each.as === 'bytes').length).toBe(1)
  expect(runs.length).toBe(1)
  expect(runs[0]![5]).toBe(String(gainedFrom + 1))
})

test('a transcript over 4 MiB is still numbered, its bytes read through a process', async ($, on) => {
  const { clock, runs } = setup(on, { oversize: true })
  await finding($, clock)
  const panel = await pane($)
  expect(JSON.stringify(await panel.drawn())).toContain('#1')
  expect(runs.length).toBeGreaterThan(0)
  await panel.unmount()
})

test('icons=safe draws the plain close mark and bracket-free subpills', { options: { icons: 'safe' } }, async ($, on) => {
  const { clock } = setup(on)
  await finding($, clock)
  const ui = await band($)
  expect(await drawn(ui, 'headsup-card-dismiss')).toContain('×')
  expect(await drawn(ui, 'headsup-card-open')).toContain('↵')
  expect(await drawn(ui, 'headsup-card-open')).not.toContain('[↵]')
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

test('hovering a toast × shows its tip in the band tip row', async ($, on) => {
  setup(on, { isUnplaced: true })
  const ui = await band($)
  await click(ui, 'menu-entry-headsup')
  await ui.pointer({ in: 'toast-headsup-1', type: 'move', x: 0, y: 0 })
  expect(JSON.stringify(await ui.drawn())).toContain('Dismiss:')
  await ui.unmount()
})
