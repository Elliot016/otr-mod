// mod-menu / hooks/register.tsx, by v-amorim
// Registers the command that hides or shows the panel pills above the prompt.
import type { Register } from 'claude-code'

import { isTipMessage, tipText } from './entry'
import { splitRow, tipLine } from './pills'
import text from './text'

// Panel mods draw their own entries in the band above the prompt and read `hidden`; this mod owns it.
export const register: Register = on => {
  // The band's tip row for a hovered control of this mod; other mods answer their own `tip` posts the same way.
  let hoveredTip = ''

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

  on('ui.message', async ($, e, next) => {
    if (isTipMessage(e.data)) {
      hoveredTip = tipText(e.data)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const others = await next(e)
    if (e.surface !== 'terminal' || !hoveredTip) return others
    const { Box, Text } = $.ui.resolve(e)
    const { group, row } = splitRow(others)
    // Only a row another mod drew has a tip site to fill; the rest passes through.
    if (group.length === 0 && row.length === 0) return others
    const children = (others as { children?: unknown[] }).children ?? []

    return <Box key="menu-rows" flexDirection="column">{children.map(child => ((child as { props?: { key?: string } }).props?.key === 'menu-tip' ? tipLine({ Box, Text }, hoveredTip) : child))}</Box>
  })
}
