// mod-wrap-up / tests/wrap-up.test.tsx, by v-amorim
// Tests handoff prompt building, word clamping, thread parsing and the wrap-up band's drawing.
import { expect, mock, test } from 'claude-code/testing'

import { buildPrompt, clampWords, compactNote, isFresh, parseThreads, scopeNote, skillBody } from '../hooks/handoff'
import { CAPS, THEME } from '../hooks/theme'

const SKILL = '---\nname: session-handoff\ndescription: x\n---\n\n# session-handoff\n\nWrite one message.'
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = (isWorking = false) =>
  ({
    plugin: 'mod-wrap-up',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  }) as const

// Stubs every op the flow reaches and records the order they were called in.
// threads is Haiku's reply for the picker. The kit answers no $.ui.ask, so a picker that gets that far sees it dismissed.
function world(on: any, fork: unknown, runClear: () => unknown = () => ({ text: '' }), messages: unknown[] = [], threads: unknown = answered) {
  const calls: string[] = []
  const filled: string[] = []
  const forks: string[] = []
  const toasts: string[] = []
  const completes: string[] = []
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.messages', () => ({ value: messages }))
  on('model.complete', (_$: unknown, e: { prompt: string; model: string }) => {
    if (e.model === 'haiku') {
      calls.push('threads')
      return { value: threads }
    }
    completes.push(e.prompt)
    calls.push('complete')
    return { value: answered }
  })
  on('fs.read', (_$: unknown, e: { path: string }) => ({ value: e.path.replace(/\\/g, '/').endsWith('skills/session-handoff/SKILL.md') ? SKILL : '' }))
  on('model.fork', (_$: unknown, e: { prompt: string }) => {
    forks.push(e.prompt)
    calls.push('fork')
    return { value: fork }
  })
  on('command.run', (_$: unknown, e: { command: string }) => {
    calls.push(`run:${e.command}`)
    return runClear()
  })
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    calls.push('fill')
    filled.push(e.text)
    return { isFilled: true }
  })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">idle</Text>
  })
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, {})
  return { calls, filled, forks, toasts, completes, clock }
}

const answered = { isAnswered: true, text: '  Goal: ship it.  ', usage: USAGE }

type Band = { pointer: (event: never) => Promise<void>; drawn: (scope: { in: string }) => Promise<unknown> }

// Entries are Clients: a click is a pointer down, and a label is what the Client drew.
const click = (band: Band, key: string) => band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key } as never)
const label = async (band: Band, key: string) => JSON.stringify(await band.drawn({ in: key }))

// The pill is one Client: ` Wrap up ` (cells 0 to 8), ` Handoff ` (9 to 17), ` Compact ` (18 to 26); Nerd adds the pill's left cap and a cap cell each side of an option.
const OPTION_X = { safe: { handoff: 10, compact: 20 }, nerd: { handoff: 12, compact: 24 } }
const choose = (band: Band, option: 'handoff' | 'compact', icons: 'safe' | 'nerd' = 'safe') =>
  band.pointer({ type: 'down', x: OPTION_X[icons][option], y: 0, button: 'left', in: 'wrap-up-entry' } as never)

// The pointer opens the pill; Handoff opens the card and its go writes the handoff.
async function handOff(band: Band) {
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  await click(band, 'wrap-up-go')
}

test('the prompt is the skill body with the cap, and bad caps fall back', () => {
  expect(skillBody(SKILL)).toBe('# session-handoff\n\nWrite one message.')
  expect(buildPrompt(SKILL, 250)).toContain('The cap for this run is 250 words')
  expect(buildPrompt(SKILL, 250)).not.toContain('description: x')
  expect([clampWords(undefined), clampWords(5), clampWords(99999), clampWords(300)]).toEqual([400, 100, 2000, 300])
  expect(isFresh({ text: 'a', at: 0 }, 1000)).toBe(true)
  expect(isFresh({ text: 'a', at: 0 }, 999999)).toBe(false)
})

