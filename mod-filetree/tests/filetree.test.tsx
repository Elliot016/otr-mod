import { expect, mock, test } from 'claude-code/testing'

import { THEME } from '../hooks/theme'
import { diffLines, emptyLog, commit, iconOf, relPath, rootOf, rowsOf, touch } from '../hooks/tree'

const nf = (code: number) => String.fromCodePoint(code)

const PANE = {
  plugin: 'mod-filetree',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'filetree',
  props: { title: 'Files', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

const stubs = (on: Parameters<Parameters<typeof test>[1]>[1], opened: string[] = []) => {
  on('session.cwd', () => ({ value: '/w' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: 'one\ntwo\nthree\n' }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('tool.call', () => ({ result: { text: 'ok' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))
  mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
}

test('relPath keeps paths inside the working folder relative and others whole', () => {
  expect(relPath('C:\\repo', 'C:\\repo\\src\\a.ts')).toBe('src/a.ts')
  expect(relPath('/w/', '/w/a.ts')).toBe('a.ts')
  expect(relPath('/w', '/x/a.ts')).toBe('/x/a.ts')
})

test('diffLines marks added and removed lines and keeps one line of context', () => {
  const lines = diffLines('a\nb\nc\nd\ne\nf\n', 'a\nb\nC\nd\ne\nf\n')
  expect(lines.filter(line => line.op !== ' ').map(line => `${line.op}${line.t}`)).toEqual(['-c', '+C'])
  expect(lines.some(line => line.op === '~')).toBe(false)
  expect(diffLines('', 'x\ny\n').map(line => line.op)).toEqual(['+', '+'])
})

test('the tree lists folders first, folds one, and hides reads when asked', () => {
  let log = touch(emptyLog(), 'src/a.ts', 'edit')
  log = commit(log, 'src/a.ts', 'Edit', 'edit', '', diffLines('x\n', 'y\nz\n'))
  log = touch(log, 'src/b.ts', 'read')
  log = touch(log, 'top.md', 'new')
  expect(rowsOf(log, [], true).map(row => `${row.depth}${row.isDir ? 'd' : 'f'}:${row.name}`)).toEqual(['0d:src', '1f:a.ts', '1f:b.ts', '0f:top.md'])
  expect(rowsOf(log, ['src'], true).map(row => row.name)).toEqual(['src', 'top.md'])
  expect(rowsOf(log, [], false).map(row => row.name)).toEqual(['src', 'a.ts', 'top.md'])
  expect(log.files.find(file => file.path === 'src/a.ts')).toMatchObject({ add: 2, del: 1, kind: 'edit' })
})

test('the tree starts at the shared folder and merges single-folder chains, like VS Code', () => {
  let log = touch(emptyLog(), 'C:/Users/A/.claude/projects/p/memory/m.md', 'edit')
  log = touch(log, 'C:/Users/A/.claude/skills/mb/refs/r.md', 'new')
  expect(rootOf(log, true)).toBe('C:/Users/A/.claude')
  expect(rowsOf(log, [], true).map(row => `${row.depth}${row.isDir ? 'd' : 'f'}:${row.name}`)).toEqual(['0d:projects/p/memory', '1f:m.md', '0d:skills/mb/refs', '1f:r.md'])
  expect(rowsOf(log, ['C:/Users/A/.claude/projects/p/memory'], true).map(row => row.name)).toEqual(['projects/p/memory', 'skills/mb/refs', 'r.md'])
  expect([iconOf('a.tsx'), iconOf('b.JSON'), iconOf('LICENSE')]).toEqual(['ext-react', 'ext-json', 'file'])
})

test('tool calls fill the tree live, a click opens the diff in the replay, Prev and Next step', async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'x\n', new_string: 'y\nz\n' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/w/docs/new.md', content: 'hi\n' } as never)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '▸ Files · 2 · working' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'tab-tree' }))).toContain(' Tree ')
  const drawn = JSON.stringify(await ui.drawn({ in: 'list' }))
  expect(drawn).toContain('a.ts')
  expect(drawn).toContain('+2')
  expect(drawn).toContain('creating')
  expect(drawn).toContain('▾')

  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'end_turn' } as never)
  const idle = JSON.stringify(await ui.drawn({ in: 'list' }))
  expect(idle).not.toContain('creating')
  expect(idle).toContain('"A"')
  expect(idle).toContain('"M"')

  // A click on the fourth row (docs, new.md, src, a.ts) opens a.ts in the replay.
  const click = (key: string, y = 0) => ui.pointer({ in: key, type: 'down', button: 'left', x: 2, y })
  await click('list', 3)
  const replay = async () => JSON.stringify(await ui.drawn())
  expect(await ui.find({ type: 'Text', text: '1 of 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/a.ts' })).toBeDefined()
  expect(await replay()).toContain('"x"')
  expect(await replay()).toContain('"y"')
  expect(await replay()).toContain(THEME.addBg)
  expect(await replay()).toContain(THEME.delBg)
  await click('replay-next')
  expect(await ui.find({ type: 'Text', text: '2 of 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'docs/new.md' })).toBeDefined()
  expect(await replay()).toContain('"hi"')
  await click('replay-prev')
  expect(await ui.find({ type: 'Text', text: '1 of 2' })).toBeDefined()

  // Back in the tree, a click on the src folder's row folds it away.
  await click('tab-tree')
  await ui.pointer({ in: 'list', type: 'down', button: 'left', x: 4, y: 2 })
  expect(JSON.stringify(await ui.drawn({ in: 'list' }))).not.toContain('a.ts')
  await ui.unmount()
})

test('Windows paths outside the working folder draw from their shared folder', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\Users\\A\\.claude\\projects\\p\\memory\\m.md', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\Users\\A\\.claude\\skills\\mb\\refs\\recipes.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '▸ Files · 2' })).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn({ in: 'list' }))
  expect(drawn).toContain('projects/p/memory')
  expect(drawn).not.toContain('Users')
  await ui.unmount()
})

test('a read-only file has no diff to replay', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  const ui = await $.ui.mount(PANE)
  await ui.pointer({ in: 'list', type: 'down', button: 'left', x: 2, y: 0 })
  expect(await ui.find({ type: 'Text', text: /only\.md was only read/ })).toBeDefined()
  await ui.unmount()
})

test('show_reads off hides files Claude only read', { options: { show_reads: false } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list' }))
  expect(drawn).toContain('e.md')
  expect(drawn).not.toContain('only.md')
  await ui.unmount()
})

test('icons=nerd leads the kinds and the title with Nerd icons', { options: { icons: 'nerd' } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: `${nf(0xeb86)} Files · 1` })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'list' }))).toContain(`${nf(0xe609)} `)
  expect(JSON.stringify(await ui.drawn({ in: 'tab-replay' }))).toContain(`${nf(0xea82)} Replay`)
  await ui.unmount()
})

