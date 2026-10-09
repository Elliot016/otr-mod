// mod-file-tree / tests/file-tree.test.tsx, by v-amorim
// Tests the file log: diff lines, relative paths, rows, turn views and transcript parsing.
import { expect, mock, test, type Mounted, type TestBody } from 'claude-code/testing'

import { cells, cut } from '../hooks/cells'
import { THEME } from '../hooks/theme'
import { TranscriptFiles } from '../hooks/transcript'
import { diffLines, emptyLog, commit, iconOf, relPath, rootOf, rowsOf, touch, turnView } from '../hooks/tree'

type Pointer = { pointer: (event: object) => Promise<unknown> }
// The host types leave `pointer` off a mounted UI.
const pointing = <T extends Mounted>(ui: T) => ui as T & Pointer

const nf = (code: number) => String.fromCodePoint(code)

const PANE = {
  plugin: 'mod-file-tree',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'filetree',
  props: { title: 'Files', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

const SHELL_DIFF = {
  files: [{ filePath: '/w/hooks/meter.tsx', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-old', '+new', '+more'] }] }],
  moreFiles: 1,
  changedFiles: ['/w/hooks/meter.tsx', '/w/hooks/levels.ts'],
}

const isTranscript = (path: string) => path.replace(/\\/g, '/').endsWith('/s1.jsonl')

// `transcript.text` is the session's .jsonl, which a test may grow between events.
const stubs = (on: Parameters<TestBody>[1], opened: string[] = [], transcript = { text: '', reads: 0 }) => {
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({ value: transcript.text ? [{ name: 'p', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.exists', (_$, e) => ({ value: isTranscript(e.path) && transcript.text !== '' }))
  on('fs.stat', (_$, e) => ({ value: { kind: 'file', size: isTranscript(e.path) ? transcript.text.length : 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => {
    if (isTranscript(e.path)) transcript.reads += 1
    return { value: isTranscript(e.path) ? transcript.text : 'one\ntwo\nthree\n' }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  // A shell command answers with the edits Claude Code diffed for it.
  on('tool.call', (_$, e) => ({ result: e.tool === 'Bash' ? { stdout: '', bashEditDiff: SHELL_DIFF } : { text: 'ok' } }) as never)
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

test('cut counts wide characters as two cells and never splits one', () => {
  expect(cells('設定メモ.md')).toBe(11)
  expect(cut('設定メモ.md', 11)).toBe('設定メモ.md')
  expect(cut('設定メモ.md', 7)).toBe('設定メ…')
  expect(cut('設定メモ.md', 6)).toBe('設定…')
})

test('a wide file name keeps its whole name when the row has the cells for it', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/設定メモ.md' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('"設定メモ.md"')
  await ui.unmount()
})

test('a wide file name too long for its cells is cut on a cell boundary', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/設定メモ設定メモ.md' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/設定メモ.md' } as never)
  // Narrow pane: the rows get 20 cells, the open mark takes 4 of them, so a name gets 15.
  const narrow = { ...(PANE as object), props: { ...(PANE as { props: object }).props, bodyColumns: 24 } } as never
  const ui = await $.ui.mount(narrow)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('"設定メモ設定メ…"')
  expect(drawn).not.toContain('設定メモ設定メモ')
  expect(drawn).toContain('"設定メモ.md"')
  await ui.unmount()
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
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-tab' }))).toContain('2')
  expect(await ui.find({ type: 'Text', text: '· Working' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'tab-tree' }))).toContain(' Tree ')
  // The folder without docs/new.md folds; new.md's write landed, so it glows, with no action word and no status letter.
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).not.toContain('creating')
  expect(drawn).not.toContain('"A"')
  expect(drawn).toContain('"backgroundColor":"#252a42"')
  expect(drawn).toContain('▸')
  expect(drawn).not.toContain('a.ts')
  // The folded src/ carries a.ts's counts, so folding hides no change.
  expect(drawn).toContain('"+2"')
  expect(drawn).toContain('" −1"')
  // A folder the person opens stays open while Claude works; a second click folds it again.
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 3, y: 2 })
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('a.ts')
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 3, y: 2 })
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).not.toContain('a.ts')

  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'end_turn' } as never)
  const idle = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(idle).toContain('a.ts')
  expect(idle).toContain('+2')
  expect(idle).toContain('▾')
  expect(idle).not.toContain('creating')
  // No letters: the name's color carries the status, and the footer names the colors.
  expect(idle).not.toContain('"M"')
  expect(await ui.find({ type: 'Text', text: /Modified/ })).toBeDefined()

  // A click on the fourth row (docs, new.md, src, a.ts) opens a.ts in the replay.
  const click = (key: string, y = 0) => pointing(ui).pointer({ in: key, type: 'down', button: 'left', x: 2, y })
  await click('list-0', 3)
  const replay = async () => JSON.stringify(await ui.drawn())
  expect(await ui.find({ type: 'Text', text: '1 of 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/a.ts' })).toBeDefined()
  expect(await replay()).toContain('"x"')
  expect(await replay()).toContain('"y"')
  expect(await replay()).toContain(THEME.addBg)
  expect(await replay()).toContain(THEME.delBg)
  // Prev and Next ride on the section's heading row; the open view's option is its own surface-3 pill.
  expect(JSON.stringify(await ui.find({ key: 'replay-heading-row' }))).toContain('replay-next')
  expect(JSON.stringify(await ui.find({ key: 'tab-replay-chosen-body' }))).toContain(THEME.surface3)
  await click('replay-next')
  expect(await ui.find({ type: 'Text', text: '2 of 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'docs/new.md' })).toBeDefined()
  expect(await replay()).toContain('"hi"')
  await click('replay-prev')
  expect(await ui.find({ type: 'Text', text: '1 of 2' })).toBeDefined()

  // Back in the tree, a click on the src folder's row folds it away.
  await click('tab-tree')
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 4, y: 2 })
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).not.toContain('a.ts')
  await ui.unmount()
})

test('Windows paths outside the working folder draw from their shared folder', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\Users\\A\\.claude\\projects\\p\\memory\\m.md', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\Users\\A\\.claude\\skills\\mb\\refs\\recipes.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-tab' }))).toContain('2')
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('projects/p/memory')
  expect(drawn).not.toContain('Users')
  await ui.unmount()
})

