import type { ClientModule } from 'claude-code'

import { HOVER_STEPS, hoverMix, mix, shimmerColor, stepToward, TICK_MS } from './entry'
import { CAPS, THEME } from './theme'

// live: Claude is on this file right now; added, changed and read set the name's color.
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
  // When this file's latest edit landed, so the row glows and fades back.
  changedAt?: number
  // The mark the row ends in: a file's opens it in VS Code or the default app, a folder's opens it in the file manager.
  endMark: string
  // The open mark's color: a folder's differs from a file's arrow.
  endColor: string
}

// offset is the first row's index in the whole tree: a long tree draws as several lists.
// still: the animations setting is off: no shimmer, no glow, and the hover switches at once.
// nerd: the font has the rounded caps the live word's pill uses. width: every row's cells, the open mark in the last.
export type ListProps = { rows: Row[]; offset?: number; still?: boolean; nerd?: boolean; width: number }

export type ListMessage = { type: 'select' | 'open'; index: number }

// The space, then the open mark's pill: caps around it on Nerd, a space each side on safe.
export const OPEN_CELLS = 4

// A file's name carries its status as color, named once in the pane's legend instead of a letter on every row.
export const NAME_COLOR: Record<Tone, string> = { live: THEME.onSurface, added: THEME.good, changed: THEME.warn, read: THEME.secondary, dir: THEME.onSurface }

// Lines added and removed in one pill; plain colored text where the font has no caps.
const countsPill = (Text: (props: any) => unknown, add: number, del: number, nerd: boolean) => {
  const parts = [add > 0 ? <Text key="add" color={THEME.good} backgroundColor={nerd ? THEME.surface3 : undefined}>{`+${add}`}</Text> : null, del > 0 ? <Text key="del" color={THEME.alert} backgroundColor={nerd ? THEME.surface3 : undefined}>{`${add > 0 ? ' ' : ''}−${del}`}</Text> : null]
  if (!nerd) return parts
  return [<Text key="counts-left" color={THEME.surface3}>{CAPS.left}</Text>, ...parts, <Text key="counts-right" color={THEME.surface3}>{CAPS.right}</Text>]
}

// levels: each row's hover fade, kept only while it is above 0.
type State = { hovered: number; phase: number; levels: Record<number, number> }

// Moonlight surface-3: the row Claude is on stands out from the tree's surface-1 as a band.
const LIVE_BG = THEME.surface3

// The live word's pill: rounded caps where the font has them, a space on each side elsewhere.
const LIVE_PILL = THEME.border

const livePill = (Text: (props: any) => unknown, word: string, nerd: boolean) => [
  <Text key="live-cap-left" color={LIVE_PILL}>{nerd ? CAPS.left : ' '}</Text>,
  <Text key="live-word" color={THEME.pill} backgroundColor={LIVE_PILL}>{word}</Text>,
  <Text key="live-cap-right" color={LIVE_PILL}>{nerd ? CAPS.right : ' '}</Text>,
]

// A Client draws Text only, so the open mark's pill draws its caps itself; OPEN_CELLS counts these cells.
const openPill = (Text: (props: any) => unknown, glyph: string, color: string, nerd: boolean) =>
  nerd
    ? [
        <Text key="open-gap">{' '}</Text>,
        <Text key="open-cap-left" color={THEME.surface3}>{CAPS.left}</Text>,
        <Text key="open" color={color} backgroundColor={THEME.surface3}>{glyph}</Text>,
        <Text key="open-cap-right" color={THEME.surface3}>{CAPS.right}</Text>,
      ]
    : [<Text key="open-gap">{' '}</Text>, <Text key="open" color={color} backgroundColor={THEME.surface3}>{` ${glyph} `}</Text>]

// A file whose edit just landed starts in the live band's colors and fades to its own over this long.
const GLOW_MS = 2500