test('the idle pill reads Wrap up; the pointer opens Handoff and Compact and lights the one under it, as the menu entries do', async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain(' Wrap up ')
  expect(await label(band, 'wrap-up-entry')).not.toContain(' Handoff ')

  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-entry' } as never)
  expect(await label(band, 'wrap-up-entry')).toContain(' Handoff ')
  expect(await label(band, 'wrap-up-entry')).toContain(' Compact ')
  expect(await label(band, 'wrap-up-entry')).not.toContain(THEME.lifted)

  await band.pointer({ type: 'move', x: OPTION_X.safe.compact, y: 0, in: 'wrap-up-entry' } as never)
  const drawn = await band.drawn({ in: 'wrap-up-entry' }) as { children: { children: { props: { color: string }; children: string[] }[] }[] }
  const lit = drawn.children.flatMap(child => child.children ?? []).filter(text => text.props?.color === THEME.accent)
  expect(lit.map(text => text.children.join(''))).toEqual([' Compact '])
  expect(await label(band, 'wrap-up-entry')).not.toContain(THEME.lifted)

  await band.pointer({ type: 'leave', x: 0, y: 0, in: 'wrap-up-entry' } as never)
  expect(await label(band, 'wrap-up-entry')).not.toContain(' Handoff ')
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('Cancel closes the card and runs nothing', async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  expect(await band.find({ key: 'wrap-up-card' })).toBeDefined()
  await click(band, 'wrap-up-cancel')
  expect(await band.find({ key: 'wrap-up-card' })).toBeUndefined()
  expect(await band.find({ key: 'wrap-up-entry' })).toBeDefined()
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('Yes forks, clears, then fills the handoff without sending it', async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  await handOff(band)

  expect(w.calls).toEqual(['fork', 'run:clear', 'fill'])
  expect(w.forks[0]).toContain('The cap for this run is 400 words')
  expect(w.forks[0]).toContain('Write one message.')
  expect(w.filled).toEqual(['Goal: ship it.'])
  expect(await band.find({ key: 'wrap-up-entry' })).toBeDefined()
  await band.unmount()
})

test('an empty session stops before the clear and says why in a card, not the pill row', async ($, on) => {
  const w = world(on, { isAnswered: false, reason: 'nothing-to-fork' })
  const band = await $.ui.mount(BAND())
  await handOff(band)

  expect(w.calls).toEqual(['fork'])
  expect(w.toasts).toEqual([])
  expect(await band.find({ type: 'Text', text: 'Nothing to hand off yet, send a message first' })).toBeDefined()
  await w.clock.advance(4000)
  expect(await band.find({ type: 'Text', text: /hand off yet/ })).toBeUndefined()
  expect(await band.find({ key: 'wrap-up-entry' })).toBeDefined()
  await band.unmount()
})

test('a resumed session with nothing to fork summarizes the transcript instead', async ($, on) => {
  const resumed = [
    { role: 'user', text: 'fix the build', toolUses: [] },
    { role: 'assistant', text: 'Looking.', toolUses: [{ tool_use_id: 't', tool: 'Bash', input: { command: 'npm   run build' } }] },
  ]
  const w = world(on, { isAnswered: false, reason: 'nothing-to-fork' }, undefined, resumed)
  const band = await $.ui.mount(BAND())
  await handOff(band)

  // Haiku's reply is no thread list, so nothing is asked and everything carries over.
  expect(w.calls).toEqual(['threads', 'fork', 'complete', 'run:clear', 'fill'])
  expect(w.completes[0]).toContain('USER: fix the build')
  expect(w.completes[0]).toContain('[Bash: npm run build]')
  expect(w.completes[0]).toContain('The cap for this run is 400 words')
  expect(w.filled).toEqual(['Goal: ship it.'])
  await band.unmount()
})

const SESSION = [{ role: 'user', text: 'fix the build, then the docs', toolUses: [] }]
const THREADS = {
  isAnswered: true,
  usage: USAGE,
  text: '{"threads":[{"label":"Build fix","detail":"The failing build and its cause."},{"label":"Docs, rewrite","detail":"The README rewrite."},{"label":"Deploy","detail":"The deploy plan for Friday."}]}',
}

const ALL_ALSO = { files: true, decisions: true, tasks: true, errors: true }

test('the picks become the handoff scope and the /compact text', () => {
  const threads = parseThreads(THREADS.text)
  // Labels lose their commas, so a list of them still reads as one item each.
  expect(threads.map(thread => thread.label)).toEqual(['Build fix', 'Docs rewrite', 'Deploy'])
  expect(parseThreads('{"threads":[{"label":"Only one","detail":"x"}]}')).toEqual([])
  expect(parseThreads('not json')).toEqual([])

  const kept = [threads[0]!, threads[2]!]
  const also = { ...ALL_ALSO, errors: false }
  const scope = scopeNote(threads, kept, also)
  expect(scope).toContain('Carry over only these threads of the session:\n- Build fix: The failing build and its cause.\n- Deploy: The deploy plan for Friday.')
  expect(scope).toContain('Leave out everything about:\n- Docs rewrite: The README rewrite.')
  expect(scope).toContain('Also leave out the errors seen and how they were fixed.')
  expect(scopeNote(threads, threads, ALL_ALSO)).toBe('')

  expect(compactNote(threads, kept, also)).toBe('Focus on Build fix and Deploy. Keep the files in play, the decisions made and the open tasks. Leave out Docs rewrite.')
  expect(compactNote(threads, threads, { files: true, decisions: false, tasks: false, errors: false })).toBe('Keep the files in play.')
  expect(compactNote([], [], { files: false, decisions: false, tasks: false, errors: false })).toBe('')
})

test('Compact reads the threads into the card; a click drops one and the go fills /compact for review', async ($, on) => {
  const w = world(on, answered, undefined, SESSION, THREADS)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'compact')
  await w.clock.advance(10)

  expect(await label(band, 'wrap-up-thread-1')).toContain(' Docs rewrite ')
  expect(await band.find({ type: 'Text', text: '/compact ' })).toBeDefined()
  await click(band, 'wrap-up-thread-1')
  expect(await band.find({ type: 'Text', text: 'Focus on Build fix and Deploy. Keep the files in play, the decisions made and the open tasks. Leave out Docs rewrite.' })).toBeDefined()

  await click(band, 'wrap-up-go')
  expect(w.calls).toEqual(['threads', 'fill'])
  expect(w.filled).toEqual(['/compact Focus on Build fix and Deploy. Keep the files in play, the decisions made and the open tasks. Leave out Docs rewrite.'])
  expect(await band.find({ key: 'wrap-up-card' })).toBeUndefined()
  await band.unmount()
})

