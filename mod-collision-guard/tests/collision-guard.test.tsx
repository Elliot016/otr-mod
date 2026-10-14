// mod-collision-guard / tests/collision-guard.test.tsx, by v-amorim
// Tests conflict detection across sessions, the time window, the proceed dialog and clearing edits.
import { expect, mock, test } from 'claude-code/testing'

const NOW = 1_800_000_000_000
const MIN = 60000
const DIR = '/h/.claude/mods-data/mod-collision-guard/sessions'
const FILE = '/work/app.ts'

// The engine rewrites paths in the host's style, so compare on a neutral form.
const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const edit = (session: string, minutesAgo: number, path = FILE) => JSON.stringify([{ path, session, at: NOW - minutesAgo * MIN }])

// An in-memory disk, the session id, the clock, and a bottom tool.call that answers the dialog and runs edits.
function world(on: any, files: Record<string, string>, answerWith: string | (() => never) = 'Proceed') {
  const asked: { question: string; options: string[] }[] = []
  const ran: string[] = []
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (path.endsWith('/showcase.json')) return { value: JSON.stringify({ actions: [{ label: "Forget this session's recorded edits", command: 'mod-collision-guard', args: 'clear' }] }) }
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', () => ({ value: Object.keys(files).filter(path => path.startsWith(`${DIR}/`)).map(path => ({ name: path.slice(DIR.length + 1), kind: 'file', size: 0, mtimeMs: 0, isLink: false })) }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('session.id', () => ({ value: 'mine' }))
  mock.clock(on, { now: NOW })
  on('tool.call', (_$: unknown, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      const [q] = e.questions
      asked.push({ question: q.question, options: q.options.map((o: { label: string }) => o.label) })
      if (typeof answerWith === 'function') answerWith()
      return { result: { answers: { [q.question]: answerWith } } }
    }
    ran.push(`${e.tool} ${e.file_path ?? e.notebook_path}`)
    return { result: { text: 'ok' } }
  })
  return { files, asked, ran }
}

const call = ($: any, tool = 'Edit', path = FILE) => $.tool.call(tool === 'NotebookEdit' ? { tool, notebook_path: path, new_source: 'x' } : { tool, file_path: path, old_string: 'a', new_string: 'b', content: 'b' })

const denied = (result: any) => String(result?.deny ?? result?.text ?? JSON.stringify(result))

test('no conflict passes through, asks nothing, and records the edit', async ($, on) => {
  const w = world(on, {})
  await call($)
  expect(w.asked).toEqual([])
  expect(w.ran).toEqual([`Edit ${FILE}`])
  expect(JSON.parse(w.files[`${DIR}/mine.json`]!)[0]).toMatchObject({ path: FILE, session: 'mine', at: NOW })
})

test('own-session edits never trigger', async ($, on) => {
  const w = world(on, { [`${DIR}/mine.json`]: edit('mine', 1) })
  await call($)
  await call($, 'Write')
  expect(w.asked).toEqual([])
  expect(w.ran).toHaveLength(2)
})

test('another session editing a different file does not trigger', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 1, '/work/other.ts') })
  await call($)
  expect(w.asked).toEqual([])
})

test('other-session recent edit asks, with relative and clock time and the four ways out', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 4) })
  await call($)
  expect(w.asked).toHaveLength(1)
  expect(w.asked[0]!.question).toMatch(/^Another open session edited \/work\/app\.ts 4 min ago \(\d\d:\d\d\)\. Edit it anyway\?$/)
  expect(w.asked[0]!.options).toEqual(['Proceed', 'Move to a worktree', 'Cancel'])
})

test('a corrupt log file is ignored and never blocks the edit', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: '{ not json', [`${DIR}/mine.json`]: '][' })
  await call($)
  expect(w.ran).toEqual([`Edit ${FILE}`])
})

test('NotebookEdit and Windows spellings of the path collide too', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 2, 'C:\\Work\\Nb.ipynb') })
  await call($, 'NotebookEdit', 'c:/work/nb.ipynb')
  expect(w.asked).toHaveLength(1)
})

test('Proceed runs the edit and records it', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 4) }, 'Proceed')
  await call($)
  expect(w.ran).toEqual([`Edit ${FILE}`])
  expect(JSON.parse(w.files[`${DIR}/mine.json`]!)).toHaveLength(1)
})

test('Move to a worktree denies with an EnterWorktree instruction', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 4) }, 'Move to a worktree')
  const result = await call($)
  expect(w.ran).toEqual([])
  expect(denied(result)).toMatch(/EnterWorktree/)
  expect(denied(result)).toMatch(/redo this edit there/)
})

test('Cancel denies and the edit does not run or get recorded', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 4) }, 'Cancel')
  const result = await call($)
  expect(w.ran).toEqual([])
  expect(denied(result)).toMatch(/cancelled/)
  expect(w.files[`${DIR}/mine.json`]).toBeUndefined()
})

