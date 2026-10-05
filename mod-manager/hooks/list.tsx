import type { ClientModule } from 'claude-code'

import { MARK, THEME } from './theme'

// index is the mod's place in the pane's full list, which a click reports back.
// slug is the package name, which is also its folder in ~/.claude/mods.
export type Row = { index: number; name: string; slug: string; enabled: boolean; commands: string[]; hasSettings: boolean }

// gear marks a mod with settings and icon leads each name (empty in safe mode); the hooks module picks both from the terminal font.
// nameWidth pads every name to the longest, so the slugs line up in one column.
export type ListProps = { rows: Row[]; gear: string; icon: string; nameWidth?: number }

// hover names the mod under the pointer, or -1 once it leaves, so the pane can show that mod's card.
export type ListMessage = { type: 'select'; index: number } | { type: 'hover'; index: number }

// The text of each mod row; a click anywhere on it opens the mod, and the row under the pointer lights up. The on/off action sits in the pane's action column.
const ModList: ClientModule<ListProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, gear, icon, nameWidth = 0 } = props
  // A Client takes no hover prop, so it tracks the row under the pointer itself.
  const hovered = surface.state ?? -1

  surface.onPointer(event => {
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    if (row !== hovered) {
      surface.setState(row)
      surface.post({ type: 'hover', index: row >= 0 ? rows[row]!.index : -1 } satisfies ListMessage)
    }
    if (event.type === 'down' && event.button === 'left' && row >= 0) surface.post({ type: 'select', index: rows[row]!.index } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, at) => (
        <Box key={`row-${at}`} flexDirection="row" columnGap={1}>
          {/* The divider keeps the toggle beside it apart from the name a click opens. */}
          <Text color={THEME.border}>│</Text>
          {/* An off mod's name dims too, so its state never rests on the switch glyph alone. */}
          <Text color={at === hovered ? THEME.accent : row.enabled ? THEME.onSurface : THEME.muted}>{icon ? `${icon} ${row.name.padEnd(nameWidth)}` : row.name.padEnd(nameWidth)}</Text>
          {/* A blank as wide as the gear keeps the slugs in one column for mods without settings. */}
          <Text color={THEME.secondary}>{row.hasSettings ? gear : ' '.repeat([...gear].length)}</Text>
          <Text color={THEME.muted}>{row.slug}</Text>
          {row.commands.length ? <Text color={THEME.muted}>{row.commands.map(name => `${MARK.sep} /${name}`).join(' ')}</Text> : null}
        </Box>
      ))}
    </Box>
  )
}

export default ModList
