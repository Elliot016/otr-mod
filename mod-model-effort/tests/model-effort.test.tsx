// mod-model-effort / tests/model-effort.test.tsx, by v-amorim
// Tests the footer meter: effort saving, model switching, icon modes, settings pane and tips.
import { expect, mock, test } from 'claude-code/testing'
import { THEME } from '../hooks/theme'

import { displayName, withEffort } from '../hooks/levels'

// The host's test types omit `pointer` and a drawn element's `children`.
const pointer = (ui: object, event: object) => (ui as { pointer: (event: object) => Promise<void> }).pointer(event)
const children = (element: object) => (element as { children: unknown[] }).children

const SETTINGS = { env: { KEEP: '1' }, modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium', other: 1 } }, model: 'x' }

test('withEffort edits only the model effort and refuses broken JSON', () => {
  const out = JSON.parse(withEffort(JSON.stringify(SETTINGS, null, 2), 'claude-opus-5-5', 'max')!)
  expect(out.modelSettings['claude-opus-5-5']).toEqual({ effortLevel: 'max', other: 1 })
  expect(out.env).toEqual(SETTINGS.env)
  expect(out.model).toBe('x')

  const fresh = JSON.parse(withEffort('{\n  "model": "x"\n}', 'claude-sonnet-5-5', 'low')!)
  expect(fresh.modelSettings).toEqual({ 'claude-sonnet-5-5': { effortLevel: 'low' } })
  expect(withEffort('{ broken', 'm', 'low')).toBeNull()
})

test('the footer meter follows each request and a click saves that level', async ($, on) => {
  const files: Record<string, string> = { '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n' }
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.read', (_$, e) => ({ value: files[neutral(e.path)] ?? '' }))
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const clock = mock.clock(on)
  on('turn.step', async function* ($$, e) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>auto mode</Text>
  })

  // A step streams: the hook runs only while the stream is read.
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 } as never)
  while ((await stream.next()).done !== true);

  const ui = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  expect(await ui.find({ type: 'Text', text: 'auto mode' })).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain('◐ ')
  expect(drawn).toContain(' Opus 5.5 ')
  expect(drawn).not.toContain('medium')
  // At rest only the current level shows.
  expect(children(await ui.drawn({ in: 'meter' })).filter(Boolean)).toHaveLength(2)

  // The pointer opens every level; hovering the fourth previews it: every glyph up to it lit, the hovered one bold, the fifth still dark.
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'move', x: 16, y: 0 })
  const glyphs = children(await ui.drawn({ in: 'meter' })).slice(1) as { props: { color: string; bold?: boolean } }[]
  expect(glyphs.slice(0, 4).every(glyph => glyph.props.color !== THEME.border)).toBe(true)
  expect(glyphs[4]!.props.color).toBe(THEME.border)
  expect(glyphs[3]!.props.bold).toBe(true)
  // The hovered level names itself beside the pill, as a click does.
  expect(await ui.find({ type: 'Text', text: 'xhigh' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Effort:', bold: true } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' sets effort to xhigh' })).toBeDefined()
  await pointer(ui, { in: 'meter', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: 'Effort:' })).toBeUndefined()
  expect(children(await ui.drawn({ in: 'meter' })).filter(Boolean)).toHaveLength(2)

  // ' Opus 5.5 ' (10 cells) comes first; once open, the fifth glyph sits at x 18.
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  expect(JSON.parse(files['/h/.claude/settings.json']!).modelSettings['claude-opus-5-5'].effortLevel).toBe('max')
  expect(files['/h/.claude/settings.json.mod-model-effort.bak']).toContain('"medium"')
  // The level word shows on a click, then leaves. The pointer leaves too, so the tip naming the level is gone.
  expect(await ui.find({ type: 'Text', text: 'max' })).toBeDefined()
  await pointer(ui, { in: 'meter', type: 'leave', x: 0, y: 0 })
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: 'max' })).toBeUndefined()
  await ui.unmount()
})

