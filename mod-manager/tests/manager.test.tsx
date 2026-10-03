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
    props: { title: 'Mods', isFocused: true, bodyColumns: 80, placement: 'above', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)

  const dirs = () => String(JSON.parse(files[settingsPath]!).env.CLAUDE_CODE_PLUGIN_DIRS)
  expect(await ui.find({ type: 'Text', text: /alpha does a thing/ })).toBeDefined()

  // A click on the name selects and never toggles; the row's [◉] action toggles.
  await ui.pointer({ in: 'list', type: 'down', button: 'left', x: 2, y: 1 })
  expect(dirs()).not.toContain('beta')
  expect(await ui.find({ type: 'Text', text: /beta does a thing/ })).toBeDefined()

  await ui.press({ key: 'mods-action-1' })
  expect(dirs()).toContain('beta')

  // The first row's action turns alpha off; a click on its name selects it into the card.
  await ui.press({ key: 'mods-action-0' })
  await ui.pointer({ in: 'list', type: 'down', button: 'left', x: 2, y: 0 })
  expect(await ui.find({ type: 'Text', text: /alpha does a thing/ })).toBeDefined()
  expect(JSON.parse(files[settingsPath]!).enabledPlugins['alpha@inline']).toBe(false)
  expect(dirs()).toContain('alpha')
  expect(await ui.find({ type: 'Text', text: /alpha disabled, Apply to reload/ })).toBeDefined()
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

test('while Claude works Apply is inert and says why', async ($, on) => {
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: '/h' }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  const pane = {
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: true, bodyColumns: 80, placement: 'above', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never

  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ turnId: 't1' } as never)
  const busy = await $.ui.mount(pane)
  expect(await busy.find({ type: 'Text', text: /available once it is idle/ })).toBeDefined()
  await busy.unmount()

  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: null } as never)
  const idle = await $.ui.mount(pane)
  expect(await idle.find({ type: 'Text', text: /available once it is idle/ })).toBeUndefined()
  await idle.unmount()
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
  await idle.press({ key: 'menu-entry' })
  expect(opened).toEqual(['manager'])
  await idle.unmount()

  const busy = await $.ui.mount(band)
  await busy.press({ key: 'menu-entry' })
  expect(opened).toEqual(['manager', 'close manager'])
  await busy.unmount()
})
