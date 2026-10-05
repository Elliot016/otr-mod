import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const DONE = { answer: 'All done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as const

// Stubs everything the mod touches; `reply` is what the forked model answers and `fills` records prompt writes.
// below: what the mods drawn under this one return; plain text by default.
function setup(on: any, reply: () => unknown, below?: (elements: any) => unknown) {
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
    const elements = $.ui.resolve(e)
    return below ? below(elements) : <elements.Text key="base">base</elements.Text>
  })
  return { clock, fills, asked, setDraft: (text: string) => (draft = text) }
}

const answered = (text: string) => ({ isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
const mount = ($: any) => $.ui.mount({ plugin: 'mod-next-steps', surface: 'terminal', ...BAND })
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
  expect(await rowsOf(ui)).toContain('Add a test')
  await ui.unmount()
})

test('suggestions appear after turn.complete, tidied and capped at the count', async ($, on) => {
  const { clock, asked } = setup(on, () => answered('1. add a test\n- run the suite\n"ship it"\nfourth one'))
  const empty = await mount($)
  expect(await empty.find({ key: 'steps-hotkey-button-0' })).toBeUndefined()
  await empty.unmount()

  await $.turn.complete(DONE as never)
  await clock.settle()
  expect(asked.length).toBe(1)

  const ui = await mount($)
  expect(await ui.find({ key: 'steps-hotkey-button-2' })).toBeDefined()
  expect(await ui.find({ key: 'steps-hotkey-button-3' })).toBeUndefined()
  const drawn = await rowsOf(ui)
  expect(drawn).toContain('Add a test')
  expect(drawn).toContain('Run the suite')
  expect(drawn).toContain('Ship it')
  expect(drawn).not.toContain('Fourth')
  expect(JSON.stringify(await ui.drawn({ in: 'steps-dismiss' }))).toContain('[×]')
  await ui.unmount()
})

test('with a shared pill row below, the card joins that row instead of wrapping it, so mods drawn around stay on one row', async ($, on) => {
  const { clock } = setup(on, () => answered('add a test'), ({ Box, Text }: any) => (
    <Box key="menu-rows" flexDirection="column">
      <Box key="menu-row" flexDirection="row">
        <Text key="pill">Files</Text>
      </Box>
    </Box>
  ))
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await mount($)
  const tree = (await ui.drawn()) as { props?: { key?: string } }
  expect(tree.props?.key).toBe('menu-rows')
  expect(JSON.stringify(tree).split('"menu-rows"').length - 1).toBe(1)
  expect(await ui.find({ key: 'steps-hotkey-button-0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Files' })).toBeDefined()
  await ui.unmount()
})

test('count 1 asks for and shows one suggestion', { options: { count: 1 } }, async ($, on) => {
  const { clock } = setup(on, () => answered('first\nsecond'))
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await mount($)
  expect(await ui.find({ key: 'steps-hotkey-button-0' })).toBeDefined()
  expect(await ui.find({ key: 'steps-hotkey-button-1' })).toBeUndefined()
  await ui.unmount()
})

test('a digit or a click fills the prompt without sending; the digit itself never stays', async ($, on) => {
  const { clock, fills, setDraft } = setup(on, () => answered('alpha\nbeta'))
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await mount($)

  await ui.press({ key: 'steps-hotkey-button-1' })
  expect(fills).toEqual([{ text: 'Beta', mode: 'replace' }])

  // A digit still in the prompt when the hotkey lands is replaced, not kept in front of the suggestion.
  setDraft('2')
  await ui.press({ key: 'steps-hotkey-button-1' })
  expect(fills.pop()).toEqual({ text: 'Beta', mode: 'replace' })
  setDraft('')

  await ui.pointer({ in: 'steps-list', type: 'down', button: 'left', x: 3, y: 0 })
  expect(fills[1]).toEqual({ text: 'Alpha', mode: 'replace' })

  // A draft already in the box is kept: the suggestion is appended.
  setDraft('please')
  await ui.press({ key: 'steps-hotkey-button-0' })
  expect(fills[2]).toEqual({ text: ' Alpha', mode: 'append' })
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
    const there = (await ui.find({ key: 'steps-hotkey-button-0' })) !== undefined
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
  expect(await ui.find({ key: 'steps-hotkey-button-0' })).toBeUndefined()
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
    const there = (await ui.find({ key: 'steps-hotkey-button-0' })) !== undefined
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
  const ui = await $.ui.mount({ plugin: 'mod-next-steps', surface: 'desktop', ...BAND } as never)
  expect(await ui.find({ key: 'steps-hotkey-button-0' })).toBeUndefined()
  await ui.unmount()
})

test('each suggestion leads with its digit as a keycap, in either icon mode', { options: { icons: 'safe' } }, async ($, on) => {
  const { clock } = setup(on, () => answered('alpha\nbeta'))
  await $.turn.complete(DONE as never)
  await clock.settle()
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: ' 1 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 2 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 3 ' })).toBeUndefined()
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
        { key: 'mod-next-steps.enabled', label: 'Suggest next steps', kind: 'boolean', value: true, provider: { kind: 'plugin', name: 'mod-next-steps' }, isLocked: false },
        { key: 'mod-next-steps.count', label: 'Suggestions', kind: 'number', value: 3, provider: { kind: 'plugin', name: 'mod-next-steps' }, isLocked: false },
        { key: 'other.x', label: 'Not mine', kind: 'boolean', value: true, provider: { kind: 'plugin', name: 'other' }, isLocked: false },
      ],
    }))
    const saved: unknown[] = []
    on('config.set', (_$, e) => {
      saved.push([e.key, e.value])
      return { value: e.value }
    })

    await $.command.run({ command: 'mod-next-steps', args: 'settings' })
    const ui = await $.ui.mount({
      plugin: 'mod-next-steps',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'nextsteps',
      props: { title: 'mod-next-steps', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    } as never)
    const lead = icons === 'nerd' ? String.fromCodePoint(0xf075) : '▸'
    expect(await ui.find({ type: 'Text', text: `${lead} Next steps · Settings` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Suggest next steps/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Not mine/ })).toBeUndefined()

    await ui.press({ key: 'setting-1-up' })
    expect(saved).toEqual([['mod-next-steps.count', 3]])
    await ui.press({ key: 'setting-0-flip' })
    expect(saved[1]).toEqual(['mod-next-steps.enabled', false])
    await ui.unmount()
  })
}
