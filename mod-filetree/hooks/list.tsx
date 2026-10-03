import type { ClientModule } from 'claude-code'

import { THEME } from './theme'

// live: Claude is on this file right now; added, changed and read set the status letter's color.
export type Tone = 'live' | 'added' | 'changed' | 'read' | 'dir'

export type Row = {
  // Indent guides, one `│ ` per level above the row.
  guides: string
  // Chevron and icon of a folder, or the file-type icon of a file; empty parts are dropped.
  mark: string
  name: string
  tone: Tone
  add: number
  del: number
  // The status letter (A, M, R), or the action word while Claude is on the file.
  status: string
  // Spaces that push the counts and the status to the pane's right edge.
  pad: number
}

export type ListProps = { rows: Row[] }

export type ListMessage = { type: 'select'; index: number }

const STATUS_COLOR: Record<Tone, string> = { live: THEME.accent, added: THEME.good, changed: THEME.secondary, read: THEME.muted, dir: THEME.muted }

// The tree rows; a click anywhere on a row selects it, and the row under the pointer lights up.
const FileList: ClientModule<ListProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows } = props

  // A Client takes no hover prop, so it tracks the row under the pointer itself.
  const hovered = surface.state ?? -1

  surface.onPointer(event => {
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    if (row !== hovered) surface.setState(row)
    if (event.type === 'down' && event.button === 'left' && row >= 0) surface.post({ type: 'select', index: row } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const isLive = row.tone === 'live'
        const nameColor = index === hovered || isLive ? THEME.accent : row.tone === 'read' ? THEME.muted : THEME.onSurface
        return (
          <Box key={`row-${index}`} flexDirection="row">
            <Text color={THEME.border}>{row.guides}</Text>
            {row.mark ? <Text color={isLive ? THEME.accent : THEME.muted}>{`${row.mark} `}</Text> : null}
            <Text color={nameColor} bold={isLive}>{row.name}</Text>
            <Text>{' '.repeat(Math.max(1, row.pad))}</Text>
            {row.add > 0 ? <Text color={THEME.good}>{`+${row.add} `}</Text> : null}
            {row.del > 0 ? <Text color={THEME.alert}>{`−${row.del} `}</Text> : null}
            {row.status ? <Text color={STATUS_COLOR[row.tone]} bold={!isLive}>{row.status}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}

export default FileList
