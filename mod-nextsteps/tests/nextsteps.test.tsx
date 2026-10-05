import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const DONE = { answer: 'All done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as const

// Stubs everything the mod touches; `reply` is what the forked model answers and `fills` records prompt writes.
function setup(on: any, reply: () => unknown) {
  const clock = mock.clock(on)
  const fills: { text: string; mode?: string }[] = []
  const asked: string[] = []
  let draft = ''
  on('model.fork', async (_$: unknown, e: { prompt: string }) => {
    asked.push(e.prompt)
    return { value: await reply() }
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_$: unknown, e: { text: string; mode?: string }) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', ($: any, e: unknown) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="base">base</Text>
  })
  return { clock, fills, asked, setDraft: (text: string) => (draft = text) }
}

const answered = (text: string) => ({ isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
const mount = ($: any) => $.ui.mount({ plugin: 'mod-nextsteps', surface: 'terminal', ...BAND })
const rowsOf = async (ui: any) => JSON.stringify(await ui.drawn({ in: 'steps-list' }))

test('while the suggestions are being written, a shimmering line says they are coming', async ($, on) => {
  let release = (_: unknown) => {}
  const pending = new Promise(resolve => (release = resolve))
  const { clock } = setup(on, () => pending)
  await $.turn.complete(DONE as never)
  await clock.advance(0)

  const ui = await mount($)
  expect(JSON.stringify(await ui.drawn({ in: 'steps-waiting' }))).toContain('T')
  release(answered('add a test'))
  await clock.settle()
  expect(await ui.find({ key: 'steps-waiting' })).toBeUndefined()
  expect(await rowsOf(ui)).toContain('add a test')
  await ui.unmount()
})

test('suggestions appear after turn.complete, tidied and capped at the count', async ($, on) => {
  const { clock, asked } = setup(on, () => answered('1. add a test\n- run the suite\n"ship it"\nfourth one'))
  const empty = await mount($)
  expect(await empty.find({ key: 'steps-action-0' })).toBeUndefined()
  await empty.unmount()

  await $.turn.complete(DONE as never)
  await clock.settle()
  expect(asked.length).toBe(1)

  const ui = await mount($)
  expect(await ui.find({ key: 'steps-action-2' })).toBeDefined()
  expect(await ui.find({ key: 'steps-action-3' })).toBeUndefined()
  const drawn = await rowsOf(ui)
  expect(drawn).toContain('add a test')
  expect(drawn).toContain('run the suite')
  expect(drawn).toContain('ship it')
  expect(drawn).not.toContain('fourth')
  expect(JSON.stringify(await ui.drawn({ in: 'steps-dismiss' }))).toContain('[×]')
  await ui.unmount()
})

test('count 1 asks for and shows one suggestion', { options: { count: 1 } }, async ($, on) => {
  const { clock } = setup(on, () => answered('first\nsecond'))
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await mount($)
  expect(await ui.find({ key: 'steps-action-0' })).toBeDefined()
  expect(await ui.find({ key: 'steps-action-1' })).toBeUndefined()
  await ui.unmount()
})

test('a click fills the prompt without sending, on the button and on the text', async ($, on) => {
  const { clock, fills, setDraft } = setup(on, () => answered('alpha\nbeta'))
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await mount($)

  await ui.press({ key: 'steps-action-1' })
  expect(fills).toEqual([{ text: 'beta', mode: 'replace' }])

  await ui.pointer({ in: 'steps-list', type: 'down', button: 'left', x: 3, y: 0 })
  expect(fills[1]).toEqual({ text: 'alpha', mode: 'replace' })

  // A draft already in the box is kept: the suggestion is appended.
  setDraft('please')
  await ui.press({ key: 'steps-action-0' })
  expect(fills[2]).toEqual({ text: ' alpha', mode: 'append' })
  await ui.unmount()
})

test('hover lights the row under the pointer', async ($, on) => {
  const { clock } = setup(on, () => answered('alpha\nbeta'))
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await mount($)
  await ui.pointer({ in: 'steps-list', type: 'move', x: 3, y: 1 })
  expect(await rowsOf(ui)).toContain('#7386D0')
  await ui.pointer({ in: 'steps-list', type: 'leave', x: 0, y: 0 })
  expect(await rowsOf(ui)).not.toContain('#7386D0')
  await ui.unmount()
})

test('submitting a prompt, a new turn or the dismiss control clears them', async ($, on) => {
  const { clock } = setup(on, () => answered('alpha\nbeta'))
  const showing = async () => {
    const ui = await mount($)
    const there = (await ui.find({ key: 'steps-action-0' })) !== undefined
    await ui.unmount()
    return there
  }

  await $.turn.complete(DONE as never)
  await clock.settle()
  expect(await showing()).toBe(true)
  await $.prompt.submit({ text: 'go on' } as never)
  expect(await showing()).toBe(false)

  await $.turn.complete(DONE as never)
  await clock.settle()
  expect(await showing()).toBe(true)
  await $.turn.start({ text: 'x', turnId: 't2' } as never)
  expect(await showing()).toBe(false)

  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await mount($)
  await ui.pointer({ in: 'steps-dismiss', type: 'down', button: 'left', x: 1, y: 0 })
  await ui.unmount()
  expect(await showing()).toBe(false)
})

test('a reply that arrives after a new prompt is dropped', async ($, on) => {
  const { clock } = setup(on, () => answered('late one'))
  await $.turn.complete(DONE as never)
  await $.prompt.submit({ text: 'next' } as never)
  await clock.settle()
  const ui = await mount($)
  expect(await ui.find({ key: 'steps-action-0' })).toBeUndefined()
  await ui.unmount()
})

test('failure shows nothing: no reply, an api error, a throw, an abort, an error turn', async ($, on) => {
  let mode = 'empty'
  const { clock, asked } = setup(on, () => {
    if (mode === 'throw') throw new Error('blocked model')
    if (mode === 'api') return { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded' }
    return { isAnswered: false, reason: 'empty-reply' }
  })
  const none = async () => {
    const ui = await mount($)
    const there = (await ui.find({ key: 'steps-action-0' })) !== undefined
    await ui.unmount()
    return there
  }
  for (const next of ['empty', 'api', 'throw']) {
    mode = next
    await $.turn.complete(DONE as never)
    await clock.settle()
    expect(await none()).toBe(false)
  }
  const calls = asked.length
  await $.turn.complete({ ...DONE, isAborted: true, reason: 'aborted' } as never)
  await $.turn.complete({ ...DONE, reason: 'error' } as never)
  await clock.settle()
  expect(asked.length).toBe(calls)
})

test('enabled off makes no request', { options: { enabled: false } }, async ($, on) => {
  const { clock, asked } = setup(on, () => answered('alpha'))
  await $.turn.complete(DONE as never)
  await clock.settle()
  expect(asked.length).toBe(0)
})

test('a subagent turn neither suggests nor clears', async ($, on) => {
  const { clock, asked } = setup(on, () => answered('alpha'))
  await $.turn.complete({ ...DONE, agentId: 'a1' } as never)
  await clock.settle()
  expect(asked.length).toBe(0)
})

test('desktop falls back to built-in drawing', async ($, on) => {
  const { clock } = setup(on, () => answered('alpha'))
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'mod-nextsteps', surface: 'desktop', ...BAND } as never)
  expect(await ui.find({ key: 'steps-action-0' })).toBeUndefined()
  await ui.unmount()
})

test('icons=nerd draws the chevron action', { options: { icons: 'nerd' } }, async ($, on) => {
  const { clock } = setup(on, () => answered('alpha'))
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await mount($)
  expect((await ui.find({ key: 'steps-action-0' }))?.text).toBe(` ${String.fromCodePoint(0xf054)} `)
  await ui.unmount()
})

test('icons=safe draws the return action', { options: { icons: 'safe' } }, async ($, on) => {
  const { clock } = setup(on, () => answered('alpha'))
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await mount($)
  expect((await ui.find({ key: 'steps-action-0' }))?.text).toBe('[↵]')
  await ui.unmount()
})

for (const icons of ['nerd', 'safe']) {
  test(`settings pane draws its heading and controls with icons=${icons}`, { options: { icons } }, async ($, on) => {
    setup(on, () => answered('alpha'))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('fs.read', () => {
      throw new Error('ENOENT')
    })
    on('config.list', () => ({
      value: [
        { key: 'mod-nextsteps.enabled', label: 'Suggest next steps', kind: 'boolean', value: true, provider: { kind: 'plugin', name: 'mod-nextsteps' }, isLocked: false },
        { key: 'mod-nextsteps.count', label: 'Suggestions', kind: 'number', value: 3, provider: { kind: 'plugin', name: 'mod-nextsteps' }, isLocked: false },
        { key: 'other.x', label: 'Not mine', kind: 'boolean', value: true, provider: { kind: 'plugin', name: 'other' }, isLocked: false },
      ],
    }))
    const saved: unknown[] = []
    on('config.set', (_$, e) => {
      saved.push([e.key, e.value])
      return { value: e.value }
    })

    await $.command.run({ command: 'mod-nextsteps', args: 'settings' })
    const ui = await $.ui.mount({
      plugin: 'mod-nextsteps',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'nextsteps',
      props: { title: 'mod-nextsteps', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    } as never)
    const lead = icons === 'nerd' ? String.fromCodePoint(0xf075) : '▸'
    expect(await ui.find({ type: 'Text', text: `${lead} mod-nextsteps · settings` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Suggest next steps/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Not mine/ })).toBeUndefined()

    await ui.press({ key: 'setting-1-up' })
    expect(saved).toEqual([['mod-nextsteps.count', 3]])
    await ui.press({ key: 'setting-0-flip' })
    expect(saved[1]).toEqual(['mod-nextsteps.enabled', false])
    await ui.unmount()
  })
}
