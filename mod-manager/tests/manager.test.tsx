import { expect, test } from 'claude-code/testing'

import { discover, featuresOf, setEnabled, type Io } from '../hooks/registry'

const SETTINGS = {
  $schema: 'https://example.test/schema.json',
  env: { KEEP: '1', CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/alpha' },
  enabledPlugins: { 'inst@m': true, 'other@m': false },
  model: 'x',
}

const manifest = (name: string) => JSON.stringify({ name, description: `${name} does a thing`, version: '1.0.0' })
const hooks = JSON.stringify({ modules: ['./register.tsx'] })
const source = "on('tool.call', async () => {})\non('ui.render', { component: 'AbovePrompt' }, async () => {})\n$.ui.status('x')\n$.command.register({ name: 'mod-beta', description: 'b' })"

const disk = (overrides: Record<string, string> = {}) => {
  const files: Record<string, string> = {
    '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n',
    '/h/.claude/plugins/installed_plugins.json': JSON.stringify({
      plugins: {
        'inst@m': [{ scope: 'user', installPath: '\\cache\\inst' }],
        'plain@m': [{ scope: 'user', installPath: '\\cache\\plain' }],
      },
    }),
    '/h/.claude/mods/alpha/.claude-plugin/plugin.json': manifest('alpha'),
    '/h/.claude/mods/alpha/hooks/hooks.json': hooks,
    '/h/.claude/mods/alpha/hooks/register.tsx': source,
    '/h/.claude/mods/alpha/showcase.json': JSON.stringify({
      tagline: 'Alpha tagline',
      features: [{ title: 'Count', detail: 'Counts things.' }],
    }),
    '/h/.claude/mods/beta/.claude-plugin/plugin.json': manifest('beta'),
    '/h/.claude/mods/beta/hooks/hooks.json': hooks,
    '/h/.claude/mods/beta/hooks/register.tsx': source,
    '/cache/inst/.claude-plugin/plugin.json': manifest('inst'),
    '/cache/inst/hooks/hooks.json': hooks,
    '/cache/inst/hooks/register.tsx': source,
    '/cache/plain/.claude-plugin/plugin.json': manifest('plain'),
    ...overrides,
  }
  const io: Io = {
    read: async path => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`)
      return files[path]!
    },
    write: async (path, text) => void (files[path] = text),
    list: async path => {
      if (path !== '/h/.claude/mods') throw new Error('ENOENT')
      return [
        { name: 'alpha', kind: 'dir' },
        { name: 'beta', kind: 'dir' },
        { name: 'notes.md', kind: 'file' },
      ]
    },
    home: async () => '/h',
  }
  return { io, files }
}

const byName = async (io: Io, name: string) => (await discover(io)).find(mod => mod.name === name)!

test('discovery finds dir and installed mods with their facts', async () => {
  const { io } = disk()
  const found = await discover(io)

  expect(found.map(mod => mod.name)).toEqual(['alpha', 'beta', 'inst'])
  const alpha = found[0]!
  expect(alpha).toMatchObject({ description: 'alpha does a thing', version: '1.0.0', source: 'dir', enabled: true })
  expect(found[1]!.enabled).toBe(false)
  expect(found[2]).toMatchObject({ source: 'installed', enabled: true, id: 'inst@m' })
})

test('a mod folder installed from the local marketplace shows once, as the installed entry, among your own', async () => {
  const { io } = disk({
    'C:/H/.claude/settings.json': JSON.stringify(SETTINGS),
    'C:/H/.claude/plugins/installed_plugins.json': JSON.stringify({
      plugins: {
        // The real record: a cache path, though the plugin loads in place from the marketplace folder.
        'beta@claude-mods': [{ scope: 'user', installPath: 'C:\\H\\.claude\\plugins\\cache\\claude-mods\\beta\\0.1.0' }],
        'inst@m': [{ scope: 'user', installPath: '\\cache\\inst' }],
      },
    }),
    'C:/H/.claude/plugins/known_marketplaces.json': JSON.stringify({ 'claude-mods': { source: { source: 'directory', path: 'C:\\H\\.claude\\mods' } } }),
    'C:/H/.claude/mods/beta/.claude-plugin/plugin.json': manifest('beta'),
    'C:/H/.claude/mods/beta/hooks/hooks.json': hooks,
    'C:/H/.claude/mods/beta/hooks/register.tsx': source,
  })
  io.home = async () => 'C:/H'
  io.list = async path => {
    if (path !== 'C:/H/.claude/mods') throw new Error('ENOENT')
    return [{ name: 'beta', kind: 'dir' }]
  }
  const found = (await discover(io)).filter(mod => mod.name === 'beta')
  expect(found.length).toBe(1)
  expect(found[0]).toMatchObject({ source: 'installed', id: 'beta@claude-mods', isOwn: true })
})

test('skips plugins without a hooks module', async () => {
  const { io } = disk()

  expect((await discover(io)).some(mod => mod.name === 'plain')).toBe(false)
})

test('toggle installed edits only enabledPlugins and backs up first', async () => {
  const { io, files } = disk()
  const original = files['/h/.claude/settings.json']!

  expect(await setEnabled(io, await byName(io, 'inst'), false)).toEqual({ ok: true })

  const after = JSON.parse(files['/h/.claude/settings.json']!)
  expect(after.enabledPlugins).toEqual({ 'inst@m': false, 'other@m': false })
  expect(after.env).toEqual(SETTINGS.env)
  expect(after.model).toBe('x')
  expect(files['/h/.claude/settings.json.mod-manager.bak']).toBe(original)
  expect((await byName(io, 'inst')).enabled).toBe(false)
})

test('toggle dir flips <name>@inline and lists a new folder only once', async () => {
  const { io, files } = disk()
  const settings = () => JSON.parse(files['/h/.claude/settings.json']!)

  // A listed mod toggles in place, so /reload-plugins applies it.
  expect(await setEnabled(io, await byName(io, 'alpha'), false)).toEqual({ ok: true, needsRestart: false })
  expect(settings().enabledPlugins['alpha@inline']).toBe(false)
  expect(settings().env).toEqual(SETTINGS.env)
  expect((await byName(io, 'alpha')).enabled).toBe(false)

  expect(await setEnabled(io, await byName(io, 'alpha'), true)).toEqual({ ok: true, needsRestart: false })
  expect((await byName(io, 'alpha')).enabled).toBe(true)

  // A folder not yet listed joins the list, which only a restart reads.
  expect(await setEnabled(io, await byName(io, 'beta'), true)).toEqual({ ok: true, needsRestart: true })
  expect(settings().env.CLAUDE_CODE_PLUGIN_DIRS).toBe('~/.claude/mods/alpha:~/.claude/mods/beta')
  expect(settings().enabledPlugins['beta@inline']).toBe(true)
  expect(settings().env.KEEP).toBe('1')
})

test('safety: refuses itself, invalid JSON and leaves the file alone', async () => {
  const { io, files } = disk()
  const self = { ...(await byName(io, 'alpha')), name: 'mod-manager' }
  expect(await setEnabled(io, self, false)).toMatchObject({ ok: false })

  const broken = disk({ '/h/.claude/settings.json': '{ not json' })
  const outcome = await setEnabled(broken.io, await byName(io, 'alpha'), false)
  expect(outcome).toMatchObject({ ok: false })
  expect(broken.files['/h/.claude/settings.json']).toBe('{ not json')
  expect(Object.keys(broken.files).some(path => path.endsWith('.bak'))).toBe(false)
  expect(Object.keys(files).some(path => path.endsWith('.bak'))).toBe(false)
})

test('showcase uses showcase.json, else derives from the hooks source', async () => {
  const { io } = disk()
  const alpha = await byName(io, 'alpha')
  expect(featuresOf(alpha)).toEqual([{ title: 'Count', detail: 'Counts things.' }])

  const beta = await byName(io, 'beta')
  expect(beta.events).toEqual(['tool.call', 'ui.render:AbovePrompt'])
  expect(beta.calls).toEqual(['ui.status', 'command.register'])
  expect(beta.commands).toEqual(['mod-beta'])
  expect(featuresOf(beta).map(feature => feature.title)).toEqual(['tool.call', 'ui.render:AbovePrompt'])
  expect(featuresOf(beta)[0]!.detail).toContain('tool call')
})

// The engine rewrites paths in the host's style, so compare on a neutral form.
const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

test('pane lists mods on the terminal and a toggle press writes settings', async ($, on) => {
  const { files } = disk()
  const settingsPath = '/h/.claude/settings.json'
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', () => ({
    value: [
      { name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'beta', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.command.run({ command: 'mod-manager' })

  const ui = await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: true, bodyColumns: 80, placement: 'above', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)

  const dirs = () => String(JSON.parse(files[settingsPath]!).env.CLAUDE_CODE_PLUGIN_DIRS)
  expect(await ui.find({ type: 'Text', text: /^▸ Mods · 2 of 3 on$/ })).toBeDefined()
  // Rows group by source, and nothing toggled yet means nothing to reload.
  expect(await ui.find({ type: 'Text', text: /^Yours$/ })).toBeDefined()
  // Beside each readable name, the package name: the folder to open.
  expect(JSON.stringify(await ui.drawn({ in: 'list-dir' }))).toMatch(/"alpha"/)
  expect(await ui.find({ type: 'Text', text: /^Installed$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^No changes to apply$/ })).toBeDefined()

  // The row's [◉] action toggles; the list itself shows no details.
  await ui.press({ key: 'mods-dir-action-1' })
  expect(dirs()).toContain('beta')
  await ui.press({ key: 'mods-dir-action-0' })
  expect(JSON.parse(files[settingsPath]!).enabledPlugins['alpha@inline']).toBe(false)
  expect(await ui.find({ type: 'Text', text: /Alpha disabled, reload plugins to apply/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^Reload plugins to apply 2 changes$/ })).toBeDefined()
  // Toggling alpha back leaves one change pending.
  await ui.press({ key: 'mods-dir-action-0' })
  expect(await ui.find({ type: 'Button', text: /^Reload plugins to apply 1 change$/ })).toBeDefined()
  // While Claude works the reload would only queue as a prompt, so it waits.
  await $.turn.start({ turnId: 't1' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^Reload plugins to apply 1 change · available once Claude is idle$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /alpha does a thing/ })).toBeUndefined()

  // Hovering a row shows that mod's description in a card at the bottom; leaving the list hides it.
  await ui.pointer({ in: 'list-dir', type: 'move', x: 2, y: 0 })
  expect(await ui.find({ type: 'Text', text: 'alpha does a thing' })).toBeDefined()
  expect(await ui.find({ key: 'hover-card' })).toBeDefined()
  await ui.pointer({ in: 'list-dir', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ key: 'hover-card' })).toBeUndefined()

  // A click on a name opens that mod's page, and < back returns to the list.
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 2, y: 1 })
  expect(await ui.find({ type: 'Text', text: /beta does a thing/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^< Back$/ })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /^▸ Mods · 3 of 3 on$/ })).toBeDefined()
  await ui.unmount()
})

test('a mod page changes its settings, runs its actions, and holds them while Claude works', async ($, on) => {
  const { files } = disk({
    '/h/.claude/mods/alpha/showcase.json': JSON.stringify({
      tagline: 'Alpha tagline',
      actions: [{ label: 'Say hi', command: 'alpha', args: 'hi' }],
      previews: { loud: { false: [{ bar: 'border', spans: [{ text: 'quiet example' }] }] } },
    }),
    '/h/.claude/mods/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', description: 'alpha does a thing', version: '1.0.0', userConfig: { loud: { type: 'boolean', title: 'Loud', description: 'Shouts', default: false } } }),
  })
  const saved: unknown[] = []
  const ran: string[] = []
  on('fs.read', (_$, e) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({
    value: [
      { key: 'alpha.loud', label: 'Loud', description: 'Shouts', kind: 'boolean', value: false, provider: { kind: 'plugin', name: 'alpha' }, isLocked: false },
      { key: 'other.loud', label: 'Not alpha', kind: 'boolean', value: true, provider: { kind: 'plugin', name: 'other' }, isLocked: false },
    ],
  }))
  on('config.set', (_$, e) => {
    saved.push([e.key, e.value])
    return { value: e.value }
  })
  on('command.run', (_$, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.command.run({ command: 'mod-manager' })
  const ui = await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  // A mod that declares settings carries the gear in the list; a mod without settings does not.
  const listed = JSON.stringify(await ui.drawn({ in: 'list-dir' }))
  expect(listed).toContain('⚙')
  expect(listed.split('⚙').length).toBe(2)
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 2, y: 0 })

  // Only alpha's own rows show, and a click saves through /config.
  expect(await ui.find({ type: 'Text', text: /^Loud$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Not alpha$/ })).toBeUndefined()
  // The example card for the current value comes from the mod's showcase.json, as in its own panel.
  expect(await ui.find({ type: 'Text', text: /^quiet example$/ })).toBeDefined()
  await ui.press({ key: 'setting-0-flip' })
  expect(saved).toEqual([['alpha.loud', true]])
  expect(await ui.find({ type: 'Text', text: /Loud saved/ })).toBeDefined()

  await ui.press({ key: 'action-0' })
  expect(ran).toEqual(['alpha hi'])

  // Another mod's command would only queue mid-turn, so its action waits.
  await $.turn.start({ turnId: 't1' } as never)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Say hi · available once Claude is idle/ })).toBeDefined()
  await ui.unmount()
})

test('the command toggles: it opens a closed pane and closes an open one', async ($, on) => {
  let open: string[] = []
  const calls: string[] = []
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: '/h' }))
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

  await $.command.run({ command: 'mod-manager' })
  await $.command.run({ command: 'mod-manager' })
  expect(calls).toEqual(['open manager', 'close manager'])
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
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as const

  const idle = await $.ui.mount(band)
  expect(await idle.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await idle.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-manager' })
  expect(opened).toEqual(['manager'])
  await idle.unmount()

  const busy = await $.ui.mount(band)
  await busy.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-manager' })
  expect(opened).toEqual(['manager', 'close manager'])
  await busy.unmount()
})

const iconsPane = async ($: any, on: any) => {
  const { files } = disk()
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' })
  const ui = await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  await ui.pointer({ in: 'list-dir', type: 'down', button: 'left', x: 2, y: 0 })
  return ui
}

test('the icons switch shows Mixed when mods differ, and one click sets every mod, this one last', async ($, on) => {
  const { files } = disk()
  // Values the engine hands out come back frozen, so the rows are rebuilt from this map on every list.
  const values: Record<string, string> = { 'mod-manager.icons': 'auto', 'mod-alpha.icons': 'auto', 'mod-beta.icons': 'nerd' }
  const rows = () => Object.entries(values).map(([key, value]) => ({ key, label: 'Icons', kind: 'select', value, options: ['auto', 'nerd', 'safe'], description: 'd' }))
  const saved: string[] = []
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.list', () => ({ value: [{ name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: rows() }))
  on('config.set', (_$: unknown, e: { key: string; value: string }) => {
    saved.push(e.key)
    values[e.key] = e.value
    return { value: e.value }
  })
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' })
  const ui = await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  expect(await ui.find({ type: 'Text', text: '· Mixed' })).toBeDefined()

  await ui.pointer({ in: 'icons-nerd', type: 'down', button: 'left', x: 1, y: 0 })
  await ui.redraw()
  // Only the mods not already on Nerd change, and this mod's own setting goes last since saving it reloads this mod.
  expect(saved).toEqual(['mod-alpha.icons', 'mod-manager.icons'])
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: '· Mixed' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Icons set to Nerd in 2 mods/ })).toBeDefined()
  await ui.unmount()
})

const SWITCH_ON = String.fromCodePoint(0xf205)
const PILL_CAP = String.fromCodePoint(0xe0b6)

test('icons=nerd draws Nerd controls and pill headings', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await iconsPane($, on)
  expect(await ui.find({ type: 'Text', text: PILL_CAP })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Features$/ })).toBeDefined()
  expect(await ui.find({ key: 'features-head' })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Button', text: SWITCH_ON })).toBeDefined()
  await ui.unmount()
})

test('icons=safe keeps the common Unicode glyphs and plain headings', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await iconsPane($, on)
  expect(await ui.find({ type: 'Text', text: PILL_CAP })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Features$/ })).toBeDefined()
  expect(await ui.find({ key: 'features-head' })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Button', text: /^\[◉\]$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: SWITCH_ON })).toBeUndefined()
  await ui.unmount()
})
