// mod-transcript / tests/previews.test.tsx, by v-amorim
import { expect, mock, test } from 'claude-code/testing'

import { capture, expectPreview, stacked, type Expand } from './previews-kit'
import { snapshot } from './previews.snapshot'
import { reading, sessionStarted } from './bridge-feed'

const COLUMNS = 56
const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const row = (n: number, type: string, extra: object) => JSON.stringify({ type, uuid: ID(n), parentUuid: n > 1 ? ID(n - 1) : null, ...extra })
const said = (n: number, content: unknown[]) => row(n, 'assistant', { message: { role: 'assistant', content } })
const answered = (n: number, id: string, extra: object = {}) => row(n, 'user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, ...extra })

const EDIT = { file_path: '/w/hooks/a.ts' }
const BASH = { command: 'npm test', description: 'Run the tests' }

// A finished turn that edited a file and ran the tests, then a next prompt that ends it.
const TURN =
  [
    row(1, 'user', { message: { role: 'user', content: 'fix the bug' } }),
    said(2, [{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: EDIT }]),
    answered(3, 'toolu_e', { toolUseResult: { structuredPatch: [{ lines: [' keep', '+one', '+two', '-old'] }] } }),
    said(4, [{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: BASH }]),
    answered(5, 'toolu_b'),
    said(6, [{ type: 'text', text: 'Fixed.' }]),
    row(7, 'system', { subtype: 'turn_duration', durationMs: 64000 }),
    row(8, 'user', { message: { role: 'user', content: 'next' } }),
  ].join('\n') + '\n'

// The host draws the prompt, the reply and the tool rows the mod does not own, so they are stood in by their text.
async function open($: any, on: any) {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TURN.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', reading(() => ({ value: TURN })))
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/w' }))
  mock.env(on, { USERPROFILE: '/home' })
  on('ui.render', ($$: any, e: any) => {
    const { Box, Text } = $$.ui.resolve(e)
    if (e.component === 'UserMessage') return <Box key="host-prompt" flexDirection="column"><Text key="host-gap"> </Text><Text key="host-text">{`❯ ${e.props.text}`}</Text></Box>
    return <Text>{e.props.text ?? `${e.props.tool}(${e.props.input?.file_path ?? ''})`}</Text>
  })
  await sessionStarted($, clock, 's1', '/t/s1.jsonl', 'startup')
  return (component: string, requestId: string, props: object) =>
    $.ui.mount({ plugin: 'mod-transcript', surface: 'terminal', component, requestId, viewport: { columns: COLUMNS, rows: 40 }, props } as never)
}

const expandIn = (ui: any): Expand => async (key, size) => {
  if (size) await ui.resize({ in: key, ...size })
  return ui.drawn({ in: key })
}

const seen = async (ui: any) => {
  const got = await capture(await ui.drawn(), expandIn(ui), COLUMNS)
  await ui.unmount()
  return got
}

const call = (id: string, tool: string, input: object) => ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false, output: {} })
const prompt = { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false }

// The prompt, with the turn's head under it, then the rows the settings keep visible, then the reply that closes it.
async function turn($: any, on: any, withCalls: boolean) {
  const mount = await open($, on)
  const parts = [await seen(await mount('UserMessage', ID(1), prompt))]
  if (withCalls) parts.push(await seen(await mount('ToolUse', 'toolu_b', call('toolu_b', 'Bash', BASH))))
  parts.push(await seen(await mount('AssistantMessage', ID(6), { text: 'Fixed.', isFirstOfReply: true })))
  return stacked(...parts)
}

const OPTIONS = { timestamps: false, prompt_numbers: false, animations: false, expand_live: false }

for (const mode of ['nerd', 'safe'] as const) {
  for (const folded of [true, false]) {
    test(`fold_turns=${folded} example is the real turn rows (${mode})`, { options: { ...OPTIONS, icons: mode, fold_turns: folded } }, async ($, on) => {
      expectPreview(snapshot, 'fold_turns', String(folded), mode, await turn($, on, false))
    })
  }

  for (const folded of [true, false]) {
    test(`fold_tools=${folded} example is the real turn rows (${mode})`, { options: { ...OPTIONS, icons: mode, fold_turns: false, fold_tools: folded } }, async ($, on) => {
      expectPreview(snapshot, 'fold_tools', String(folded), mode, await turn($, on, !folded))
    })
  }

  test(`every row of the reply bubble is as wide as its top edge, so no rail sticks out (${mode})`, { options: { ...OPTIONS, icons: mode, fold_turns: true } }, async ($, on) => {
    const got = await turn($, on, false)
    const widths = got.lines.slice(3).map(line => Array.from(line.spans.map(span => span.text).join('')).length)
    expect(new Set(widths).size).toBe(1)
  })

  for (const shown of [true, false]) {
    test(`copy_pill=${shown} example is the real reply row (${mode})`, { options: { ...OPTIONS, icons: mode, copy_pill: shown } }, async ($, on) => {
      const mount = await open($, on)
      await mount('UserMessage', ID(1), prompt).then((ui: any) => ui.unmount())
      expectPreview(snapshot, 'copy_pill', String(shown), mode, await seen(await mount('AssistantMessage', ID(6), { text: 'Fixed.', isFirstOfReply: true })))
    })
  }
}