test('a read-only file has no diff to replay', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 2, y: 0 })
  expect(await ui.find({ type: 'Text', text: /only\.md was only read/ })).toBeDefined()
  await ui.unmount()
})

// The commands the mod runs, each answered with the given exit code; `code` is not on PATH here.
const launches = (on: Parameters<TestBody>[1]) => {
  const ran: string[] = []
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    ran.push(argv.join(' '))
    return { value: { exitCode: argv[0] === 'code' ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  return ran
}

test("a file row ends in the open mark; a click on it opens the file instead of the row's diff", async ($, on) => {
  stubs(on)
  const ran = launches(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  const ui = await $.ui.mount(PANE)
  // Safe mode pads the mark inside its surface-3 pill.
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain(`"backgroundColor":"${THEME.surface3}"},"children":[" ↗ "]`)
  // The pane is 70 columns, the rows 66 cells: the mark is the last one.
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 65, y: 0 })
  // VS Code first; without it, the system's opener.
  expect(ran).toEqual(['code /w/only.md', 'open /w/only.md'])
  expect(await ui.find({ type: 'Text', text: /^. Opened only\.md in its default app/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /only\.md was only read/ })).toBeUndefined()
  await ui.unmount()
})

test('a hovered row, end mark, bar option or tab puts its tip in the pane footer, and leaving clears it', async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'x', new_string: 'y' } as never)
  const ui = await $.ui.mount(PANE)
  const footer = (tip: string) => ui.find({ type: 'Text', text: ` · ${tip}` })
  await pointing(ui).pointer({ in: 'list-0', type: 'move', x: 4, y: 0 })
  expect(await footer('replays the edits on this file')).toBeDefined()
  await pointing(ui).pointer({ in: 'list-0', type: 'move', x: 65, y: 0 })
  expect(await footer('opens this file in VS Code')).toBeDefined()
  await pointing(ui).pointer({ in: 'list-0', type: 'move', x: 4, y: 1 })
  expect(await footer('only read, nothing to replay')).toBeDefined()
  await pointing(ui).pointer({ in: 'list-0', type: 'leave', x: 0, y: 0 })
  expect(await footer('only read, nothing to replay')).toBeUndefined()
  await pointing(ui).pointer({ in: 'scope-session', type: 'move', x: 1, y: 0 })
  expect(await footer('files from the whole session')).toBeDefined()
  await pointing(ui).pointer({ in: 'filetree-settings', type: 'move', x: 1, y: 0 })
  expect(await footer('opens this mod\x27s settings')).toBeDefined()
  await ui.unmount()
})