test('Custom text goes back to Claude as the deny reason', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 4) }, 'wait for the other session to finish')
  const result = await call($)
  expect(w.ran).toEqual([])
  expect(denied(result)).toMatch(/The user says: wait for the other session to finish/)
})

test('old entries are ignored', async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 31) })
  await call($)
  expect(w.asked).toEqual([])
  expect(w.ran).toHaveLength(1)
})

test('window_minutes widens the window', { options: { window_minutes: 60 } }, async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 45) })
  await call($)
  expect(w.asked).toHaveLength(1)
})

test('enabled=false never asks but still records', { options: { enabled: false } }, async ($, on) => {
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 1) })
  await call($)
  expect(w.asked).toEqual([])
  expect(JSON.parse(w.files[`${DIR}/mine.json`]!)).toHaveLength(1)
})

test('recording prunes own entries older than the window', async ($, on) => {
  const w = world(on, { [`${DIR}/mine.json`]: edit('mine', 90, '/work/old.ts') })
  await call($)
  expect(JSON.parse(w.files[`${DIR}/mine.json`]!).map((item: { path: string }) => item.path)).toEqual([FILE])
})

test('session.end empties the session log, and clear does the same on request', async ($, on) => {
  const w = world(on, {})
  on('command.register', () => ({ value: undefined }) as never)
  on('session.end', () => ({ sessionId: 'mine' }))
  await call($)
  expect(JSON.parse(w.files[`${DIR}/mine.json`]!)).toHaveLength(1)
  await $.session.end({ sessionId: 'mine' } as never)
  expect(w.files[`${DIR}/mine.json`]).toBe('[]')

  await call($)
  await $.command.run({ command: 'mod-collision-guard', args: 'clear' } as never)
  expect(w.files[`${DIR}/mine.json`]).toBe('[]')
})

const paneOf = async ($: any, on: any) => {
  world(on, {})
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({
    value: [{ key: 'mod-collision-guard.enabled', label: 'Guard edits', description: 'd', kind: 'boolean', value: true, isLocked: false }],
  }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-collision-guard', args: 'settings' })

  return $.ui.mount({
    plugin: 'mod-collision-guard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'collision-guard',
    props: { title: 'Collision Guard', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
}

const PILL_CAP = new RegExp(String.fromCodePoint(0xe0b6))

test('its settings pane draws the heading, a setting and the action', async ($, on) => {
  const ui = await paneOf($, on)
  expect(JSON.stringify(await ui.drawn({ in: 'mod-collision-guard-settings-tab' }))).toContain('Collision guard · Settings')
  expect(await ui.find({ type: 'Text', text: /^Guard edits$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Forget this session's recorded edits/ })).toBeDefined()
  await ui.unmount()
})

test('icons=nerd draws Nerd controls and pill headings', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await paneOf($, on)
  // On/off is one value pill, rounded where the font has the caps.
  expect(JSON.stringify(await ui.drawn({ in: 'setting-0-flip' }))).toContain('On')
  expect(await ui.find({ type: 'Text', text: PILL_CAP })).toBeDefined()
  await ui.unmount()
})

test('icons=safe keeps the common Unicode glyphs and plain headings', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await paneOf($, on)
  // The safe cycle glyph drops its brackets inside the pill.
  expect(JSON.stringify(await ui.drawn({ in: 'setting-0-flip' }))).toContain('On ↻')
  expect(await ui.find({ type: 'Text', text: PILL_CAP })).toBeUndefined()
  await ui.unmount()
})

test('a control tip posted to the mod reaches the pane footer, and clears on leave', async ($, on) => {
  const ui = await paneOf($, on)
  expect(await ui.find({ type: 'Text', text: /Shows this view/ })).toBeUndefined()
  await ui.post({ type: 'tip', id: 'x', glyph: '>', label: 'Guard edits', text: 'Shows this view' }, { in: 'setting-0-flip' })
  expect((await ui.find({ type: 'Text', text: /Shows this view/ }))?.text).toContain('Shows this view')
  await ui.post({ type: 'tip', id: null }, { in: 'setting-0-flip' })
  expect(await ui.find({ type: 'Text', text: /Shows this view/ })).toBeUndefined()
  await ui.unmount()
})

test('a pause raises one notification naming the file, and a refused one does not break the pause', async ($, on) => {
  const notes: { text: string; title?: string }[] = []
  on('ui.notify', (_$: unknown, e: { text: string; title?: string }) => {
    notes.push(e)
    throw new Error('refused')
  })
  const w = world(on, { [`${DIR}/other.json`]: edit('other', 4) })
  await call($)
  expect(notes).toHaveLength(1)
  expect(notes[0]!.text).toContain('app.ts')
  expect(notes[0]!.text).not.toContain('/work/')
  expect(w.asked).toHaveLength(1)
  expect(w.ran).toEqual([`Edit ${FILE}`])
})
