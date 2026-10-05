import { expect, mock, test } from 'claude-code/testing'

import { groupSkills, markDescription, readFrontmatter, stripBadges, swatchFor } from '../hooks/tags'

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const FILES: Record<string, string> = {
  '/h/.claude/skills/plain/SKILL.md': '---\nname: plain\ndescription: x\n---\nbody',
  '/h/.claude/skills/rev/SKILL.md': '---\nname: rev\ncolor-tag: Review\n---\nbody',
  '/h/.claude/skills/secret/SKILL.md': '---\nname: secret\ndescription: hidden one\ndisable-model-invocation: true\n---\nbody',
}

type On = Parameters<Parameters<typeof test>[1]>[1]

const stubSkills = (on: On) => {
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.list', (_$, e) => ({
    value: neutral(e.path).endsWith('/mods') ? [{ name: 'mod-manager', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [
      { name: 'plain', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'rev', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'secret', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'README.md', kind: 'file', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in FILES)) throw new Error('ENOENT')
    return { value: FILES[path]! }
  })
}

const stubSession = (on: On) => {
  on('session.start', () => ({ cwd: '/h' }))
  on('command.register', () => ({ value: { command: 'mod-skill-panel' } }))
  on('ui.panes', () => ({ value: [] }))
}

const REVIEW_CHIP = '\x1b[48;2;209;168;255m\x1b[38;2;13;14;23m \u2234 \x1b[39m\x1b[49m'

test('tags: default personal, explicit tag, unknown fallback, malformed skipped', () => {
  expect(readFrontmatter(FILES['/h/.claude/skills/plain/SKILL.md']!)).toEqual({ name: 'plain', tag: 'personal', description: 'x', hidden: false })
  expect(readFrontmatter('---\r\nname: "quoted"\r\ncolor-tag: tool \r\n---\r\n')).toEqual({ name: 'quoted', tag: 'tool', hidden: false })
  expect(readFrontmatter('no frontmatter here')).toBeNull()
  expect(readFrontmatter(FILES['/h/.claude/skills/secret/SKILL.md']!)?.hidden).toBe(true)
  expect(swatchFor('nope')).toEqual(swatchFor('personal'))
  expect(markDescription('Does X', 'review')).toBe(`${REVIEW_CHIP} Does X`)
  const listing = ['- a: ' + markDescription('Does X', 'review'), '- b: Plain [x] text'].join('\n')
  expect(stripBadges(listing)).toBe('- a: Does X\n- b: Plain [x] text')
})

test('describe marks personal skills and leaves other commands alone', async ($, on) => {
  stubSkills(on)
  on('command.describe', (_$, e) => ({ description: e.description, argumentHint: e.argumentHint, isHidden: e.isHidden }))
  stubSession(on)
  on('ui.invalidate', () => ({ value: undefined }))

  await $.session.start({ cwd: '/h' } as never)

  const describe = (command: string, plugin = 'engine') =>
    $.command.describe({
      command,
      description: 'Does X',
      isHidden: false,
      immediate: false,
      provider: { plugin, tier: plugin === 'engine' ? 'core' : 'user' },
    } as never)

  expect((await describe('mod-manager', 'mod-manager')).description).toContain('\x1b[48;2;93;203;255m')
  expect((await describe('mod-manager', 'mod-manager@inline')).description).toContain('\x1b[48;2;93;203;255m')
  expect((await describe('other', 'someone-elses-plugin')).description).toBe('Does X')

  expect((await describe('plain')).description).toContain('\x1b[48;2;155;163;196m')
  expect((await describe('rev')).description).toContain(REVIEW_CHIP)
  expect((await describe('help')).description).toBe('Does X')
})

test('groups: fixed tag order, untagged last, names sorted, unknown tags fold into untagged', () => {
  const groups = groupSkills([
    { name: 'zeta', tag: 'personal', description: '', hidden: false },
    { name: 'tidy', tag: 'writing', description: '', hidden: false },
    { name: 'execute', tag: 'router', description: '', hidden: false },
    { name: 'deliver', tag: 'router', description: '', hidden: false },
    { name: 'odd', tag: 'nonsense', description: '', hidden: false },
  ])
  expect(groups.map(group => group.tag)).toEqual(['router', 'writing', 'personal'])
  expect(groups[0]!.skills.map(skill => skill.name)).toEqual(['deliver', 'execute'])
  expect(groups[2]!.skills.map(skill => skill.name)).toEqual(['odd', 'zeta'])
})