test('a folder row and the footer open their folder in the file manager; a failed start says why', async ($, on) => {
  stubs(on)
  const ran = launches(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/hooks/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/b.ts' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain(' ⊞')
  await pointing(ui).pointer({ in: 'list-0', type: 'down', button: 'left', x: 65, y: 0 })
  expect(await ui.find({ type: 'Text', text: /^. Opened hooks in the file manager/ })).toBeDefined()
  // A click on the mark opens the folder; it does not fold it.
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('a.ts')
  // The footer's mark opens the session's own folder.
  await pointing(ui).pointer({ in: 'session-reveal', type: 'down', button: 'left', x: 1, y: 0 })
  expect(ran).toEqual(['open /w/hooks', 'open /w'])
  expect(await ui.find({ type: 'Text', text: /^. Opened w in the file manager/ })).toBeDefined()
  await ui.unmount()
})

test('an opener that cannot start says why in the status line', async ($, on) => {
  stubs(on)
  on('process.run', () => {
    throw new Error('spawn open ENOENT')
  })
  await $.tool.call({ tool: 'Read', file_path: '/w/hooks/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/b.ts' } as never)
  const ui = await $.ui.mount(PANE)
  await pointing(ui).pointer({ in: 'session-reveal', type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: /Could not open w: \S/ })).toBeDefined()
  await ui.unmount()
})

test('show_reads off hides files Claude only read', { options: { show_reads: false } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/only.md' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('e.md')
  expect(drawn).not.toContain('only.md')
  await ui.unmount()
})

test('icons=nerd leads the kinds and the title with Nerd icons', { options: { icons: 'nerd' } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-tab' }))).toContain(nf(0xeb86))
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain(`${nf(0xe609)} `)
  // The view bar's icons are subpills before the label, the open mark a capped pill at the row's end.
  const replayTab = JSON.stringify(await ui.drawn({ in: 'tab-replay' }))
  expect(replayTab).toContain(nf(0xea82))
  expect(replayTab).toContain(' Replay ')
  const list = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(list).toContain(`"color":"${THEME.accent}","backgroundColor":"${THEME.surface3}"},"children":["↗"]`)
  expect(list).toContain(nf(0xe0b6))
  await ui.unmount()
})

test('a file name takes its status color: added green, modified yellow, read blue', { options: { animations: false } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Write', file_path: '/w/new.md', content: 'hi\n' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/r.md' } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('"color":"#49EF95"},"children":["new.md"]')
  expect(drawn).toContain('"color":"#FFCB6B"},"children":["e.md"]')
  expect(drawn).toContain('"color":"#B9C6F5"},"children":["r.md"]')
  await ui.unmount()
})

