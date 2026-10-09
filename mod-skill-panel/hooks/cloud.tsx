// mod-skill-panel / hooks/cloud.tsx, by v-amorim
// Lays out and draws the tag cloud of skill chips with hover and click.
import type { ClientModule } from 'claude-code'

import { mix, postTip } from './entry'
import { TAG_WASH } from './tags'
import { CAPS, THEME } from './theme'

export type CloudGroup = { tag: string; label: string; icon: string; hex: string; skills: { index: number; name: string; tip: string }[] }

export type CloudProps = { groups: CloudGroup[]; width: number; selected: number; nerd: boolean }

// Pointing at a chip is a tip message with id `chip:<index>` (one post per frame lands, so no separate hover); a click posts `add`.
export type CloudMessage = { type: 'add'; index: number }

type Placed = { x: number; width: number; index: number; name: string; tip: string }

// Cells a pill takes around its text: both caps in Nerd mode, a space each side in safe mode.
const ENDS = 2

// The tag pill column, then each group's skills as chips that wrap under it to the next row; a faint rule between groups.
export function layoutCloud(groups: CloudGroup[], width: number) {
  const lead = Math.max(0, ...groups.map(group => ENDS + group.icon.length + 1 + group.label.length)) + 1
  const rows: { group: number; chips: Placed[]; isRule?: boolean }[] = []
  groups.forEach((group, at) => {
    if (at > 0) rows.push({ group: -1, chips: [], isRule: true })
    let row = { group: at, chips: [] as Placed[] }
    rows.push(row)
    let x = lead
    for (const skill of group.skills) {
      const chip = ENDS + 2 + skill.name.length
      if (row.chips.length > 0 && x + chip > width) {
        row = { group: -1, chips: [] }
        rows.push(row)
        x = lead
      }
      row.chips.push({ x, width: chip, index: skill.index, name: skill.name, tip: skill.tip })
      x += chip + 1
    }
  })
  return { lead, rows }
}

// Every skill as a chip under its tag: the pointer on one shows it in the panel's card, a click adds it to the prompt.
const Cloud: ClientModule<CloudProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { groups, width, selected, nerd } = props
  const { lead, rows } = layoutCloud(groups, width)
  // A Client takes no hover prop, so it tracks the chip under the pointer itself.
  const hovered = surface.state ?? -1
  const lit = hovered >= 0 ? hovered : selected

  surface.onPointer(event => {
    const chip = event.type === 'leave' ? undefined : rows[event.y]?.chips.find(each => event.x >= each.x && event.x < each.x + each.width)
    const index = chip?.index ?? -1
    const isClick = event.type === 'down' && event.button === 'left' && index >= 0
    if (index !== hovered) {
      surface.setState(index)
      const group = groups.find(each => each.skills.some(skill => skill.index === index))
      if (!isClick) postTip(surface, index >= 0 ? `chip:${index}` : 'chip', chip && group ? { glyph: group.icon, label: chip.name, text: chip.tip } : null)
    }
    if (isClick) surface.post({ type: 'add', index } satisfies CloudMessage)
  })

  const pill = (key: string, fill: string, body: unknown) => (
    <Box key={key} flexDirection="row" flexShrink={0}>
      <Text key={`${key}-left`} color={fill} {...(nerd ? {} : { backgroundColor: fill })}>{nerd ? CAPS.left : ' '}</Text>
      <Box key={`${key}-body`} flexDirection="row" backgroundColor={fill}>{body}</Box>
      <Text key={`${key}-right`} color={fill} {...(nerd ? {} : { backgroundColor: fill })}>{nerd ? CAPS.right : ' '}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column">
      {rows.map((row, at) => {
        if (row.isRule) return <Text key={`row-${at}`} color={THEME.surface3}>{'─'.repeat(width)}</Text>
        const group = groups[row.group]
        return (
          <Box key={`row-${at}`} flexDirection="row">
            <Box key={`row-${at}-lead`} width={lead} flexShrink={0}>
              {group
                ? pill(`tag-${at}`, mix(group.hex, THEME.surface1, TAG_WASH), <Text color={group.hex}>{`${group.icon} ${group.label}`}</Text>)
                : null}
            </Box>
            <Box key={`row-${at}-chips`} flexDirection="row" columnGap={1}>
              {row.chips.map(chip => {
                const isLit = chip.index === lit
                const hex = groups.find(each => each.skills.some(skill => skill.index === chip.index))?.hex ?? THEME.muted
                return pill(`chip-${chip.index}`, isLit ? THEME.lifted : THEME.surface3, (
                  <Text key={`chip-${chip.index}-text`}>
                    <Text color={hex}>{'● '}</Text>
                    <Text color={isLit ? THEME.onSurface : THEME.secondary}>{chip.name}</Text>
                  </Text>
                ))
              })}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export default Cloud