test('Handoff carries the dropped threads into the fork prompt; switching modes keeps the picks', async ($, on) => {
  const w = world(on, answered, undefined, SESSION, THREADS)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'compact')
  await w.clock.advance(10)
  await click(band, 'wrap-up-thread-1')
  await choose(band, 'handoff')
  expect(await band.find({ type: 'Text', text: /^Writes a handoff/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '/compact ' })).toBeUndefined()

  await click(band, 'wrap-up-go')
  expect(w.calls).toEqual(['threads', 'fork', 'run:clear', 'fill'])
  expect(w.forks[0]).toContain('Leave out everything about:\n- Docs rewrite: The README rewrite.')
  await band.unmount()
})

test('pick_threads off reads no threads and keeps everything', { options: { pick_threads: false } }, async ($, on) => {
  const w = world(on, answered, undefined, SESSION, THREADS)
  const band = await $.ui.mount(BAND())
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  expect(await band.find({ type: 'Text', text: 'Threads' })).toBeUndefined()
  await click(band, 'wrap-up-go')

  expect(w.calls).toEqual(['fork', 'run:clear', 'fill'])
  expect(w.forks[0]).not.toContain('Carry over only')
  await band.unmount()
})

test('while Claude works the pill stays muted and a click explains in a card', async ($, on) => {
  const w = world(on, answered)
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.turn.start({ turnId: 't1' } as never)
  const band = await $.ui.mount(BAND(true))
  expect(await label(band, 'wrap-up-entry')).toContain(THEME.muted)
  await click(band, 'wrap-up-entry')

  expect(w.toasts).toEqual([])
  expect(await band.find({ type: 'Text', text: 'Claude is working, Wrap up is available once it is idle' })).toBeDefined()
  expect(await label(band, 'wrap-up-entry')).not.toContain(' Handoff ')
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('a refused /clear falls back to /clear in the composer and keeps the handoff waiting', async ($, on) => {
  const w = world(on, answered, () => {
    throw new Error('unknown command')
  })
  const band = await $.ui.mount(BAND())
  await handOff(band)

  expect(w.filled).toEqual(['/clear'])
  expect(await band.find({ type: 'Text', text: /^Could not run \/clear/ })).toBeDefined()

  // The person runs /clear: session.end carries the waiting handoff over.
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  await w.clock.advance(400)
  expect(w.filled).toEqual(['/clear', 'Goal: ship it.'])
  await band.unmount()
})

test('the typed command opens the card, in Compact mode with `compact`', async ($, on) => {
  const w = world(on, answered)
  const done = await $.command.run({ command: 'mod-wrap-up', args: 'compact' })
  expect(done.text).toBe('Pick what carries over above the prompt')
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain(THEME.lifted)
  expect(await label(band, 'wrap-up-go')).toContain(' Fill prompt ')
  // Fill prompt and Cancel are pills on surface3, the go led by its glyph as a subpill; Threads and Also keep are bordered boxes with their headings.
  expect(await label(band, 'wrap-up-go')).toContain('" ↵ "')
  expect(await label(band, 'wrap-up-go')).toContain(THEME.surface3)
  expect(await label(band, 'wrap-up-go')).not.toContain(THEME.lifted)
  expect(await label(band, 'wrap-up-cancel')).toContain(THEME.surface3)
  expect(await band.find({ type: 'Text', text: 'Threads' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'Also keep' })).toBeDefined()
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('on auto the saved icons draw while the font is read beside session.start, which never waits on it', async ($, on) => {
  const saved: Record<string, unknown> = { 'look-nerd': true }
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  mock.env(on, { WT_SESSION: '1', LOCALAPPDATA: 'C:/L' })
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  on('fs.read', async () => {
    await gate
    return { value: '{ "font": { "face": "Cascadia Mono" } }' }
  })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">idle</Text>
  })
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-wrap-up' } }))
  on('ui.panes', () => ({ value: [] }))
  on('state.set', () => ({ value: undefined }))

  // The font read is still held here, so a session.start that waited on it would never return.
  await $.session.start({ cwd: '/w' } as never)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain(CAPS.left)

  release()
  for (let tries = 0; tries < 50 && saved['look-nerd'] !== false; tries++) await new Promise(resolve => setTimeout(resolve, 5))
  expect(saved['look-nerd']).toBe(false)
  expect(await label(band, 'wrap-up-entry')).not.toContain(CAPS.left)
  await band.unmount()
})

test('icons=nerd keeps the Wrap up labels plain, with no icon', { options: { icons: 'nerd' } }, async ($, on) => {
  world(on, answered)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain('" Wrap up "')
  await click(band, 'wrap-up-entry')
  expect(await label(band, 'wrap-up-entry')).toContain(' Handoff ')
  // The right cap is the pill's last cell: cap, ` Wrap up `, two options of 11 cells, so x 32. The options stay open on it.
  await band.pointer({ type: 'move', x: 32, y: 0, in: 'wrap-up-entry' } as never)
  expect(await label(band, 'wrap-up-entry')).toContain(' Handoff ')
  expect(await label(band, 'wrap-up-entry')).toContain(CAPS.right)
  // The card's blocks lead their headings with an icon subpill; its go leads with the go glyph as one.
  await choose(band, 'handoff', 'nerd')
  expect(await band.find({ type: 'Text', text: String.fromCodePoint(0xf005) })).toBeDefined()
  expect(await band.find({ type: 'Text', text: String.fromCodePoint(0xf075) })).toBeDefined()
  expect(await label(band, 'wrap-up-go')).toContain(`"${String.fromCodePoint(0xf054)}"`)
  await band.unmount()
})

test('icons=safe draws plain labels', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'wrap-up-entry')).toContain('" Wrap up "')
  await click(band, 'wrap-up-entry')
  expect(await label(band, 'wrap-up-entry')).toContain(' Handoff ')
  await band.unmount()
})