test('a click on the model name lists the models used before, and a pick switches through /model', async ($, on) => {
  const ran: string[] = []
  const store: Record<string, unknown> = { models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-newmodel-6-0'] }
  on('env.get', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.run', (_$, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  const ui = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as never)
  expect(await ui.find({ key: 'effort-model-all' })).toBeUndefined()

  // The × closes the menu without switching.
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  await pointer(ui, { in: 'effort-model-close', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ key: 'effort-model-all' })).toBeUndefined()
  expect(ran).toEqual([])

  // The current model leads, then the others in the order they were used; a model never seen before still shows.
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  // Each entry is a pill: the current one on surface3 with a green ✓ subpill, the others on surface2 with a blank as wide, so names line up.
  const current = JSON.stringify(await ui.drawn({ in: 'effort-model-0' }))
  expect(current).toContain('" ✓ "')
  expect(current).toContain('#49EF95')
  expect(current).toContain('" Opus 5.5 "')
  expect(current).toContain('#252A42')
  const other = JSON.stringify(await ui.drawn({ in: 'effort-model-1' }))
  expect(other).toContain('"    Sonnet 5.5 "')
  expect(other).toContain('#1C2033')
  expect(JSON.stringify(await ui.drawn({ in: 'effort-model-2' }))).toContain('Newmodel 6.0')
  const all = JSON.stringify(await ui.drawn({ in: 'effort-model-all' }))
  expect(all).toContain('" ↵ "')
  expect(all).toContain('" All models… "')
  expect(await ui.find({ key: 'effort-model-0-pill-body' })).toBeDefined()

  await pointer(ui, { in: 'effort-model-1', type: 'down', button: 'left', x: 1, y: 0 })
  expect(ran).toEqual(['model claude-sonnet-5-5'])
  expect(await ui.find({ key: 'effort-model-all' })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Sonnet 5.5 ')
  expect(store.models).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-newmodel-6-0'])

  // All models opens Claude Code's own picker.
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  await pointer(ui, { in: 'effort-model-all', type: 'down', button: 'left', x: 1, y: 0 })
  expect(ran).toEqual(['model claude-sonnet-5-5', 'model '])
  await ui.unmount()
})

test('displayName reads like the oh-my-posh pill', () => {
  expect(displayName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(displayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(displayName('Opus 5.5')).toBe('Opus 5.5')
})

test('a clicked level rides on each request until Alt+P saves another', async ($, on) => {
  const files: Record<string, string> = { '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n' }
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const sent: string[] = []
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.read', (_$, e) => ({ value: files[neutral(e.path)] ?? '' }))
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('settings.read', () => ({ value: JSON.parse(files['/h/.claude/settings.json']!) }))
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  mock.clock(on)
  on('turn.step', async function* ($$, e) {
    sent.push(String(e.effort))
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  const step = async (index: number) => {
    const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 } as never)
    while ((await stream.next()).done !== true);
  }

  await step(0)
  const ui = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  await step(1)

  // Alt+P saves high; Claude Code's own level takes over again.
  const saved = JSON.parse(files['/h/.claude/settings.json']!)
  saved.modelSettings['claude-opus-5-5'].effortLevel = 'high'
  files['/h/.claude/settings.json'] = JSON.stringify(saved)
  await step(2)
  expect(sent).toEqual(['medium', 'max', 'medium'])
  await ui.unmount()
})

const BAND = { plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never
const CAP = String.fromCodePoint(0xe0b6)

function band(on: (name: string, handler: (...args: any[]) => unknown) => void, model: () => string = () => 'claude-opus-5-5') {
  on('env.get', () => ({ value: undefined }))
  on('session.model', () => ({ value: model() }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
}

test('icons=nerd draws the pill with rounded caps', { options: { icons: 'nerd' } }, async ($, on) => {
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  const ui = await $.ui.mount(BAND)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(CAP)
  // The model menu's subpills take the Nerd ✓ and go glyphs, bare and capped.
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 2, y: 0 })
  const current = JSON.stringify(await ui.drawn({ in: 'effort-model-0' }))
  expect(current).toContain(`"${String.fromCodePoint(0xeab2)}"`)
  expect(current).toContain(CAP)
  expect(JSON.stringify(await ui.drawn({ in: 'effort-model-all' }))).toContain(`"${String.fromCodePoint(0xf054)}"`)
  await ui.unmount()
})

test('icons=safe draws the pill without rounded caps', { options: { icons: 'safe' } }, async ($, on) => {
  band(on as never)
  const ui = await $.ui.mount(BAND)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).not.toContain(CAP)
  await ui.unmount()
})

test('/mod-model-effort settings opens the pane and the pane draws a setting row', { options: { icons: 'safe' } }, async ($, on) => {
  const opened: string[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('state.set', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [{ key: 'mod-model-effort.animations', label: 'Animations', value: true, kind: 'boolean', description: 'Entries shimmer' }] as never }))
  await $.command.run({ command: 'mod-model-effort', args: 'settings' } as never)
  expect(opened).toEqual(['model-effort-settings'])

  const pane = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'Pane', requestId: 'model-effort-settings', props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 80 } } as never)
  expect(JSON.stringify(await pane.drawn({ in: 'mod-model-effort-settings-tab' }))).toContain('Effort · Settings')
  expect(await pane.find({ type: 'Text', text: 'Animations' })).toBeDefined()
  await pane.unmount()
})