test('icons=safe draws no Nerd glyph', { options: { icons: 'safe' } }, async ($, on) => {
  stubs(on)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-tab' }))).toContain('▸')
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('e.md')
  expect(await ui.find({ type: 'Text', text: /Modified/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u)
  await ui.unmount()
})

test('the settings pane shows the mod settings and its clear action', async ($, on) => {
  stubs(on)
  on('config.list', () => ({
    value: [
      { key: 'mod-file-tree.show_reads', label: 'Show files Claude only read', kind: 'boolean', value: true, description: 'd' },
    ],
  }) as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/e.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount({ ...(PANE as object), requestId: 'filetree-settings' } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-settings' }))).toContain('Settings')
  expect(await ui.find({ type: 'Text', text: 'Show files Claude only read' })).toBeDefined()
  await ui.unmount()
})

test('the title row pill swaps the panel for its settings and back', async ($, on) => {
  const opened: string[] = []
  stubs(on, opened)
  on('config.list', () => ({ value: [] }) as never)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-settings' }))).toContain('Settings')
  await pointing(ui).pointer({ in: 'filetree-settings', type: 'down', button: 'left', x: 1, y: 0 })
  expect(opened).toEqual(['filetree-settings'])
  await ui.unmount()

  const settings = await $.ui.mount({ ...(PANE as object), requestId: 'filetree-settings' } as never)
  expect(JSON.stringify(await settings.drawn({ in: 'filetree-tab' }))).toContain('Files')
  await pointing(settings).pointer({ in: 'filetree-tab', type: 'down', button: 'left', x: 1, y: 0 })
  expect(opened).toEqual(['filetree-settings', 'filetree'])
  await settings.unmount()
})

test('the live action word sits in its own pill', async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/live.ts' } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('"color":"#CED9FF","backgroundColor":"#3A3F5C"},"children":["reading"]')
  await ui.unmount()
})

test('the Files pill opens the pane from the band', async ($, on) => {
  const opened: string[] = []
  stubs(on, opened)
  on('state.get', () => ({ value: false, version: 0 }) as never)
  const band = await $.ui.mount({
    plugin: 'mod-file-tree',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as never)
  expect(JSON.stringify(await band.drawn({ in: 'menu-entry-filetree' }))).toContain('Files')
  await pointing(band).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'menu-entry-filetree' } as never)
  expect(opened).toContain('filetree')
  await band.unmount()
})

// Transcript rows as Claude Code writes them: a prompt, tool uses, and their results with the stored patch.
let uuid = 0
const jrow = (fields: object) => JSON.stringify({ uuid: `u${(uuid += 1)}`, ...fields })
const prompt = (text: string) => jrow({ type: 'user', message: { role: 'user', content: text } })
const use = (id: string, name: string, input: object) => jrow({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const result = (id: string, toolUseResult: object = {}, isError = false) =>
  jrow({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] }, toolUseResult })
const PATCH = { structuredPatch: [{ lines: [' keep', '-old', '+new', '+more'] }] }

const SESSION = [
  prompt('fix the parser'),
  use('t-read', 'Read', { file_path: 'C:\\repo\\src\\a.ts' }),
  result('t-read'),
  use('t-edit', 'Edit', { file_path: 'C:\\repo\\src\\a.ts', old_string: 'old', new_string: 'new\nmore' }),
  result('t-edit', PATCH),
  use('t-bad', 'Edit', { file_path: 'C:\\repo\\src\\b.ts', old_string: 'x', new_string: 'y' }),
  result('t-bad', {}, true),
  prompt('now the docs'),
  use('t-write', 'Write', { file_path: 'C:\\repo\\docs\\new.md', content: 'one\ntwo\n' }),
  result('t-write', { type: 'create', content: 'one\ntwo\n' }),
  '',
].join('\n')

test('the transcript rebuilds every file and edit: the stored patch, a new file, and no step for a failed edit', () => {
  const parsed = new TranscriptFiles('C:\\repo')
  for (const line of SESSION.split('\n')) if (line) parsed.feed(line)
  const log = parsed.log
  expect(log.turn).toBe(2)
  expect(log.files.map(file => `${file.path}:${file.kind}:+${file.add}-${file.del}`)).toEqual(['src/a.ts:edit:+2-1', 'src/b.ts:edit:+0-0', 'docs/new.md:new:+2-0'])
  expect(log.steps.map(step => `${step.turn} ${step.tool} ${step.path} ${step.note}`)).toEqual(['1 Edit src/a.ts ', '2 Write docs/new.md new file'])
  expect(log.steps[0]!.lines.map(line => `${line.op}${line.t}`)).toEqual([' keep', '-old', '+new', '+more'])
  expect(turnView(log).files.map(file => file.path)).toEqual(['docs/new.md'])
})

test('a resumed session, with nothing in $.state, shows the files from its transcript', async ($, on) => {
  const transcript = { text: SESSION.replace(/C:\\\\repo/g, '/w'), reads: 0 }
  stubs(on, [], transcript)
  const ui = await $.ui.mount(PANE)
  // This turn is the default view; Session shows the whole transcript.
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).not.toContain('a.ts')
  await pointing(ui).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'scope-session' } as never)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('a.ts')
  expect(drawn).toContain('new.md')
  expect(drawn).toContain('+2')
  await ui.unmount()
})

test('the transcript is read once; later calls add on top, and the transcript growing does not re-read it', async ($, on) => {
  const transcript = { text: [prompt('first'), use('t-old', 'Edit', { file_path: '/w/old.ts', old_string: 'a', new_string: 'b' }), result('t-old', PATCH), ''].join('\n'), reads: 0 }
  stubs(on, [], transcript)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/fresh.ts', old_string: 'x\n', new_string: 'y\n' } as never)
  transcript.text += [prompt('second'), use('t-fresh', 'Edit', { file_path: '/w/fresh.ts', old_string: 'x\n', new_string: 'y\n' }), result('t-fresh', PATCH), ''].join('\n')
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'ok', isAborted: false } as never)
  expect(transcript.reads).toBe(1)

  const ui = await $.ui.mount(PANE)
  const turn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(turn).toContain('fresh.ts')
  expect(turn).not.toContain('old.ts')
  await pointing(ui).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'scope-session' } as never)
  expect(JSON.stringify(await ui.drawn({ in: 'filetree-tab' }))).toContain('2')
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' })).match(/fresh\.ts/g)).toHaveLength(1)
  await ui.unmount()
})

