import type { ClientModule } from 'claude-code'

import { shimmerColor, TICK_MS } from './entry'
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

// offset is the first row's index in the whole tree: a long tree draws as several lists.
export type ListProps = { rows: Row[]; offset?: number }

export type ListMessage = { type: 'select'; index: number }

const STATUS_COLOR: Record<Tone, string> = { live: THEME.accent, added: THEME.good, changed: THEME.secondary, read: THEME.muted, dir: THEME.muted }

type State = { hovered: number; phase: number }

// Moonlight surface-3: the row Claude is on stands out from the tree's surface-1 as a band.
const LIVE_BG = '#252A42'

// The ticker starts once per instance and reads the latest rows from here, since its closure keeps the first ones.
const latest = new WeakMap<object, ListProps>()

// The tree rows; a click anywhere on a row selects it, the row under the pointer lights up, and the file Claude is on shimmers.
const FileList: ClientModule<ListProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows } = props
  latest.set(surface, props)

  // A Client takes no hover prop, so it tracks the row under the pointer itself.
  const hovered = surface.state?.hovered ?? -1
  const phase = surface.state?.phase ?? 0

  if (!surface.state) {
    surface.setState({ hovered: -1, phase: 0 })
    // Redraws only while a row is live.
    surface.every(TICK_MS, () => {
      const state = surface.state
      if (state && latest.get(surface)?.rows.some(row => row.tone === 'live')) surface.setState({ ...state, phase: state.phase + 1 })
    })
  }

  surface.onPointer(event => {
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    if (row !== hovered) surface.setState({ hovered: row, phase })
    if (event.type === 'down' && event.button === 'left' && row >= 0) surface.post({ type: 'select', index: (props.offset ?? 0) + row } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const isLive = row.tone === 'live'
        const nameColor = index === hovered ? THEME.accent : row.tone === 'read' ? THEME.muted : THEME.onSurface
        return (
          <Box key={`row-${index}`} flexDirection="row" backgroundColor={isLive ? LIVE_BG : undefined}>
            <Text color={THEME.border}>{row.guides}</Text>
            {row.mark ? <Text color={isLive ? THEME.accent : THEME.muted}>{`${row.mark} `}</Text> : null}
            {isLive ? (
              [...row.name].map((char, at) => (
                <Text key={`c${at}`} color={shimmerColor(at, phase, row.name.length)} bold>
                  {char}
                </Text>
              ))
            ) : (
              <Text color={nameColor}>{row.name}</Text>
            )}
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
