// Shared pill entry, see mod-builder/references/standard.md. Master in mod-menu; copy unchanged into every mod that draws a menu entry.
import type { ClientModule } from 'claude-code'

import { THEME } from './theme'

// id names the entry, so a mod with two entries can tell the clicks apart.
// color overrides the open text color (a red Run); idle the closed one, muted unless set (pill-row labels use THEME.pill).
export type EntryProps = { id: string; label: string; isOpen: boolean; bg: string; color?: string; idle?: string }

// menu-hover tells the owning mod the pointer arrived or left, so it can show its tip under the row.
export type EntryMessage = { type: 'menu-entry'; id: string } | { type: 'menu-hover'; id: string; isOver: boolean }

// A Button inverts under the pointer, so the entry is plain text that lights up like a sidebar row.
const Entry: ClientModule<EntryProps, boolean> = (props, surface) => {
  const { Text } = surface.elements
  const hovered = surface.state === true

  surface.onPointer(event => {
    const over = event.type !== 'leave'
    if (over !== hovered) {
      surface.setState(over)
      surface.post({ type: 'menu-hover', id: props.id, isOver: over } satisfies EntryMessage)
    }
    if (event.type === 'down' && event.button === 'left') surface.post({ type: 'menu-entry', id: props.id } satisfies EntryMessage)
  })

  return (
    <Text color={hovered ? THEME.accent : props.isOpen ? (props.color ?? THEME.onSurface) : (props.idle ?? THEME.muted)} bold={props.isOpen && Boolean(props.idle)} backgroundColor={props.bg}>
      {` ${props.label} `}
    </Text>
  )
}

export default Entry
