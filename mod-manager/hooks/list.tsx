// mod-manager / hooks/list.tsx, by v-amorim
// Draws the mod list rows with status marks, tips and theme colors.
import type { ClientModule } from 'claude-code'

import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, mix, postTip, stepToward } from './entry'
import type { Tip } from './entry'
import { COST_CELLS, costPill, gearPill } from './cost'
import { CAPS, MARK, THEME } from './theme'

// index is the mod's place in the pane's full list; update is the accent text beside the version when the marketplace has a newer one.
export type Row = { index: number; name: string; version: string; enabled: boolean; commands: string[]; hasSettings: boolean; update?: string; cost?: string }

// gear marks a mod with settings, icon leads each name (empty in safe mode); nameWidth lines the columns up; still: hover switches at once.
export type ListProps = { rows: Row[]; gear: string; icon: string; nameWidth: number; nerd: boolean; on: string; off: string; switchTip: Tip; openTip: string; costGlyph: string; costLabel: string; still?: boolean }

// The pointer's row and part post a tip (id manager-row-<index>), which also tells the pane which mod's card to show.
export type ListMessage = { type: 'select'; index: number } | { type: 'toggle'; index: number }

// The share of green left in an on switch, as the mod-transcript chips tint their counts.
const WASH = 0.72

// Cells the switch pill takes: its two ends, the dot, a space and the longer label.
export const switchWidth = (on: string, off: string) => 2 + 2 + Math.max(on.length, off.length)

// levels: each row's hover fade, kept only while above 0.
type State = { row: number; zone: number; levels: Record<number, number> }

export const fadeLevels = (levels: Record<number, number>, hovered: number) => {
  const next: Record<number, number> = {}
  for (const row of new Set([...Object.keys(levels).map(Number), hovered])) {
    const level = stepToward(levels[row] ?? 0, row === hovered)
    if (row >= 0 && level > 0) next[row] = level
  }
  return next
}

export const isFading = (levels: Record<number, number>, hovered: number) => Object.entries(levels).some(([row, level]) => level !== (Number(row) === hovered ? HOVER_STEPS : 0)) || (hovered >= 0 && !levels[hovered])

// Each list's fade timer runs only while a hover is moving: an idle list ticking costs a wakeup.
const fades = new WeakMap<object, () => void>()

// One row per mod: the switch pill turns it on or off, the rest of the row opens its page; the row under the pointer lights as a lifted row with accent text.
const ModList: ClientModule<ListProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, gear, icon, nameWidth, nerd, on, off, switchTip, openTip, costGlyph, costLabel, still } = props
  // A Client takes no hover prop, so it tracks the row under the pointer itself.
  const hovered = surface.state?.row ?? -1
  const levels = surface.state?.levels ?? {}
  const toggleCells = switchWidth(on, off)
  // The badges sit right, before the version padded to one width; a column no row uses is left out, a row without its badge keeps the blank.
  const hasCost = rows.some(row => row.cost)
  const hasGear = rows.some(row => row.hasSettings)
  const versionWidth = Math.max(...rows.map(row => row.version.length))
  const costStart = surface.columns - (1 + versionWidth) - (hasGear ? COST_CELLS + 1 : 0) - COST_CELLS

  surface.onPointer(event => {
    if (!still && !fades.has(surface)) {
      const stop = surface.every(HOVER_TICK_MS, () => {
        const state = surface.state
        if (state && isFading(state.levels, state.row)) {
          surface.setState({ ...state, levels: fadeLevels(state.levels, state.row) })
          return
        }
        stop()
        fades.delete(surface)
      })
      fades.set(surface, stop)
    }
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    const zone = row >= 0 && event.x < toggleCells ? 0 : row >= 0 && rows[row]!.cost && event.x >= costStart && event.x < costStart + COST_CELLS ? 2 : 1
    const isClick = event.type === 'down' && event.button === 'left' && row >= 0
    if (row !== hovered || (row >= 0 && zone !== surface.state?.zone)) {
      const next = still ? (row >= 0 ? { [row]: HOVER_STEPS } : {}) : fadeLevels(levels, row)
      surface.setState({ row, zone, levels: next })
      // One post lands per event, so a click posts its own message and the next move posts the tip.
      if (!isClick) postTip(surface, row >= 0 ? `manager-row-${rows[row]!.index}` : 'manager-row', row >= 0 ? (zone === 0 ? { ...switchTip, label: rows[row]!.name } : zone === 2 ? { glyph: costGlyph, label: costLabel, text: rows[row]!.cost! } : { glyph: gear, label: rows[row]!.name, text: openTip }) : null)
    }
    if (!isClick) return
    surface.post({ type: zone === 0 ? 'toggle' : 'select', index: rows[row]!.index } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, at) => {
        const level = levels[at] ?? 0
        const bg = hoverMix(THEME.surface1, THEME.lifted, level)
        const fill = row.enabled ? mix(THEME.ok, bg, WASH) : THEME.surface3
        const label = (row.enabled ? on : off).padEnd(Math.max(on.length, off.length))
        const end = (side: string, key: string) => <Text key={key} color={fill} backgroundColor={nerd ? bg : fill}>{nerd ? side : ' '}</Text>
        // An off mod's name dims too, so its state never rests on the switch alone.
        const nameColor = hoverMix(row.enabled ? THEME.onSurface : THEME.muted, THEME.accent, level)
        return (
          <Box key={`row-${at}`} flexDirection="row" backgroundColor={bg}>
            {/* Only the commands give way: a squeezed Text wraps and makes the row two tall. */}
            <Box key={`switch-${at}-pill`} flexDirection="row" flexShrink={0}>
              {end(CAPS.left, `switch-${at}-left`)}
              <Text key={`switch-${at}`} color={row.enabled ? THEME.ok : THEME.muted} backgroundColor={fill}>{`${row.enabled ? MARK.stopOpen : MARK.stop} ${label}`}</Text>
              {end(CAPS.right, `switch-${at}-right`)}
            </Box>
            <Box key={`row-${at}-name`} flexShrink={0}>
              <Text color={nameColor}>{` ${icon ? `${icon} ` : ''}${row.name.padEnd(nameWidth)} `}</Text>
            </Box>
            {row.commands.length ? (
              <Box key={`row-${at}-commands`} flexShrink={1}>
                <Text color={THEME.muted} wrap="truncate-end">{` ${row.commands.map(name => `/${name}`).join(` ${MARK.sep} `)}`}</Text>
              </Box>
            ) : null}
            <Box key={`row-${at}-gap`} flexGrow={1} />
            {row.update ? (
              <Box key={`row-${at}-state`} flexShrink={0} paddingLeft={1}>
                <Text color={THEME.accent}>{row.update}</Text>
              </Box>
            ) : null}
            {hasCost ? (
              <Box key={`cost-${at}-cell`} flexShrink={0} paddingLeft={1}>
                {row.cost ? costPill({ Box, Text }, nerd, costGlyph, bg, `cost-${at}`) : <Text key={`cost-${at}-blank`}>{' '.repeat(COST_CELLS)}</Text>}
              </Box>
            ) : null}
            {hasGear ? (
              <Box key={`gear-${at}-cell`} flexShrink={0} paddingLeft={1}>
                {row.hasSettings ? gearPill({ Box, Text }, nerd, gear, bg, `gear-${at}`) : <Text key={`gear-${at}-blank`}>{' '.repeat(COST_CELLS)}</Text>}
              </Box>
            ) : null}
            <Box key={`row-${at}-version`} flexShrink={0} paddingLeft={1}>
              <Text color={THEME.muted}>{row.version.padStart(versionWidth)}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export default ModList
