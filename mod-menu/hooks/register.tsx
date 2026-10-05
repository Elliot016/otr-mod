import type { Register } from 'claude-code'

import text from './text'

// Panel mods draw their own entries in the band above the prompt and read `hidden`; this mod owns it.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mod-menu', description: text.commandDescription })
    await $.state.set({ plugin: 'mod-menu', key: 'hidden' }, (await $.store.get('hidden')) === true)

    return next(e)
  })

  on('command.run', { command: 'mod-menu' }, async $ => {
    const hidden = (await $.state.get({ plugin: 'mod-menu', key: 'hidden' })).value !== true
    await $.state.set({ plugin: 'mod-menu', key: 'hidden' }, hidden)
    await $.store.set('hidden', hidden)

    return { text: '' }
  })
}
