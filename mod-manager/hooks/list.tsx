// mod-manager / hooks/list.tsx, by v-amorim
// Draws the mod list rows with status marks, tips and theme colors.
import type { ClientModule } from 'claude-code'

import { mix, postTip } from './entry'
import type { Tip } from './entry'
import { CAPS, MARK, THEME } from './theme'

// index is the mod's place in the pane's full list; slug is its package and folder name.
export type Row = { index: number; name: string; slug: string; version: string; enabled: boolean; commands: string[]; hasSettings: boolean }

// gear marks a mod with settings, icon leads each name (empty in safe mode); the widths line the columns up.
export type ListProps = { rows: Row[]; gear: string; icon: string; nameWidth: number; slugWidth: number; nerd: boolean; on: string; off: string; switchTip: Tip; openTip: string }

// The pointer's row and part post a tip (id manager-row-<index>), which also tells the pane which mod's card to show.
export type ListMessage = { type: 'select'; index: number } | { type: 'toggle'; index: number }

// The share of green left in an on switch, as the mod-transcript chips tint their counts.
const WASH = 0.72

// Cells the switch pill takes: its two ends, the dot, a space and the longer label.
export const switchWidth = (on: string, off: string) => 2 + 2 + Math.max(on.length, off.length)

// One row per mod: the switch pill turns it on or off, the rest of the row opens its page; the row under the pointer is lifted.
const ModList: ClientModule<ListProps, { row: number; zone: number }> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, gear, icon, nameWidth, slugWidth, nerd, on, off, switchTip, openTip } = props
  // A Client takes no hover prop, so it tracks the row under the pointer itself.
  const hovered = surface.state?.row ?? -1
  const toggleCells = switchWidth(on, off)

  surface.onPointer(event => {
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    const zone = row >= 0 && event.x < toggleCells ? 0 : 1
    const isClick = event.type === 'down' && event.button === 'left' && row >= 0
    if (row !== hovered || (row >= 0 && zone !== surface.state?.zone)) {
      surface.setState({ row, zone })
      // One post lands per event, so a click posts its own message and the next move posts the tip.
      if (!isClick) postTip(surface, row >= 0 ? `manager-row-${rows[row]!.index}` : 'manager-row', row >= 0 ? (zone === 0 ? { ...switchTip, label: rows[row]!.name } : { glyph: gear, label: rows[row]!.name, text: openTip }) : null)
    }
    if (!isClick) return
    surface.post({ type: zone === 0 ? 'toggle' : 'select', index: rows[row]!.index } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, at) => {
        const bg = at === hovered ? THEME.lifted : THEME.surface1
        const fill = row.enabled ? mix(THEME.good, bg, WASH) : THEME.surface3
        const label = (row.enabled ? on : off).padEnd(Math.max(on.length, off.length))
        const end = (side: string, key: string) => <Text key={key} color={fill} backgroundColor={nerd ? bg : fill}>{nerd ? side : ' '}</Text>
        return (
          <Box key={`row-${at}`} flexDirection="row" backgroundColor={bg}>
            {end(CAPS.left, `switch-${at}-left`)}
            <Text key={`switch-${at}`} color={row.enabled ? THEME.good : THEME.muted} backgroundColor={fill}>{`${row.enabled ? MARK.stopOpen : MARK.stop} ${label}`}</Text>
            {end(CAPS.right, `switch-${at}-right`)}
            {/* An off mod's name dims too, so its state never rests on the switch alone. */}
            <Text color={row.enabled ? THEME.onSurface : THEME.muted}>{` ${icon ? `${icon} ` : ''}${row.name.padEnd(nameWidth)} `}</Text>
            {/* A blank as wide as the gear keeps the folders in one column for mods without settings. */}
            <Text color={THEME.secondary}>{row.hasSettings ? gear : ' '.repeat([...gear].length)}</Text>
            <Text color={THEME.muted}>{` ${row.slug.padEnd(slugWidth)}`}</Text>
            {row.commands.length ? <Text color={THEME.muted}>{row.commands.map(name => ` ${MARK.sep} /${name}`).join('')}</Text> : null}
            <Box key={`row-${at}-gap`} flexGrow={1} />
            <Text color={THEME.muted}>{row.version}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default ModList
