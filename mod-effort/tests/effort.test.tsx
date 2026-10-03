import { expect, mock, test } from 'claude-code/testing'

import { displayName, withEffort } from '../hooks/levels'

const SETTINGS = { env: { KEEP: '1' }, modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium', other: 1 } }, model: 'x' }

test('withEffort edits only the model effort and refuses broken JSON', () => {
  const out = JSON.parse(withEffort(JSON.stringify(SETTINGS, null, 2), 'claude-opus-5-5', 'max')!)
  expect(out.modelSettings['claude-opus-5-5']).toEqual({ effortLevel: 'max', other: 1 })
  expect(out.env).toEqual(SETTINGS.env)
  expect(out.model).toBe('x')

  const fresh = JSON.parse(withEffort('{\n  "model": "x"\n}', 'claude-sonnet-5-5', 'low')!)
  expect(fresh.modelSettings).toEqual({ 'claude-sonnet-5-5': { effortLevel: 'low' } })
  expect(withEffort('{ broken', 'm', 'low')).toBeNull()
})

test('the footer meter follows each request and a click saves that level', async ($, on) => {
  const files: Record<string, string> = { '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n' }
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.read', (_$, e) => ({ value: files[neutral(e.path)] ?? '' }))
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const clock = mock.clock(on)
  on('turn.step', async function* ($$, e) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>auto mode</Text>
  })

  // A step streams: the hook runs only while the stream is read.
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 } as never)
  while ((await stream.next()).done !== true);

  const ui = await $.ui.mount({ plugin: 'mod-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  expect(await ui.find({ type: 'Text', text: 'auto mode' })).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn({ in: 'meter' }))
  expect(drawn).toContain('◐ ')
  expect(drawn).toContain(' Opus 5.5 ')
  expect(drawn).not.toContain('medium')

  // ' Opus 5.5 ' (10 cells) comes first; the fifth glyph sits at x 18.
  await ui.pointer({ in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  expect(JSON.parse(files['/h/.claude/settings.json']!).modelSettings['claude-opus-5-5'].effortLevel).toBe('max')
  expect(files['/h/.claude/settings.json.mod-effort.bak']).toContain('"medium"')
  // The level word shows on a click, then leaves.
  expect(await ui.find({ type: 'Text', text: 'max' })).toBeDefined()
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: 'max' })).toBeUndefined()
  await ui.unmount()
})

test('displayName reads like the oh-my-posh pill', () => {
  expect(displayName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(displayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(displayName('Opus 5.5')).toBe('Opus 5.5')
})

test('a clicked level rides on each request until Alt+P saves another', async ($, on) => {
  const files: Record<string, string> = { '/h/.claude/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n' }
  const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const sent: string[] = []
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.read', (_$, e) => ({ value: files[neutral(e.path)] ?? '' }))
  on('fs.write', (_$, e) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('settings.read', () => ({ value: JSON.parse(files['/h/.claude/settings.json']!) }))
  on('store.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  mock.clock(on)
  on('turn.step', async function* ($$, e) {
    sent.push(String(e.effort))
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  const step = async (index: number) => {
    const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 } as never)
    while ((await stream.next()).done !== true);
  }

  await step(0)
  const ui = await $.ui.mount({ plugin: 'mod-effort', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never)
  await ui.pointer({ in: 'meter', type: 'down', button: 'left', x: 18, y: 0 })
  await step(1)

  // Alt+P saves high; Claude Code's own level takes over again.
  const saved = JSON.parse(files['/h/.claude/settings.json']!)
  saved.modelSettings['claude-opus-5-5'].effortLevel = 'high'
  files['/h/.claude/settings.json'] = JSON.stringify(saved)
  await step(2)
  expect(sent).toEqual(['medium', 'max', 'medium'])
  await ui.unmount()
})
