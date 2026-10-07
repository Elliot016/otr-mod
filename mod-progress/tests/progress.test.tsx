import { expect, test } from 'claude-code/testing'

import { applyStep, applyTask, bandSummary, buildRows, emptySnap, formatElapsed, formatTokens, gatesOf, gaugeColor, windowFor, isGatesPath, modelInfo, parseGates, settle, type Snap } from '../hooks/progress'

const GATES = [
  '# Gates: leaf',
  '',
  '- [x] G1: renders end to end',
  '      EVIDENCE: ok 12 passed',
  '',
  '- [x] G2: checked but pending',
  '      EVIDENCE: pending',
  '',
  '- [ ] G3: still open',
  '      EVIDENCE: pending',
  '',
  '- [ ] G4: given up',
  'ABANDON: G4 not possible',
].join('\n')

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

type On =Parameters<Parameters<typeof test>[1]>[1]

const AGENT = { id: 'a1', name: 'leaf-1.1.1', description: 'Build the leaf', type: 'general-purpose', status: 'running' }

const seeded = (): Snap => {
  const snap = emptySnap('sid-1')
  snap.busy = true
  snap.startedAt = 0
  snap.main = { model: 'claude-opus-5-5', effort: 'xhigh', tokens: 312000, context: 92000 }
  snap.agents.a1 = { model: 'claude-haiku-4-5-20251001', tokens: 46800, context: 24000, spawnedAt: 1000 }
  snap.gates.GATES = parseGates(GATES)
  snap.gates['leaf-1.1.1'] = parseGates(GATES).slice(0, 2)
  return snap
}

