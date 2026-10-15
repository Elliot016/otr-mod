// mod-menu / hooks/register.tsx, by v-amorim: the /mod-menu command, hidden and labels
import type { Register } from 'claude-code'

import { fill } from './theme'
import text from './text'

const LABELS = ['always', 'never']

// Panel mods draw their own entries in the band above the prompt and read `hidden` and `labels`; this mod owns both.
export const register: Register = (on, options) => {
  const labels = options.labels === 'never' ? 'never' : 'always'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mod-menu', description: text.commandDescription })
    await $.state.set({ plugin: 'mod-menu', key: 'hidden' }, (await $.store.get('hidden')) === true)
    await $.state.set({ plugin: 'mod-menu', key: 'labels' }, labels)
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-menu' }, async ($, e) => {
    const [word, mode] = (e.args ?? '').trim().split(/\s+/)
    if (word === 'labels') {
      if (!mode || !LABELS.includes(mode)) return { text: text.labelsUsage }
      // The saved setting reloads this mod; the state is set now so the pills redraw at once.
      await $.config.set({ key: 'mod-menu.labels', value: mode })
      await $.state.set({ plugin: 'mod-menu', key: 'labels' }, mode)
      $.ui.invalidate('ui.render')

      return { text: fill(text.labelsSet, { mode }) }
    }

    const hidden = (await $.state.get({ plugin: 'mod-menu', key: 'hidden' })).value !== true
    await $.state.set({ plugin: 'mod-menu', key: 'hidden' }, hidden)
    await $.store.set('hidden', hidden)
    $.ui.invalidate('ui.render')

    return { text: text[hidden ? 'menuHidden' : 'menuShown'] }
  })
}
