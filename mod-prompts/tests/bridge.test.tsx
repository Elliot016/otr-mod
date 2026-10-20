// mod-prompts / tests/bridge.test.tsx, by v-amorim: the bridge hands a session's command hook records to the mod.
import { expect, mock, test } from 'claude-code/testing'

import { lastOfEach } from '../hooks/bridge'

const DIR = '/home/u/.claude/mods-data/mod-prompts/bridge'
const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const record = (session: string, path: string, event = 'SessionStart') => `${JSON.stringify({ session_id: session, transcript_path: path, hook_event_name: event, source: 'startup' })}\n`

// Bridge files by name; `w.session` is the id the engine answers; `sets` logs each transcript key the mod stored.
function world(on: any, files: Record<string, string>) {
  const w = { session: 's1', files, sets: [] as string[], unreadable: false }
  on('session.start', () => ({ cwd: '/w' }))
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('command.register', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_$: unknown, e: { key: string; value: { path: string } }) => {
    if (e.key.startsWith('transcript:')) w.sets.push(`${e.key}=${e.value.path}`)
    return { value: undefined }
  })
  on('session.id', () => ({ value: w.session }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = plain(e.path)
    const name = path.slice(DIR.length + 1)
    if (path.startsWith(DIR)) {
      if (w.unreadable || !(name in w.files)) throw new Error('ENOENT')
      return { value: w.files[name] }
    }
    return { value: '' }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, { USERPROFILE: '/home/u' })
  return { w, clock: mock.clock(on) }
}

const start = ($: any) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)

test('only the own session\'s file is read', async ($, on) => {
  const { w, clock } = world(on, { 's1.jsonl': record('s1', '/t/own.jsonl'), 's2.jsonl': record('s2', '/t/other.jsonl') })
  await start($)
  await clock.advance(1000)
  expect(w.sets).toEqual(['transcript:s1=/t/own.jsonl'])
})

test('a record is delivered once however many polls pass, a new line arrives alone, a half-written line waits for its newline', async ($, on) => {
  const { w, clock } = world(on, { 's1.jsonl': record('s1', '/t/a.jsonl') })
  await start($)
  await clock.advance(2000)
  expect(w.sets).toEqual(['transcript:s1=/t/a.jsonl'])
  w.files['s1.jsonl'] += record('s1', '/t/b.jsonl')
  await clock.advance(1000)
  expect(w.sets).toEqual(['transcript:s1=/t/a.jsonl', 'transcript:s1=/t/b.jsonl'])
  w.files['s1.jsonl'] += '{"session_id":"s1","hook_event_name":"SessionStart","transcript_path":"/t/c.jsonl"}'
  await clock.advance(1000)
  expect(w.sets).toHaveLength(2)
  w.files['s1.jsonl'] += '\n'
  await clock.advance(1000)
  expect(w.sets.at(-1)).toBe('transcript:s1=/t/c.jsonl')
  expect(w.sets).toHaveLength(3)
})

test('a missing, unreadable or corrupt file never throws, and the poll goes on', async ($, on) => {
  const { w, clock } = world(on, {})
  await start($)
  await clock.advance(1000)
  expect(w.sets).toEqual([])
  w.files['s1.jsonl'] = `not json\n[1,2]\n"text"\n{"hook_event_name":"SessionStart"}\n${record('s1', '/t/ok.jsonl')}`
  w.unreadable = true
  await clock.advance(1000)
  expect(w.sets).toEqual([])
  w.unreadable = false
  await clock.advance(1000)
  expect(w.sets).toEqual(['transcript:s1=/t/ok.jsonl'])
})

test('a /clear switches to the new session\'s file, and the ended session\'s last rows are drained', async ($, on) => {
  const { w, clock } = world(on, { 's1.jsonl': record('s1', '/t/one.jsonl') })
  await start($)
  await clock.advance(500)
  expect(w.sets).toEqual(['transcript:s1=/t/one.jsonl'])
  w.files['s1.jsonl'] += record('s1', '/t/one-more.jsonl')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  w.session = 's2'
  w.files['s2.jsonl'] = record('s2', '/t/two.jsonl')
  await clock.advance(500)
  expect(w.sets).toEqual(['transcript:s1=/t/one.jsonl', 'transcript:s1=/t/one-more.jsonl', 'transcript:s2=/t/two.jsonl'])
})

test('a bridge that starts on a file with history delivers only the last record of each event', async ($, on) => {
  // The mod sees only SessionStart, so its store holds the last one alone.
  const { w, clock } = world(on, { 's1.jsonl': record('s1', '/t/startup.jsonl') + record('s1', '/t/clear.jsonl') + record('s1', '', 'Stop') + record('s1', '', 'Stop') })
  await start($)
  await clock.advance(1000)
  expect(w.sets).toEqual(['transcript:s1=/t/clear.jsonl'])
})

// The folders the bridge opened when the env holds `env`.
async function foldersFor($: any, on: any, env: Record<string, string>) {
  const opened: string[] = []
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    opened.push(e.path.replace(/\\/g, '/'))
    throw new Error('ENOENT')
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('ui.panes', () => ({ value: [] }))
  mock.env(on, env)
  const clock = mock.clock(on)
  await start($)
  await clock.advance(500)
  return [...new Set(opened.filter(path => path.includes('/bridge/')).map(path => path.slice(0, path.indexOf('/bridge/'))))]
}

test('the bridge reads under HOME when HOME and USERPROFILE differ, where the command hooks write', async ($, on) => {
  expect((await foldersFor($, on, { HOME: '/home/h', USERPROFILE: '/home/u' })).map(plain)).toEqual(['/home/h/.claude/mods-data/mod-prompts'])
})

// Off Windows the test kit opens a drive path as relative to the mod folder, so the folder starts at the drive.
const fromDrive = (path: string) => path.slice(Math.max(0, path.search(/[A-Za-z]:\//)))

test('with only USERPROFILE set the bridge reads under USERPROFILE, a backslash path with its slashes turned', async ($, on) => {
  expect((await foldersFor($, on, { USERPROFILE: 'C:\\Users\\u\\' })).map(fromDrive)).toEqual(['C:/Users/u/.claude/mods-data/mod-prompts'])
})

test('a Git Bash HOME such as /c/Users/h is opened as C:/Users/h', async ($, on) => {
  expect((await foldersFor($, on, { HOME: '/c/Users/h', USERPROFILE: 'D:\\x' })).map(fromDrive)).toEqual(['C:/Users/h/.claude/mods-data/mod-prompts'])
})

test('CLAUDE_CONFIG_DIR is used before HOME and USERPROFILE', async ($, on) => {
  expect((await foldersFor($, on, { CLAUDE_CONFIG_DIR: '/cfg/', HOME: '/home/h', USERPROFILE: '/home/u' })).map(plain)).toEqual(['/cfg/mods-data/mod-prompts'])
})

test('the replay keeps one record per event, the last, in file order', () => {
  const rows = [
    { hook_event_name: 'SessionStart', n: 1 },
    { hook_event_name: 'SessionStart', n: 2 },
    { hook_event_name: 'Stop', n: 3 },
    { hook_event_name: 'Stop', n: 4 },
  ]
  expect(lastOfEach(rows).map(row => row.n)).toEqual([2, 4])
})
