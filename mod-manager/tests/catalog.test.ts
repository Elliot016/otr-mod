// mod-manager / tests/catalog.test.ts, by v-amorim
// Tests the marketplace catalog, each mod's state and the once-a-day refresh.
import { expect, test } from 'claude-code/testing'

import { catalogOf, catalogState, discover, isNewer, marketOf, refreshCatalog, type Io } from '../hooks/registry'

const hooks = JSON.stringify({ modules: ['./register.tsx'] })
const manifest = (name: string, version: string, extra: object = {}) => JSON.stringify({ name, description: `${name} does a thing`, version, ...extra })

const plugin = (files: Record<string, string>, root: string, name: string, version: string, extra: object = {}) => {
  files[`${root}/.claude-plugin/plugin.json`] = manifest(name, version, extra)
  files[`${root}/hooks/hooks.json`] = hooks
  files[`${root}/hooks/register.tsx`] = ''
}

const CATALOG = ['onmod', 'offmod', 'newmod', 'upmod', 'foldermod']

// The marketplace folder holds every catalog mod at 2.0.0; `claude-mods` is where mod-manager came from.
const setup = (settings: object = {}, extra: Record<string, string> = {}) => {
  const files: Record<string, string> = {
    '/h/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'onmod@claude-mods': true, 'offmod@claude-mods': false, 'upmod@claude-mods': true }, env: { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/other/foldermod' }, ...settings }),
    '/h/.claude/plugins/installed_plugins.json': JSON.stringify({
      plugins: {
        'mod-manager@claude-mods': [{ scope: 'user', installPath: '/cache/mm' }],
        'onmod@claude-mods': [{ scope: 'user', installPath: '/cache/onmod' }],
        'offmod@claude-mods': [{ scope: 'user', installPath: '/cache/offmod' }],
        'upmod@claude-mods': [{ scope: 'user', installPath: '/cache/upmod' }],
      },
    }),
    '/h/.claude/plugins/known_marketplaces.json': JSON.stringify({ 'claude-mods': { source: { source: 'github', repo: 'x/y' }, installLocation: 'C:\\m' } }),
    'C:/m/.claude-plugin/marketplace.json': JSON.stringify({ plugins: CATALOG.map(name => ({ name, description: `${name} listed`, source: `./${name}` })) }),
    ...extra,
  }
  for (const name of CATALOG) plugin(files, `C:/m/${name}`, name, '2.0.0', name === 'onmod' ? { userConfig: { icons: { type: 'string' } } } : {})
  plugin(files, '/cache/mm', 'mod-manager', '2.0.0')
  plugin(files, '/cache/onmod', 'onmod', '2.0.0')
  plugin(files, '/cache/offmod', 'offmod', '2.0.0')
  plugin(files, '/cache/upmod', 'upmod', '1.9.9')
  plugin(files, '/h/.claude/other/foldermod', 'foldermod', '0.0.1')
  const io: Io = {
    read: async path => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`)
      return files[path]!
    },
    write: async (path, text) => void (files[path] = text),
    list: async () => [],
    home: async () => '/h',
    config: async () => '/h/.claude',
  }
  return { io, files }
}

const rows = async (io: Io) => {
  const market = await marketOf(io)
  const found = catalogState(await catalogOf(io, market), await discover(io), market)
  return (name: string) => found.find(row => row.name === name)!
}

test('catalog: reads the marketplace of the manager with versions and icons support', async () => {
  const { io } = setup()
  expect(await marketOf(io)).toBe('claude-mods')
  const catalog = await catalogOf(io, 'claude-mods')
  expect(catalog.map(entry => entry.name)).toEqual(CATALOG)
  expect(catalog[0]).toMatchObject({ description: 'onmod listed', version: '2.0.0', declaresIcons: true })
  expect(catalog[1]!.declaresIcons).toBe(false)
})

test('catalog: the marketplace falls back to claude-mods and another name is followed', async () => {
  const { io, files } = setup()
  files['/h/.claude/plugins/installed_plugins.json'] = JSON.stringify({ plugins: { 'mod-manager@other': [{ scope: 'user', installPath: '/cache/mm' }] } })
  expect(await marketOf(io)).toBe('other')
  files['/h/.claude/plugins/installed_plugins.json'] = JSON.stringify({ plugins: {} })
  expect(await marketOf(io)).toBe('claude-mods')
})

test('version compare is numeric on major.minor.patch', () => {
  expect(isNewer('0.10.0', '0.9.0')).toBe(true)
  expect(isNewer('1.0.0', '1.0.0')).toBe(false)
  expect(isNewer('1.0.0', '1.0.1')).toBe(false)
  expect(isNewer('2.0.0', '1.9.9')).toBe(true)
  expect(isNewer('2.0.0', '')).toBe(false)
})

test('state: on', async () => {
  const row = await rows((await setup()).io)
  expect(row('onmod')).toMatchObject({ key: 'cat:onmod', state: 'on', origin: 'marketplace', enabled: true, canInstall: false, canUpdate: false, modId: 'onmod@claude-mods' })
})

test('state: off', async () => {
  const row = await rows((await setup()).io)
  expect(row('offmod')).toMatchObject({ state: 'off', origin: 'marketplace', enabled: false, canInstall: false, canUpdate: false })
})

test('state: not installed', async () => {
  const row = await rows((await setup()).io)
  expect(row('newmod')).toMatchObject({ state: 'not-installed', origin: null, canInstall: true, canUpdate: false, target: 'newmod@claude-mods', modId: null })
})

test('state: update', async () => {
  const row = await rows((await setup()).io)
  expect(row('upmod')).toMatchObject({ state: 'update', installedVersion: '1.9.9', version: '2.0.0', canUpdate: true, canInstall: false })
})

test('state: folder copy', async () => {
  const row = await rows((await setup()).io)
  expect(row('foldermod')).toMatchObject({ state: 'on', origin: 'dir', canInstall: false, canUpdate: false })
})

test('folder copy is never installed or updated', async () => {
  // The folder copy is switched off and a marketplace copy lags behind: still neither install nor update.
  const { io, files } = setup({ enabledPlugins: { 'foldermod@inline': false, 'foldermod@claude-mods': false } })
  files['/h/.claude/plugins/installed_plugins.json'] = JSON.stringify({
    plugins: { 'foldermod@claude-mods': [{ scope: 'user', installPath: '/cache/fm' }] },
  })
  plugin(files, '/cache/fm', 'foldermod', '0.0.1')
  const row = await rows(io)
  expect(row('foldermod')).toMatchObject({ canInstall: false, canUpdate: false })
  expect(row('foldermod').state).not.toBe('update')
  expect(row('foldermod').state).not.toBe('not-installed')
})

test('a copy from another marketplace is its own origin and gets no install', async () => {
  const { io, files } = setup()
  files['/h/.claude/plugins/installed_plugins.json'] = JSON.stringify({
    plugins: { 'mod-manager@claude-mods': [{ scope: 'user', installPath: '/cache/mm' }], 'newmod@elsewhere': [{ scope: 'user', installPath: '/cache/newmod' }] },
  })
  plugin(files, '/cache/newmod', 'newmod', '1.0.0')
  files['/h/.claude/settings.json'] = JSON.stringify({ enabledPlugins: { 'newmod@elsewhere': true } })
  const row = await rows(io)
  expect(row('newmod')).toMatchObject({ state: 'on', origin: 'other', canInstall: false, canUpdate: false })
})

const refresher = (env: Record<string, string> = {}, startAt = 1_000_000_000) => {
  const { io } = setup()
  const stored = new Map<string, unknown>()
  const ran: string[][] = []
  let clock = startAt
  io.env = async name => env[name]
  io.run = async (argv, timeoutMs) => {
    ran.push([...argv, String(timeoutMs)])
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  io.store = { get: async key => stored.get(key), set: async (key, value) => void stored.set(key, value) }
  io.now = () => clock
  return { io, ran, advance: (ms: number) => void (clock += ms) }
}

test('refresh: once a day', async () => {
  const { io, ran, advance } = refresher()
  expect(await refreshCatalog(io, 'claude-mods')).toBe('ran')
  expect(ran).toEqual([['claude', 'plugin', 'marketplace', 'update', 'claude-mods', '60000']])
  advance(23 * 60 * 60 * 1000)
  expect(await refreshCatalog(io, 'claude-mods')).toBe('throttled')
  advance(2 * 60 * 60 * 1000)
  expect(await refreshCatalog(io, 'claude-mods')).toBe('ran')
  expect(ran.length).toBe(2)
})

test('refresh: a failure is silent and still counts as the day\'s try', async () => {
  const { io, ran } = refresher()
  io.run = async () => Promise.reject(new Error('offline'))
  expect(await refreshCatalog(io, 'claude-mods')).toBe('failed')
  expect(await refreshCatalog(io, 'claude-mods')).toBe('throttled')
  expect(ran.length).toBe(0)
})

const skipped = async (name: string) => {
  const { io, ran } = refresher({ [name]: '1' })
  expect(await refreshCatalog(io, 'claude-mods')).toBe('disabled')
  expect(ran.length).toBe(0)
}

test('refresh: DISABLE_AUTOUPDATER', () => skipped('DISABLE_AUTOUPDATER'))
test('refresh: DISABLE_UPDATES', () => skipped('DISABLE_UPDATES'))
test('refresh: CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', () => skipped('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'))