// Everything the mod reads from the engine, with the store backed by a map.
function stubEngine(on: On, agents: unknown[] = [AGENT], opened: string[] = []) {
  const store = new Map<string, unknown>([['snap', seeded()]])
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 46, tokens: 92000 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: agents }) as never)
  on('clock.now', () => ({ value: 14 * 60 * 1000 }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (path === '/w/GATES.md') return { value: GATES }
    if (path === '/w/gates/leaf-1.1.1.md') return { value: GATES.split('\n').slice(0, 7).join('\n') }
    throw new Error('ENOENT')
  })
  on('fs.list', (_$, e) => ({ value: neutral(e.path).endsWith('/gates') ? [{ name: 'leaf-1.1.1.md', kind: 'file', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('env.get', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-progress' } }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('state.set', () => ({ value: undefined }))
  return store
}

const PANE = { plugin: 'mod-progress', surface: 'terminal', component: 'Pane', requestId: 'progress', props: { title: 'Progress', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never
const BAND = { plugin: 'mod-progress', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never

test('gates: met needs a checked box with real evidence, ABANDON gives one up', () => {
  const gates = parseGates(GATES)
  expect(gates.map(gate => [gate.id, gate.state])).toEqual([['G1', 'met'], ['G2', 'open'], ['G3', 'open'], ['G4', 'abandoned']])
  expect(gates[0]!.text).toBe('renders end to end')
  expect(isGatesPath('C:\\w\\gates\\leaf-1.md')).toBe(true)
  expect(isGatesPath('/w/GATES.md')).toBe(true)
  expect(isGatesPath('/w/src/gates.ts')).toBe(false)
})

test('an agent pairs with its gates file by name, or by the first word of its description', () => {
  const one = parseGates('- [ ] G1 one\n  EVIDENCE: pending\n')
  const snap = { gates: { 'leaf-1.1.1': one } }
  expect(gatesOf(snap, { name: 'leaf-1.1.1', description: 'anything' })).toBe(one)
  expect(gatesOf(snap, { description: 'leaf-1.1.1: check the cart totals' })).toBe(one)
  expect(gatesOf(snap, { description: 'leaf-1.1.1 check the cart totals' })).toBe(one)
  expect(gatesOf(snap, { description: 'Check the cart totals' })).toBeUndefined()
})

test('a subagent window: the main one for the same model, 1M once its context passes 200k or the main session runs 1M', () => {
  expect(windowFor('opus', 'opus', 1000000)).toBe(1000000)
  expect(windowFor('sonnet', 'opus', 200000, 150000)).toBe(200000)
  expect(windowFor('sonnet', 'opus', 200000, 250000)).toBe(1000000)
  expect(windowFor('sonnet', 'opus', 1000000, 50000)).toBe(1000000)
  expect(windowFor('sonnet[1m]', 'opus', 200000)).toBe(1000000)
})

test('figures: model names, context colors, tokens and time', () => {
  expect(modelInfo('claude-opus-5-5').name).toBe('Opus 5.5')
  expect(modelInfo('claude-haiku-4-5-20251001').name).toBe('Haiku 4.5')
  expect(modelInfo('claude-opus-4-20250514').name).toBe('Opus 4')
  expect(modelInfo('sonnet').name).toBe('Sonnet')
  expect(modelInfo('gpt-x').family).toBe('inherit')
  expect(modelInfo('claude-opus-5-5').hue).toBe('#C3A6FF')
  expect([5, 10, 39, 59, 79, 90].map(gaugeColor)).toEqual(['#CED9FF', '#ACB9E6', '#CDBBE5', '#EA98EE', '#F883C9', '#FF6F7A'])
  expect([999, 46800, 312000, 1500000].map(formatTokens)).toEqual(['999', '46.8k', '312k', '1.5M'])
  expect([5000, 14 * 60000, 65 * 60000].map(formatElapsed)).toEqual(['5s', '14m', '1h05m'])
})

test('rows: main first, agents in order, task list stands in for missing gates, band sums every file', () => {
  const snap = emptySnap('s')
  applyStep(snap, undefined, 'claude-opus-5-5', 'high', { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 90 })
  applyStep(snap, 'a1', 'claude-haiku-4-5', undefined, { input_tokens: 1, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 20000 })
  applyTask(snap, 'TaskCreate', { subject: 'step A' }, '1')
  applyTask(snap, 'TaskCreate', { subject: 'step B' }, '2')
  applyTask(snap, 'TaskUpdate', { taskId: '1', status: 'completed' })
  expect(snap.main).toEqual({ model: 'claude-opus-5-5', effort: 'high', tokens: 100, context: 5100 })
  expect(snap.agents.a1).toEqual({ model: 'claude-haiku-4-5', tokens: 7, context: 20001 })

  const list = [{ ...AGENT }, { id: 'a2', description: 'two', type: 'Explore', status: 'failed' }]
  const rows = buildRows(snap, list, { window: 200000, startedAt: 0 }, 60000, 'main', 'this session', undefined)
  expect(rows.map(row => [row.name, row.status])).toEqual([['main', 'done'], ['leaf-1.1.1', 'running'], ['Explore', 'failed']])
  expect(rows[0]!.gates.map(gate => gate.state)).toEqual(['met', 'open'])
  expect(rows[0]!.description).toBe('step B')
  expect(rows[1]!.percent).toBe(10)
  expect(rows[1]!.hasGates).toBe(false)

  snap.gates.GATES = parseGates(GATES)
  snap.gates['leaf-1.1.1'] = parseGates(GATES).slice(0, 1)
  expect(buildRows(snap, list, undefined, 0, 'main', 'x', undefined)[0]!.gates).toHaveLength(4)
  expect(bandSummary(rows)).toEqual({ count: 1, done: 1, total: 2 })

  expect(settle(snap, list, 99)).toBe(true)
  expect(snap.agents.a2!.endedAt).toBe(99)
  expect(snap.agents.a1!.endedAt).toBeUndefined()
})

test('the band pill counts agents in a badge, and a click toggles the pane', async ($, on) => {
  const opened: string[] = []
  stubEngine(on, [AGENT], opened)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  await $.session.start({ cwd: '/w' } as never)
  const band = await $.ui.mount(BAND)
  const pill = JSON.stringify(await band.drawn({ in: 'menu-entry-progress' }))
  expect(pill).toContain('Progress')
  expect(pill).toContain('" 1 "')
  await band.pointer({ in: 'menu-entry-progress', type: 'down', x: 1, y: 0, button: 'left' })
  expect(opened).toEqual(['progress'])
  await band.unmount()
})

test('the pane draws a card per loop and a click opens its gates', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  const list = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(list).toContain('main')
  expect(list).toContain('leaf-1.1.1')
  expect(list).toContain('Opus 5.5')
  expect(list).toContain('Haiku 4.5')
  expect(list).toContain('46%')
  expect(list).toContain('312k')
  expect(list).toContain('1/4')
  expect(list).not.toContain('G1')
  await ui.pointer({ in: 'loops', type: 'down', x: 3, y: 0, button: 'left' })
  const open = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(open).toContain('G1 renders end to end')
  expect(open).toContain('abandoned')
  await ui.pointer({ in: 'loops', type: 'down', x: 3, y: 0, button: 'left' })
  expect(JSON.stringify(await ui.drawn({ in: 'loops' }))).not.toContain('G1')
  await ui.unmount()
})

test('icons=nerd draws the Nerd gauge, spinner and agent icon', { options: { icons: 'nerd' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  const list = JSON.stringify(await ui.drawn({ in: 'loops' }))
  for (const point of [0xf035b, 0xf0c8, 0xf096, 0xf110, 0xe0b6]) expect(list).toContain(String.fromCodePoint(point))
  expect(JSON.stringify(await ui.drawn({ in: 'progress-tab' }))).toContain(String.fromCodePoint(0xebbc))
  await ui.unmount()
})

test('icons=safe draws only plain glyphs', { options: { icons: 'safe' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/w' } as never)
  const ui = await $.ui.mount(PANE)
  const list = JSON.stringify(await ui.drawn({ in: 'loops' }))
  expect(list).toContain('↻')
  expect(list).toContain('▦')
  expect(list).toContain('■')
  expect(list).toContain('□')
  expect(list).not.toContain(String.fromCodePoint(0xf035b))
  expect(list).not.toContain(String.fromCodePoint(0xe0b6))
  await ui.unmount()
})

test('a spawn, a step and a task call update the figures the pane reads', async ($, on) => {
  const store = stubEngine(on, [{ ...AGENT, id: 'zz' }])
  store.set('snap', emptySnap('sid-1'))
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'zz' }) as never)
  on('tool.call', () => ({ result: { task: { id: '1', subject: 's' } } }) as never)
  await $.session.start({ cwd: '/w' } as never)
  await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'd', subagentType: 'general-purpose', provider: { plugin: 'x', tier: 'user' }, parentModel: 'm' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'step A', description: 'x' })
  const saved = store.get('snap') as Snap
  expect(saved.agents.zz?.model).toBe('claude-haiku-4-5')
  expect(saved.tasks).toEqual([{ id: '1', subject: 'step A', status: 'pending' }])
})

test('hovering the band pill shows its tip in the tip row, and a card shows its tip in the pane footer', async ($, on) => {
  stubEngine(on, [AGENT], [])
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  await $.session.start({ cwd: '/w' } as never)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /running, gates|every agent with/ })).toBeUndefined()
  await band.pointer({ in: 'menu-entry-progress', type: 'enter', x: 1, y: 0, button: 'left' })
  expect((await band.find({ type: 'Text', text: /running, gates|every agent with/ }))?.text).toMatch(/^ (\d+ running, gates \d+\/\d+|every agent with its context, tokens and gates)$/)
  expect((await band.find({ type: 'Text', text: /^Progress:$/ }))?.text).toBe('Progress:')
  await band.pointer({ in: 'menu-entry-progress', type: 'leave', x: 1, y: 0, button: 'left' })
  expect(await band.find({ type: 'Text', text: /running, gates|every agent with/ })).toBeUndefined()
  await band.unmount()

  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /shows or hides/ })).toBeUndefined()
  await pane.pointer({ in: 'loops', type: 'move', x: 3, y: 0, button: 'left' })
  expect((await pane.find({ type: 'Text', text: /shows or hides this agent/ }))?.text).toContain("shows or hides this agent's gates")
  await pane.pointer({ in: 'loops', type: 'leave', x: 3, y: 0, button: 'left' })
  expect(await pane.find({ type: 'Text', text: /shows or hides this agent/ })).toBeUndefined()
  await pane.unmount()
})
