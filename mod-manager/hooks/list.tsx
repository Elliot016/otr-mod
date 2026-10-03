import type { ClientModule } from 'claude-code'

import { MARK, THEME } from './theme'

// index is the mod's place in the pane's full list, which a click reports back.
export type Row = { index: number; name: string; enabled: boolean; commands: string[]; hasSettings: boolean }

// gear marks a mod with settings and icon leads each name (empty in safe mode); the hooks module picks both from the terminal font.
export type ListProps = { rows: Row[]; gear: string; icon: string }

export type ListMessage = { type: 'select'; index: number }

// The text of each mod row; a click anywhere on it opens the mod, and the row under the pointer lights up. The on/off action sits in the pane's action column.
const ModList: ClientModule<ListProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, gear, icon } = props
  // A Client takes no hover prop, so it tracks the row under the pointer itself.
  const hovered = surface.state ?? -1

  surface.onPointer(event => {
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    if (row !== hovered) surface.setState(row)
    if (event.type === 'down' && event.button === 'left' && row >= 0) surface.post({ type: 'select', index: rows[row]!.index } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, at) => (
        <Box key={`row-${at}`} flexDirection="row" columnGap={1}>
          {/* The divider keeps the toggle beside it apart from the name a click opens. */}
          <Text color={THEME.border}>│</Text>
          {/* An off mod's name dims too, so its state never rests on the switch glyph alone. */}
          <Text color={at === hovered ? THEME.accent : row.enabled ? THEME.onSurface : THEME.muted}>{icon ? `${icon} ${row.name}` : row.name}</Text>
          {row.hasSettings ? <Text color={THEME.secondary}>{gear}</Text> : null}
          {row.commands.length ? <Text color={THEME.muted}>{row.commands.map(name => `${MARK.sep} /${name}`).join(' ')}</Text> : null}
        </Box>
      ))}
    </Box>
  )
}

export default ModList