test('a session with many files draws in several lists, and a click in a later one opens the right file', async ($, on) => {
  const reads = Array.from({ length: 150 }, (_, n) => [use(`t-${n}`, 'Read', { file_path: `/w/f${String(n).padStart(3, '0')}.ts` }), result(`t-${n}`)]).flat()
  const transcript = { text: [prompt('read them all'), ...reads, use('t-edit', 'Edit', { file_path: '/w/f145.ts', old_string: 'a', new_string: 'b' }), result('t-edit', PATCH), ''].join('\n'), reads: 0 }
  stubs(on, [], transcript)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'list-3' }))).toContain('f145.ts')
  // A click reports its row within that list, and the list adds its offset into the whole tree.
  await pointing(ui).pointer({ type: 'down', x: 2, y: 145 - 3 * 40, button: 'left', in: 'list-3' } as never)
  expect(await ui.find({ type: 'Text', text: /Replaying f145\.ts/ })).toBeDefined()
  await ui.unmount()
})

test('a shell command shows the files it changed: diffed ones with their lines, the rest by name', async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: "node -e \"fs.writeFileSync('hooks/meter.tsx', ...)\"" } as never)
  // Once the turn ends no row shimmers, so each name is one Text again.
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'ok', isAborted: false } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('meter.tsx')
  expect(drawn).toContain('levels.ts')
  expect(drawn).toContain('"+2"')
  await ui.unmount()

  const parsed = new TranscriptFiles('/w')
  for (const line of [prompt('edit it'), use('t-sh', 'Bash', { command: 'sed -i s/a/b/ x' }), result('t-sh', { stdout: '', bashEditDiff: SHELL_DIFF })]) parsed.feed(line)
  expect(parsed.log.files.map(file => `${file.path}:+${file.add}-${file.del}`)).toEqual(['hooks/meter.tsx:+2-1', 'hooks/levels.ts:+0-0'])
  expect(parsed.log.steps.map(step => `${step.tool} ${step.note}`)).toEqual(['Bash shell', 'Bash shell, no diff kept'])
})

test('the recent view keeps the files of the last N turns, N from the recent_turns setting', { options: { recent_turns: 2 } }, async ($, on) => {
  const transcript = {
    text: [
      prompt('long ago'),
      use('t-1', 'Edit', { file_path: '/w/old.ts', old_string: 'a', new_string: 'b' }),
      result('t-1', PATCH),
      prompt('recent'),
      use('t-2', 'Edit', { file_path: '/w/recent.ts', old_string: 'a', new_string: 'b' }),
      result('t-2', PATCH),
      prompt('now'),
      use('t-3', 'Read', { file_path: '/w/now.ts' }),
      result('t-3'),
      '',
    ].join('\n'),
    reads: 0,
  }
  stubs(on, [], transcript)
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify(await ui.drawn({ in: 'scope-recent' }))).toContain('Last 2 turns')
  await pointing(ui).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'scope-recent' } as never)
  const recent = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(recent).toContain('recent.ts')
  expect(recent).toContain('now.ts')
  expect(recent).not.toContain('old.ts')
  await ui.unmount()
})

test('the file Claude is on shimmers: its name draws a letter at a time, in a band that sweeps across', async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/live.ts' } as never)
  const ui = await $.ui.mount(PANE)
  const lettersOf = async () => JSON.stringify(await ui.drawn({ in: 'list-0' })).match(/"children":\["[a-z.]"\]/g)?.length ?? 0
  expect(await lettersOf()).toBe('live.ts'.length)
  // The live row sits on its own band, Moonlight surface-3.
  expect(JSON.stringify(await ui.drawn({ in: 'list-0' }))).toContain('#252A42')
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'ok', isAborted: false } as never)
  expect(await lettersOf()).toBe(0)
  await ui.unmount()
})

test('animations off: the file Claude is on draws whole, without the shimmer', { options: { animations: false } }, async ($, on) => {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/live.ts' } as never)
  const ui = await $.ui.mount(PANE)
  const drawn = JSON.stringify(await ui.drawn({ in: 'list-0' }))
  expect(drawn).toContain('"live.ts"')
  expect(drawn).toContain('#252A42')
  await ui.unmount()
})

test('clear hides what came before it, though the transcript still holds it', async ($, on) => {
  const transcript = { text: SESSION.replace(/C:\\\\repo/g, '/w'), reads: 0 }
  stubs(on, [], transcript)
  await $.command.run({ command: 'mod-file-tree', args: 'clear' } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^No files touched yet/ })).toBeDefined()
  await ui.unmount()
})

test('session.start registers the command and /mod-file-tree toggles the pane', async ($, on) => {
  const opened: string[] = []
  const registered: string[] = []
  stubs(on, opened)
  on('session.start', () => ({ cwd: '/w' }) as never)
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '/w' } as never)
  expect(registered).toEqual(['mod-file-tree'])
  await $.command.run({ command: 'mod-file-tree', args: 'settings' } as never)
  expect(opened).toEqual(['filetree-settings'])
})
