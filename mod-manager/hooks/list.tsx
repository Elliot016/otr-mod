import type { ClientModule } from 'claude-code'

import { MARK, THEME } from './theme'

export type Row = { name: string; enabled: boolean; source: 'dir' | 'installed'; commands: string[] }

export type ListProps = { rows: Row[]; selected: number }

export type ListMessage = { type: 'select'; index: number }

// The text of each mod row; a click anywhere on it selects. The on/off action sits in the pane's action column.
const ModList: ClientModule<ListProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, selected } = props
  const send = (message: ListMessage) => surface.post(message)

  surface.onPointer(event => {
    if (event.type !== 'down' || event.button !== 'left' || event.y < 0 || event.y >= rows.length) return
    send({ type: 'select', index: event.y })
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const isSelected = index === selected
        return (
          <Box key={`row-${index}`} flexDirection="row" columnGap={1}>
            <Text color={isSelected ? THEME.accent : THEME.onSurface} bold={isSelected}>{row.name}</Text>
            <Text color={THEME.muted}>{`${MARK.sep} ${row.source === 'dir' ? 'yours' : 'installed'}${row.commands.map(name => ` ${MARK.sep} /${name}`).join('')}`}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default ModList