const NARROW = { plugin: 'mod-model-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as never

test('a hovered control names itself in the tip row, a model menu entry and the model pill alike', { options: { icons: 'safe' } }, async ($, on) => {
  band(on as never)
  on('store.get', () => ({ value: undefined }))
  const ui = await $.ui.mount(NARROW)
  await pointer(ui, { in: 'meter', type: 'move', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' switches the model' })).toBeDefined()
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 0, y: 0 })
  await pointer(ui, { in: 'effort-model-all', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' opens the full model picker' })).toBeDefined()
  await pointer(ui, { in: 'effort-model-all', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' opens the full model picker' })).toBeUndefined()
  await ui.unmount()
})

test('the settings pane footer shows the tip of the hovered tab', { options: { icons: 'safe' } }, async ($, on) => {
  on('config.list', () => ({ value: [] }))
  const pane = await $.ui.mount({ plugin: 'mod-model-effort', surface: 'terminal', component: 'Pane', requestId: 'model-effort-settings', props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 80 } } as never)
  await pointer(pane, { in: 'mod-model-effort-settings-tab', type: 'move', x: 1, y: 0 })
  expect(await pane.find({ type: 'Text', text: " · shows this mod's settings" })).toBeDefined()
  await pointer(pane, { in: 'mod-model-effort-settings-tab', type: 'leave', x: 0, y: 0 })
  expect(await pane.find({ type: 'Text', text: " · shows this mod's settings" })).toBeUndefined()
  await pane.unmount()
})

// What Claude Code passes its classic PostModelSwitch hook when /model or the picker moves to `to`.
const switched = (to: string) => ({ from_model: 'claude-opus-5-5', to_model: to, requested_model: to, source: 'command', context_tokens: 0, prompt_cache_warm: false, cache_ttl: '5m', estimated_cache_write_usd: 0, pricing: 'catalog' }) as never

// One request on a model and level, which leaves the pill on them as a first request does. It registers its own turn.step, so the other stubs go first.
async function firstRequest($: any, on: any, model: string, effort: string) {
  on('turn.step', async function* ($$: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model, effort, messageCount: 1 } as never)
  while ((await stream.next()).done !== true);
}