const glowOf = (row: Row, now: number) => (row.changedAt && now - row.changedAt < GLOW_MS ? 1 - (now - row.changedAt) / GLOW_MS : 0)

const fadeLevels = (levels: Record<number, number>, hovered: number) => {
  const next: Record<number, number> = {}
  for (const row of new Set([...Object.keys(levels).map(Number), hovered])) {
    const level = stepToward(levels[row] ?? 0, row === hovered)
    if (row >= 0 && level > 0) next[row] = level
  }
  return next
}

const isFading = (levels: Record<number, number>, hovered: number) =>
  Object.entries(levels).some(([row, level]) => level !== (Number(row) === hovered ? HOVER_STEPS : 0)) || (hovered >= 0 && !levels[hovered])

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
  const levels = surface.state?.levels ?? {}

  if (!surface.state) {
    surface.setState({ hovered: -1, phase: 0, levels: {} })
    // Redraws only while a row is live, glowing or fading its hover.
    surface.every(TICK_MS, () => {
      const state = surface.state
      const shown = latest.get(surface)?.rows ?? []
      const now = Date.now()
      // A glow keeps the ticker one step past its end, so the row's last frame is its own colors.
      const isMoving = shown.some(row => row.tone === 'live' || (row.changedAt !== undefined && now - row.changedAt < GLOW_MS + TICK_MS * 2)) || isFading(state?.levels ?? {}, state?.hovered ?? -1)
      if (state && isMoving && !latest.get(surface)?.still) surface.setState({ ...state, phase: state.phase + 1, levels: fadeLevels(state.levels ?? {}, state.hovered) })
    })
  }

  surface.onPointer(event => {
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    const next = props.still ? (row >= 0 ? { [row]: HOVER_STEPS } : {}) : fadeLevels(levels, row)
    if (row !== hovered) surface.setState({ hovered: row, phase, levels: next })
    if (event.type !== 'down' || event.button !== 'left' || row < 0) return
    const isOpenMark = rows[row]!.endMark !== '' && event.x >= props.width - OPEN_CELLS
    surface.post({ type: isOpenMark ? 'open' : 'select', index: (props.offset ?? 0) + row } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const isLive = row.tone === 'live'
        const glow = props.still ? 0 : glowOf(row, Date.now())
        const restColor = mix(NAME_COLOR[row.tone], THEME.pill, glow)
        const nameColor = hoverMix(restColor, THEME.accent, levels[index] ?? 0)
        const background = isLive ? LIVE_BG : glow > 0 ? mix(THEME.surface1, LIVE_BG, glow) : undefined
        return (
          <Box key={`row-${index}`} flexDirection="row" backgroundColor={background}>
            <Text color={THEME.border}>{row.guides}</Text>
            {row.mark ? <Text color={isLive ? THEME.accent : THEME.muted}>{`${row.mark} `}</Text> : null}
            {isLive && !props.still ? (
              [...row.name].map((char, at) => (
                <Text key={`c${at}`} color={shimmerColor(at, phase, row.name.length)} bold>
                  {char}
                </Text>
              ))
            ) : (
              <Text color={nameColor}>{row.name}</Text>
            )}
            <Text>{' '.repeat(Math.max(1, row.pad))}</Text>
            {/* The live word sits left of the counts, so the counts keep one right edge whether a row is live or not. */}
            {/* It never shrinks: a row a cell too wide takes the cell from the gap, not from the word. */}
            {isLive && row.status ? <Box key="live" flexDirection="row" flexShrink={0}>{livePill(Text, row.status, props.nerd === true)}</Box> : null}
            {isLive && row.status && (row.add > 0 || row.del > 0) ? <Text> </Text> : null}
            {row.add > 0 || row.del > 0 ? countsPill(Text, row.add, row.del, props.nerd === true) : null}
            {row.endMark ? openPill(Text, row.endMark, row.endColor, props.nerd === true) : null}
          </Box>
        )
      })}
    </Box>
  )
}

export default FileList