test('icons=safe draws no Nerd glyph', { options: { icons: 'safe' } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '▸ Files · 1' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'list' }))).toContain('"M"')
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u)
  await ui.unmount()
})

test('the settings pane shows the mod settings and its clear action', async ($, on) => {
  stubs(on)
  on('config.list', () => ({
    value: [
      { key: 'mod-filetree.show_reads', label: 'Show files Claude only read', kind: 'boolean', value: true, description: 'd' },
    ],
  }) as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount({ ...(PANE as object), requestId: 'filetree-settings' } as never)
  expect(await ui.find({ type: 'Text', text: '▸ mod-filetree · settings' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Show files Claude only read' })).toBeDefined()
  await ui.unmount()
})

test('the Files pill opens the pane from the band', async ($, on) => {
  const opened: string[] = []
  stubs(on, opened)
  on('state.get', () => ({ value: false, version: 0 }) as never)
  const band = await $.ui.mount({
    plugin: 'mod-filetree',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as never)
  expect(JSON.stringify(await band.drawn({ in: 'menu-entry-filetree' }))).toContain(' Files ')
  await band.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-filetree' } as never)
  expect(opened).toContain('filetree')
  await band.unmount()
})

test('session.start registers the command and /mod-filetree toggles the pane', async ($, on) => {
  const opened: string[] = []
  const registered: string[] = []
  stubs(on, opened)
  mock.env(on, {})
  on('session.start', () => ({ cwd: '/w' }) as never)
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '/w' } as never)
  expect(registered).toEqual(['mod-filetree'])
  await $.command.run({ command: 'mod-filetree', args: 'settings' })
  expect(opened).toEqual(['filetree-settings'])
})