test('panel lists skill groups and a press fills the prompt', async ($, on) => {
  stubSkills(on)
  stubSession(on)
  let box = 'please '
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_$, e) => {
    box = e.mode === 'append' ? box + e.text : e.text
    return { isFilled: true }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.session.start({ cwd: '/h' } as never)
  await $.command.run({ command: 'mod-skill-panel' })

  const ui = await $.ui.mount({
    plugin: 'mod-skill-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'skill-panel',
    props: { title: 'Skills', isFocused: true, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)

  // At 40 columns the two visible groups sit side by side: list-0 is [review header, rev], list-1 is [personal header, plain].
  expect(await ui.find({ type: 'Text', text: '▸ Skills · 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '/rev' })).toBeDefined()

  // The add glyph adds; a repeat is skipped.
  await ui.press({ key: 'column-0-action-1' })
  await ui.press({ key: 'column-1-action-1' })
  await ui.press({ key: 'column-0-action-1' })
  expect(box).toBe('please /rev /plain ')

  // A click on the name shows the skill in the card and adds nothing.
  await ui.pointer({ in: 'list-1', type: 'down', button: 'left', x: 2, y: 1 })
  expect(await ui.find({ type: 'Text', text: '/plain' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'x' })).toBeDefined()
  expect(box).toBe('please /rev /plain ')
  await ui.unmount()
})

test('the command toggles: it opens a closed pane and closes an open one', async ($, on) => {
  let open: string[] = []
  const calls: string[] = []
  on('ui.panes', () => ({ value: open.map(id => ({ id, isPlaced: true })) }))
  on('ui.open', (_$, e) => {
    calls.push(`open ${e.id}`)
    open = [e.id]
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    calls.push(`close ${e.id}`)
    open = []
    return { value: undefined }
  })

  await $.command.run({ command: 'mod-skill-panel' })
  await $.command.run({ command: 'mod-skill-panel' })
  expect(calls).toEqual(['open skill-panel', 'close skill-panel'])
})

const skillsPane = async ($: any, on: any) => {
  stubSkills(on)
  on('ui.panes', () => ({ value: [] }))
  return $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel', props: { title: 'Skills', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
}

test('icons=nerd draws the settings pill with the Nerd gear', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await skillsPane($, on)
  expect(JSON.stringify(await ui.drawn({ in: 'skills-settings' }))).toContain(String.fromCodePoint(0xf013))
  await ui.unmount()
})

test('icons=safe draws the settings pill with the plain gear', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await skillsPane($, on)
  const pill = JSON.stringify(await ui.drawn({ in: 'skills-settings' }))
  expect(pill).toContain('⚙')
  expect(pill).not.toContain(String.fromCodePoint(0xf013))
  await ui.unmount()
})

test('the title row pill swaps the sidebar for its settings and back', async ($, on) => {
  stubSkills(on)
  let open: string[] = []
  const calls: string[] = []
  on('ui.panes', () => ({ value: open.map(id => ({ id, isPlaced: true })) }))
  on('ui.open', (_$, e) => {
    calls.push(`open ${e.id}`)
    open = [e.id]
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    calls.push(`close ${e.id}`)
    open = open.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('config.list', () => ({ value: [{ key: 'mod-skill-panel.animations', label: 'Animations', kind: 'boolean', value: true, description: 'd' }] }) as never)
  const pane = (requestId: string) =>
    ({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId, props: { title: 'Skills', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } }) as never

  await $.command.run({ command: 'mod-skill-panel' })
  const ui = await $.ui.mount(pane('skill-panel'))
  await ui.pointer({ in: 'skills-settings', type: 'down', button: 'left', x: 1, y: 0 })
  expect(calls).toEqual(['open skill-panel', 'close skill-panel', 'open skill-panel-settings'])
  await ui.unmount()

  const settings = await $.ui.mount(pane('skill-panel-settings'))
  expect(await settings.find({ type: 'Text', text: 'Animations' })).toBeDefined()
  await settings.pointer({ in: 'skills-back', type: 'down', button: 'left', x: 1, y: 0 })
  expect(calls.slice(-2)).toEqual(['close skill-panel-settings', 'open skill-panel'])
  await settings.unmount()
})

test('its footer entry opens the pane on a press and closes it on the next', async ($, on) => {
  const opened: string[] = []
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: '/h' }))
  on('ui.panes', () => ({ value: opened.filter(id => !opened.includes(`close ${id}`)).map(id => ({ id, isPlaced: true })) }))
  on('ui.close', (_$, e) => {
    opened.push(`close ${e.id}`)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const band = {
    plugin: 'mod-skill-panel',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as const

  const idle = await $.ui.mount(band)
  expect(await idle.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  // The pointer on the entry shows its tip under the row, and leaving takes it away.
  await idle.pointer({ type: 'move', x: 1, y: 0, in: 'menu-entry-skills' })
  expect(await idle.find({ type: 'Text', text: /^Skills: browse your skills/ })).toBeDefined()
  await idle.pointer({ type: 'leave', x: 0, y: 0, in: 'menu-entry-skills' })
  expect(await idle.find({ type: 'Text', text: /^Skills: browse your skills/ })).toBeUndefined()
  await idle.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-skills' })
  expect(opened).toEqual(['skill-panel'])
  await idle.unmount()

  const busy = await $.ui.mount(band)
  await busy.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-skills' })
  expect(opened).toEqual(['skill-panel', 'close skill-panel'])
  await busy.unmount()
})

test('a pane that waits says why in a wrapped card above the row, not in Claude Code toast box', async ($, on) => {
  const engineToasts: string[] = []
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('env.get', () => ({ value: '/h' }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'unasked below 144 columns (99 now)' } }))
  on('ui.toast', (_$, e) => {
    engineToasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const clock = mock.clock(on)
  const band = await $.ui.mount({
    plugin: 'mod-skill-panel',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })

  await band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-skills' })
  expect(await band.find({ type: 'Text', text: 'Skills panel waiting: unasked below 144 columns (99 now)' })).toBeDefined()
  expect(engineToasts).toEqual([])
  // Hovering the × leaves the card; a click on it dismisses.
  await band.pointer({ type: 'move', x: 0, y: 0, in: 'toast-skills-1' })
  expect(await band.find({ type: 'Text', text: /^Skills panel waiting/ })).toBeDefined()
  await band.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'toast-skills-1' })
  expect(await band.find({ type: 'Text', text: /^Skills panel waiting/ })).toBeUndefined()

  // A second one leaves on its own after the timeout.
  await band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-skills' })
  expect(await band.find({ type: 'Text', text: /^Skills panel waiting/ })).toBeDefined()
  await clock.advance(4000)
  expect(await band.find({ type: 'Text', text: /^Skills panel waiting/ })).toBeUndefined()
  await band.unmount()
})

test('its entry shimmers from the click until the pane draws', async ($, on) => {
  const opened: string[] = []
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: '/h' }))
  on('ui.panes', () => ({ value: opened.map(id => ({ id, isPlaced: true })) }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  const clock = mock.clock(on)
  const band = await $.ui.mount({
    plugin: 'mod-skill-panel',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
  // At rest the label is one Text; shimmering, each character is its own Text in the wave's colors.
  const letters = async () => JSON.stringify(await band.drawn({ in: 'menu-entry-skills' })).split('"type":"Text"').length - 1
  expect(await letters()).toBe(1)

  await band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-skills' })
  expect(await letters()).toBe(' Skills '.length)

  const pane = await $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel', props: { scroll: { offset: 0, bodyRows: 20 }, bodyColumns: 60 } } as never)
  await clock.advance(1500)
  expect(await letters()).toBe(1)
  await pane.unmount()
  await band.unmount()
})

test('its entry joins the row another panel opened, above the hint line', async ($, on) => {
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', () => ({
    type: 'Box',
    props: { key: 'menu-rows', flexDirection: 'column' },
    children: [
      { type: 'Box', props: { key: 'menu-row', flexDirection: 'row' }, children: [{ type: 'Text', props: {}, children: ['Mods'] }] },
      { type: 'Text', props: {}, children: ['? for shortcuts'] },
    ],
  }))

  const ui = await $.ui.mount({
    plugin: 'mod-skill-panel',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as never)
  const tree = (await ui.drawn()) as { children: { children: unknown[] }[] }
  // The hint, the tip row (kept while empty) and the pill row.
  expect(tree.children.length).toBe(3)
  expect(JSON.stringify(tree.children[2])).toMatch(/Skills.*Mods/)
  expect(JSON.stringify(tree.children[0])).toContain('? for shortcuts')
  await ui.unmount()
})
