// mod-collision-guard / tests/previews.test.tsx, by v-amorim
import { test } from 'claude-code/testing'

import { agoText } from '../hooks/guard'
import text from '../hooks/text'
import { fill } from '../hooks/theme'
import { expectPreview, written } from './previews-kit'
import { snapshot } from './previews.snapshot'

// The host draws the dialog, so its two lines are worded from the mod's strings; "type something" is the host's own fourth choice.
const dialog = () =>
  written(
    [{ text: fill(text.question, { path: 'hooks/a.ts', ago: agoText(4 * 60_000), clock: '14:32' }), color: 'onSurface' }],
    [{ text: [text.choiceProceed, text.choiceWorktree, text.choiceCancel, 'type something'].map((choice, at) => `${at + 1} ${choice}`).join('  '), color: 'muted' }],
  )

for (const mode of ['nerd', 'safe'] as const) {
  test(`enabled=true example is the dialog's own wording (${mode})`, { options: { icons: mode } }, async () => {
    expectPreview(snapshot, 'enabled', 'true', mode, dialog())
  })

  test(`enabled=false example is its written line (${mode})`, { options: { icons: mode } }, async () => {
    expectPreview(snapshot, 'enabled', 'false', mode, written([{ text: 'Edits run without a question; they are still recorded.', color: 'muted' }]))
  })
}
