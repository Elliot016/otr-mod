import { expect, mock, test } from 'claude-code/testing'

import { buildPrompt, clampWords, isFresh, parseThreads, pickedThreads, scopeNote, skillBody } from '../hooks/handoff'
import { THEME } from '../hooks/theme'

const SKILL = '---\nname: session-handoff\ndescription: x\n---\n\n# session-handoff\n\nWrite one message.'
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = (isWorking = false) =>
  ({
    plugin: 'mod-handoff',
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

// The pill asks first: one click on the entry, one on Yes.
async function confirmYes(band: Band) {
  await click(band, 'handoff-entry')
  await click(band, 'handoff-yes')
}

test('the prompt is the skill body with the cap, and bad caps fall back', () => {
  expect(skillBody(SKILL)).toBe('# session-handoff\n\nWrite one message.')
  expect(buildPrompt(SKILL, 250)).toContain('The cap for this run is 250 words')
  expect(buildPrompt(SKILL, 250)).not.toContain('description: x')
  expect([clampWords(undefined), clampWords(5), clampWords(99999), clampWords(300)]).toEqual([400, 100, 2000, 300])
  expect(isFresh({ text: 'a', at: 0 }, 1000)).toBe(true)
  expect(isFresh({ text: 'a', at: 0 }, 999999)).toBe(false)
})

test('the idle pill reads Handoff and a click asks Clear & continue? with Yes and No', async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'handoff-entry')).toContain(' Handoff ')
  expect(await band.find({ key: 'handoff-yes' })).toBeUndefined()

  await click(band, 'handoff-entry')
  expect(await band.find({ type: 'Text', text: 'Clear & continue?' })).toBeDefined()
  expect(await label(band, 'handoff-yes')).toContain(' Yes ')
  expect(await label(band, 'handoff-no')).toContain(' No ')
  expect(await band.find({ key: 'handoff-entry' })).toBeUndefined()
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('No cancels the confirm and runs nothing', async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  await click(band, 'handoff-entry')
  await click(band, 'handoff-no')

  expect(await band.find({ key: 'handoff-entry' })).toBeDefined()
  expect(await band.find({ key: 'handoff-yes' })).toBeUndefined()
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('the confirm falls back to idle after five seconds', async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  await click(band, 'handoff-entry')
  await w.clock.advance(4000)
  expect(await band.find({ key: 'handoff-yes' })).toBeDefined()

  await w.clock.advance(1500)
  expect(await band.find({ key: 'handoff-yes' })).toBeUndefined()
  expect(await band.find({ key: 'handoff-entry' })).toBeDefined()
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('Yes forks, clears, then fills the handoff without sending it', async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  await confirmYes(band)

  expect(w.calls).toEqual(['fork', 'run:clear', 'fill'])
  expect(w.forks[0]).toContain('The cap for this run is 400 words')
  expect(w.forks[0]).toContain('Write one message.')
  expect(w.filled).toEqual(['Goal: ship it.'])
  expect(await band.find({ key: 'handoff-entry' })).toBeDefined()
  await band.unmount()
})

test('an empty session stops before the clear and says why in a card, not the pill row', async ($, on) => {
  const w = world(on, { isAnswered: false, reason: 'nothing-to-fork' })
  const band = await $.ui.mount(BAND())
  await confirmYes(band)

  expect(w.calls).toEqual(['fork'])
  expect(w.toasts).toEqual([])
  expect(await band.find({ type: 'Text', text: 'Nothing to hand off yet, send a message first' })).toBeDefined()
  await w.clock.advance(4000)
  expect(await band.find({ type: 'Text', text: /hand off yet/ })).toBeUndefined()
  expect(await band.find({ key: 'handoff-entry' })).toBeDefined()
  await band.unmount()
})

test('a resumed session with nothing to fork summarizes the transcript instead', async ($, on) => {
  const resumed = [
    { role: 'user', text: 'fix the build', toolUses: [] },
    { role: 'assistant', text: 'Looking.', toolUses: [{ tool_use_id: 't', tool: 'Bash', input: { command: 'npm   run build' } }] },
  ]
  const w = world(on, { isAnswered: false, reason: 'nothing-to-fork' }, undefined, resumed)
  const band = await $.ui.mount(BAND())
  await confirmYes(band)

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

test('the picked threads become the handoff scope: kept, left out, and what was typed in Other', () => {
  const threads = parseThreads(THREADS.text)
  // A label is a dialog option, and the answer comes back comma-joined, so labels lose their commas.
  expect(threads.map(thread => thread.label)).toEqual(['Build fix', 'Docs rewrite', 'Deploy'])
  expect(parseThreads('{"threads":[{"label":"Only one","detail":"x"}]}')).toEqual([])
  expect(parseThreads('not json')).toEqual([])

  const { kept, note } = pickedThreads('Build fix, Deploy, also the CI flake', threads)
  expect(kept.map(thread => thread.label)).toEqual(['Build fix', 'Deploy'])
  expect(note).toBe('also the CI flake')
  const scope = scopeNote(threads, kept, note)
  expect(scope).toContain('Carry over only these threads of the session:\n- Build fix: The failing build and its cause.\n- Deploy: The deploy plan for Friday.')
  expect(scope).toContain('Leave out everything about:\n- Docs rewrite: The README rewrite.')
  expect(scope).toContain('The person also asked for: also the CI flake')
  expect(scopeNote(threads, threads, '')).toBe('')
})

test('dismissing the picker cancels: nothing is written or cleared', async ($, on) => {
  const w = world(on, answered, undefined, SESSION, THREADS)
  const band = await $.ui.mount(BAND())
  await confirmYes(band)

  expect(w.calls).toEqual(['threads'])
  expect(await band.find({ type: 'Text', text: 'Handoff cancelled, nothing was cleared' })).toBeDefined()
  await band.unmount()
})

test('pick_threads off keeps everything without asking', { options: { pick_threads: false } }, async ($, on) => {
  const w = world(on, answered, undefined, SESSION, THREADS)
  const band = await $.ui.mount(BAND())
  await confirmYes(band)

  expect(w.calls).toEqual(['fork', 'run:clear', 'fill'])
  expect(w.forks[0]).not.toContain('Carry over only')
  await band.unmount()
})

test('while Claude works the pill stays muted and a click explains in a card', async ($, on) => {
  const w = world(on, answered)
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await $.turn.start({ turnId: 't1' } as never)
  const band = await $.ui.mount(BAND(true))
  expect(await label(band, 'handoff-entry')).toContain(THEME.muted)
  await click(band, 'handoff-entry')

  expect(w.toasts).toEqual([])
  expect(await band.find({ type: 'Text', text: 'Claude is working, Handoff is available once it is idle' })).toBeDefined()
  expect(await band.find({ key: 'handoff-yes' })).toBeUndefined()
  expect(w.calls).toEqual([])
  await band.unmount()
})

test('a refused /clear falls back to /clear in the composer and keeps the handoff waiting', async ($, on) => {
  const w = world(on, answered, () => {
    throw new Error('unknown command')
  })
  const band = await $.ui.mount(BAND())
  await confirmYes(band)

  expect(w.filled).toEqual(['/clear'])
  expect(await band.find({ type: 'Text', text: /^Could not run \/clear/ })).toBeDefined()

  // The person runs /clear: session.end carries the waiting handoff over.
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  await w.clock.advance(400)
  expect(w.filled).toEqual(['/clear', 'Goal: ship it.'])
  await band.unmount()
})

test('the typed command skips the confirm', async ($, on) => {
  const w = world(on, answered)
  const done = await $.command.run({ command: 'mod-handoff', args: '' })
  expect(done.text).toContain('Writing the handoff')
  await w.clock.advance(10)
  expect(w.calls).toEqual(['fork', 'run:clear', 'fill'])
})

test('icons=nerd keeps the Handoff labels plain, with no icon', { options: { icons: 'nerd' } }, async ($, on) => {
  world(on, answered)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'handoff-entry')).toContain('" Handoff "')
  await click(band, 'handoff-entry')
  expect(await band.find({ type: 'Text', text: 'Clear & continue?' })).toBeDefined()
  await band.unmount()
})

test('icons=safe draws plain labels', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  const band = await $.ui.mount(BAND())
  expect(await label(band, 'handoff-entry')).toContain('" Handoff "')
  await click(band, 'handoff-entry')
  expect(await band.find({ type: 'Text', text: 'Clear & continue?' })).toBeDefined()
  await band.unmount()
})

test('max_words reaches the fork prompt', { options: { max_words: 250 } }, async ($, on) => {
  const w = world(on, answered)
  const band = await $.ui.mount(BAND())
  await confirmYes(band)
  expect(w.forks[0]).toContain('The cap for this run is 250 words')
  await band.unmount()
})

test('the settings pane draws its title, status line and settings', { options: { icons: 'safe' } }, async ($, on) => {
  world(on, answered)
  on('config.list', () => ({ value: [{ key: 'mod-handoff.max_words', label: 'Handoff length', value: 400, kind: 'number', description: 'cap' }] }))
  const pane = await $.ui.mount({
    plugin: 'mod-handoff',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'handoff',
    props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 80 },
  } as never)
  expect(JSON.stringify(await pane.drawn({ in: 'mod-handoff-settings-tab' }))).toContain('Handoff · Settings')
  expect(await pane.find({ type: 'Text', text: /Click a control to change it/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Handoff length' })).toBeDefined()
  await pane.unmount()
})
