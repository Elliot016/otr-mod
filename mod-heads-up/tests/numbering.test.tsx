// mod-heads-up / tests/numbering.test.tsx, by v-amorim
// Tests prompt numbering across a transcript branch as the panel shows it.
import { expect, mock, test } from 'claude-code/testing'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TRANSCRIPT = '/home/u/.claude/projects/p/s1.jsonl'

const user = (n: number, parent: number | null, text: string) =>
  JSON.stringify({ type: 'user', uuid: ID(n), parentUuid: parent === null ? null : ID(parent), message: { role: 'user', content: text } })
const said = (n: number, parent: number, text: string) =>
  JSON.stringify({ type: 'assistant', uuid: ID(n), parentUuid: ID(parent), message: { role: 'assistant', content: [{ type: 'text', text }] } })

// Row 1 is the first prompt. Row 3 is a prompt /rewind dropped: rows 5 and 6 continue from row 2, not from row 4.
const TRANSCRIPT_TEXT = [
  user(1, null, 'Refactor the parser'),
  said(2, 1, 'Done.'),
  user(3, 2, 'Add tests'),
  said(4, 3, 'Tests added.'),
  user(5, 2, 'Use the other approach'),
  said(6, 5, 'Switched.'),
].join('\n') + '\n'

const FULL = [
  'learn: The main agent cached /ask, so one-off questions now cost more.',
  'tag: Heads up',
  'title: One-off /ask questions cost more',
  'explain:',
  '- /ask takes a quick side question.',
  '- Watch how often people ask follow-ups.',
].join('\n')

const answered = (text: string) => ({ isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })

// The session's transcript is whatever the file read returns; the store keeps what the mod saved.
function setup(on: any) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 8, 9, 0) })
  const store = new Map<string, unknown>()
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('model.fork', () => ({ value: answered(FULL) }))
  on('state.get', () => ({ value: { value: undefined } }))
  on('state.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/home/u' : undefined }))
  on('fs.list', () => ({ value: [{ name: 'p', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: new TextEncoder().encode(TRANSCRIPT_TEXT).length, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$: unknown, e: { as?: string }) => ({ value: e.as === 'bytes' ? { base64: btoa(TRANSCRIPT_TEXT) } : TRANSCRIPT_TEXT }))
  on('classic.SessionStart', () => ({}))
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`base ${e.component}`}</Text>
  })
  return { clock, store }
}

async function step($: any, index: number, extra: object = {}) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, ...extra })
  while ((await stream.next()).done !== true);
}

// The composer draws a prompt under a placeholder id as it is sent, then under its uuid.
const draw = ($: any, requestId: string, text: string) =>
  $.ui.mount({ plugin: 'mod-heads-up', surface: 'terminal', component: 'UserMessage', requestId, viewport: { columns: 100, rows: 30 }, props: { text, origin: { kind: 'composer' }, isExpanded: true } } as never)

const notesOf = (store: Map<string, unknown>) => (store.get('notes:s1') as { notes: { turn: number; prompt: string }[] }).notes.map(note => [note.turn, note.prompt])

// The mod loaded after the session began (no SessionStart reached it), so it finds the transcript by its name.
test('a note takes the number its prompt has on the live branch: a prompt before load, a rewind, a cancelled prompt and a placeholder do not shift it', async ($, on) => {
  const { clock, store } = setup(on)
  await $.prompt.submit({ text: 'Add tests' } as never)
  await $.prompt.submit({ text: 'Use the other approach' } as never)
  await $.prompt.submit({ text: 'Also check the docs' } as never)
  await draw($, 'placeholder', 'Also check the docs')
  await draw($, ID(7), 'Also check the docs')
  await $.prompt.submit({ text: 'Never mind' } as never)
  await step($, 6)
  await clock.settle()
  expect(notesOf(store)).toEqual([[3, 'Also check the docs']])
})

test('the same note when the session start named the transcript', async ($, on) => {
  const { clock, store } = setup(on)
  await $.classic.SessionStart({ session_id: 's1', transcript_path: TRANSCRIPT, source: 'startup', hook_event_name: 'SessionStart', cwd: '/w' } as never)
  await $.prompt.submit({ text: 'Add tests' } as never)
  await $.prompt.submit({ text: 'Use the other approach' } as never)
  await $.prompt.submit({ text: 'Also check the docs' } as never)
  await draw($, 'placeholder', 'Also check the docs')
  await draw($, ID(7), 'Also check the docs')
  await $.prompt.submit({ text: 'Never mind' } as never)
  await step($, 6)
  await clock.settle()
  expect(notesOf(store)).toEqual([[3, 'Also check the docs']])
})