test('a model switch through /model or the picker shows on the pill at once, at the level saved for that model', { options: { icons: 'safe' } }, async ($, on) => {
  const store: Record<string, unknown> = {}
  band(on as never)
  on('settings.read', () => ({ value: { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' }, 'claude-sonnet-5-5': { effortLevel: 'low' } } } }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('classic.PostModelSwitch', () => ({}) as never)
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  const ui = await $.ui.mount(BAND)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')

  await $.classic.PostModelSwitch(switched('claude-sonnet-5-5'))
  await ui.redraw()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain(' Sonnet 5.5 ')
  expect(drawn).toContain('○ ')
  expect(drawn).not.toContain('◐ ')
  expect(store.model).toBe('claude-sonnet-5-5')
  await ui.unmount()
})

test("without PostModelSwitch, a redraw follows the session's model at the level saved for it, and ignores a name it cannot display", { options: { icons: 'safe' } }, async ($, on) => {
  const store: Record<string, unknown> = {}
  let live = 'claude-opus-5-5'
  const clock = mock.clock(on)
  band(on as never, () => live)
  on('settings.read', () => ({ value: { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' }, 'claude-sonnet-5-5': { effortLevel: 'low' } } } }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  const ui = await $.ui.mount(BAND)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')

  live = 'sonnet'
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain(' Opus 5.5 ')

  live = 'claude-sonnet-5-5'
  await ui.redraw()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain(' Sonnet 5.5 ')
  expect(drawn).toContain('○ ')

  await clock.advance(1)
  expect(store.model).toBe('claude-sonnet-5-5')
  await ui.unmount()
})

test('without ConfigChange, a redraw picks up a level changed in the settings, and leaves a level a request downgraded alone', { options: { icons: 'safe' } }, async ($, on) => {
  const settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }
  const clock = mock.clock(on)
  band(on as never)
  on('settings.read', () => ({ value: settings }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  await firstRequest($, on, 'claude-opus-5-5', 'low')
  const ui = await $.ui.mount(BAND)
  await clock.advance(250)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('○ ')

  await ui.redraw()
  await clock.advance(250)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('○ ')

  settings.modelSettings['claude-opus-5-5'].effortLevel = 'high'
  await ui.redraw()
  await clock.advance(250)
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('● ')
  await ui.unmount()
})

test('an effort saved by Alt+P or /effort shows on the pill at once; a project settings change does not', { options: { icons: 'safe' } }, async ($, on) => {
  const settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }
  band(on as never)
  on('settings.read', () => ({ value: settings }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('classic.ConfigChange', () => ({}) as never)
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  const ui = await $.ui.mount(BAND)
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('◐ ')

  settings.modelSettings['claude-opus-5-5'].effortLevel = 'high'
  await $.classic.ConfigChange({ source: 'user_settings', file_path: '/h/.claude/settings.json' } as never)
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('● ')

  settings.modelSettings['claude-opus-5-5'].effortLevel = 'low'
  await $.classic.ConfigChange({ source: 'project_settings', file_path: '/w/.claude/settings.json' } as never)
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('● ')
  await ui.unmount()
})

test('a clicked level holds on the pill while the saved level is the one before it, and yields to any other', { options: { icons: 'safe' } }, async ($, on) => {
  const files: Record<string, string> = { '/h/.claude/settings.json': JSON.stringify({ modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }) }
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const saveLevel = (effort: string) => {
    files['/h/.claude/settings.json'] = JSON.stringify({ modelSettings: { 'claude-opus-5-5': { effortLevel: effort } } })
  }
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.read', (_$, e) => ({ value: files[neutral(e.path)] ?? '' }))
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('settings.read', () => ({ value: JSON.parse(files['/h/.claude/settings.json']!) }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('classic.ConfigChange', () => ({}) as never)
  mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  const ui = await $.ui.mount(BAND)
  await pointer(ui, { in: 'meter', type: 'move', x: 1, y: 0 })
  await pointer(ui, { in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  await pointer(ui, { in: 'meter', type: 'leave', x: 0, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('◈ ')

  // Alt+P saves medium, the level before the click: the clicked max still rides on the requests.
  saveLevel('medium')
  await $.classic.ConfigChange({ source: 'user_settings' } as never)
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn({ in: 'meter' }))).toContain('◈ ')

  // Alt+P saves high, another level: the pill shows it and the clicked level is dropped.
  saveLevel('high')
  await $.classic.ConfigChange({ source: 'user_settings' } as never)
  await ui.redraw()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain('● ')
  expect(drawn).not.toContain('◈ ')
  await ui.unmount()
})

test('a settings read that fails leaves the model switch whole', { options: { icons: 'safe' } }, async ($, on) => {
  const passed: string[] = []
  on('settings.read', () => {
    throw new Error('unreadable')
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('classic.PostModelSwitch', (_$, e) => {
    passed.push(e.to_model)
    return {} as never
  })
  await firstRequest($, on, 'claude-opus-5-5', 'medium')
  await $.classic.PostModelSwitch(switched('claude-sonnet-5-5'))
  expect(passed).toEqual(['claude-sonnet-5-5'])
})