test('max_words reaches the fork prompt', { options: { max_words: 250 } }, async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  await handOff(band)
  expect(w.forks[0]).toContain('The cap for this run is 250 words')
  await band.unmount()
})

test('the settings pane draws its title, status line and settings', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  on('config.list', () => ({ value: [{ key: 'mod-wrap-up.max_words', label: 'Handoff length', value: 400, kind: 'number', description: 'cap' }] }))
  const pane = await $.ui.mount({
    plugin: 'mod-wrap-up',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'wrap-up',
    props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 80 },
  } as never)
  expect(JSON.stringify(await pane.drawn({ in: 'mod-wrap-up-settings-tab' }))).toContain('Wrap up · Settings')
  expect(await pane.find({ type: 'Text', text: /Click a setting to change it/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Handoff length' })).toBeDefined()
  await pane.unmount()
})

test('a hovered pill part and card control show their tip in the tip row, and clear on leave', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  const band = await $.ui.mount(BAND())
  // The idle head does nothing when clicked, so its tip says what the pill offers.
  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-entry' } as never)
  expect(await band.find({ type: 'Text', text: ' offers to hand off to a fresh session, or compact this one' })).toBeDefined()
  await band.pointer({ type: 'move', x: OPTION_X.safe.compact, y: 0, in: 'wrap-up-entry' } as never)
  expect(await band.find({ type: 'Text', text: ' opens the pick card to fill a /compact' })).toBeDefined()
  await band.pointer({ type: 'leave', x: 0, y: 0, in: 'wrap-up-entry' } as never)
  expect(await band.find({ type: 'Text', text: ' opens the pick card to fill a /compact' })).toBeUndefined()
  // A control of the card names itself the same way.
  await click(band, 'wrap-up-entry')
  await choose(band, 'handoff')
  await band.pointer({ type: 'move', x: 1, y: 0, in: 'wrap-up-go' } as never)
  expect(await band.find({ type: 'Text', text: ' writes the handoff and starts a fresh session' })).toBeDefined()
  await band.pointer({ type: 'leave', x: 0, y: 0, in: 'wrap-up-go' } as never)
  expect(await band.find({ type: 'Text', text: ' writes the handoff and starts a fresh session' })).toBeUndefined()
  await band.unmount()
})

test('the settings pane footer shows the tip of the hovered tab', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  on('config.list', () => ({ value: [] }))
  const pane = await $.ui.mount({ plugin: 'mod-wrap-up', surface: 'terminal', component: 'Pane', requestId: 'wrap-up', props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 80 } } as never)
  await pane.pointer({ in: 'mod-wrap-up-settings-tab', type: 'move', x: 1, y: 0 })
  expect(await pane.find({ type: 'Text', text: " · shows this mod's settings" })).toBeDefined()
  await pane.pointer({ in: 'mod-wrap-up-settings-tab', type: 'leave', x: 0, y: 0 })
  expect(await pane.find({ type: 'Text', text: " · shows this mod's settings" })).toBeUndefined()
  await pane.unmount()
})
