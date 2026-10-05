// Shared pill row, see mod-builder/references/standard.md. Copy unchanged into every mod that draws in the row.
import type { RenderElement } from 'claude-code'

import { mix, type EntryProps } from './entry'
import style from './style'
import { CAPS, THEME } from './theme'

// The menu group on Moonlight surface-3, readouts on surface-2.
export const PILL = { primary: style.colors.pills.primary, secondary: style.colors.pills.secondary }

// Menu entries left to right, by the id in their `menu-pad-<id>` Box key; an unknown id goes last.
const ENTRY_ORDER = ['manager', 'skills', 'prompts', 'filetree']


type Node = { props?: Record<string, unknown>; children?: unknown[] } | null | undefined
type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

const keyOf = (node: unknown) => (node as Node)?.props?.key as string | undefined
const childrenOf = (node: unknown) => (node as Node)?.children ?? []

// Splits next(e) into the menu entries other mods drew, the rest of the row, what else the band holds, and the hover tip under the row.
export function splitRow(others: unknown) {
  if (keyOf(others) !== 'menu-rows') return { group: [] as unknown[], row: [] as unknown[], rest: [others], tip: null as unknown }
  const children = childrenOf(others)
  const rest = children.filter(child => keyOf(child) !== 'menu-row' && keyOf(child) !== 'menu-tip')
  const pills = childrenOf(children.find(child => keyOf(child) === 'menu-row'))
  const groupPill = pills.find(child => keyOf(child) === 'menu-group')
  const body = childrenOf(groupPill).find(child => keyOf(child) === 'menu-group-body')
  return {
    group: childrenOf(body).filter(child => !keyOf(child)?.startsWith('menu-group-sep')),
    row: pills.filter(child => keyOf(child) !== 'menu-group'),
    rest,
    tip: children.find(child => keyOf(child) === 'menu-tip') ?? null,
  }
}

// The one-line tip above the pill row, filled while the pointer is on an entry.
export const tipLine = ({ Box, Text }: Elements, text: string) => (
  <Box key="menu-tip" paddingLeft={2}>
    <Text color={THEME.muted}>{text}</Text>
  </Box>
)

// One pill with its own caps where the font has them; `on` is what it sits on when that is another pill or a card.
export function pill({ Box, Text }: Elements, nerd: boolean, bg: string, body: unknown, key = 'menu-pill', on?: string) {
  const under = on ? { backgroundColor: on } : {}
  return (
    <Box key={key} flexDirection="row">
      {nerd ? <Text key={`${key}-cap-left`} color={bg} {...under}>{CAPS.left}</Text> : null}
      <Box key={`${key}-body`} flexDirection="row" backgroundColor={bg}>
        {body}
      </Box>
      {nerd ? <Text key={`${key}-cap-right`} color={bg} {...under}>{CAPS.right}</Text> : null}
    </Box>
  )
}

// A panel's entry in the menu group, keyed `menu-pad-<id>` for the row's order; the open panel's entry is a pill of its own inside the group.
export function menuEntry({ Box, Client, Text }: Elements & { Client: (props: any) => RenderElement }, nerd: boolean, id: string, props: Omit<EntryProps, 'id' | 'bg'>) {
  const bg = props.isOpen ? THEME.lifted : PILL.primary
  const entry = <Client key={`menu-entry-${id}`} module="./entry.tsx" height={1} props={{ id, bg, ...props } satisfies EntryProps} />
  return (
    <Box key={`menu-pad-${id}`} flexDirection="row">
      {props.isOpen ? pill({ Box, Text }, nerd, bg, entry, `menu-open-${id}`, PILL.primary) : entry}
    </Box>
  )
}

// The band above the prompt: what else it holds (Claude Code's own effort line), then the pill row, so the pills sit on the input.
export function pillRow(elements: Elements, nerd: boolean, group: unknown[], row: unknown[], rest: unknown[], tip: unknown = null) {
  const { Box, Text } = elements
  // Mods draw in load order, which an install or a toggle changes, so entries sort by a fixed rank instead.
  const rank = (entry: unknown) => {
    const at = ENTRY_ORDER.indexOf(String(keyOf(entry) ?? '').replace(/^menu-pad-/, ''))
    return at < 0 ? ENTRY_ORDER.length : at
  }
  const sorted = [...group].sort((a, b) => rank(a) - rank(b))
  const entries = sorted.flatMap((entry, index) =>
    // Boxes keep their key in the drawn tree and Texts lose it, so the separator sits in a keyed Box the next mod can drop.
    index === 0 ? [entry] : [<Box key={`menu-group-sep-${index}`}><Text color={style.colors.pills.separator}>{style.marks.bullet}</Text></Box>, entry],
  )
  return (
    <Box key="menu-rows" flexDirection="column">
      {rest}
      {/* Above the row, kept even when empty so nothing above jumps when a tip appears. */}
      {tip ?? tipLine(elements, ' ')}
      <Box key="menu-row" flexDirection="row" columnGap={1}>
        {group.length > 0 ? pill(elements, nerd, PILL.primary, entries, 'menu-group') : null}
        {row}
      </Box>
    </Box>
  )
}

// One chip per view of a panel (its list, its settings), standing in for the title: id, label, icon glyph and an optional count.
export type Tab = { id: string; label: string; icon: string; isOpen: boolean; count?: number }

// The share of the chip's own color left in a count badge, as the turn-fold chips tint theirs.
const BADGE_WASH = 0.72

// A panel's title line, drawn like the turn-fold chips: the open view lifted and bold, the others muted, a click swaps the view.
export function tabRow({ Box, Client, Text }: Elements & { Client: (props: any) => RenderElement }, nerd: boolean, tabs: Tab[], still: boolean) {
  return (
    <Box key="tab-row" flexDirection="row" columnGap={1}>
      {tabs.map(tab => {
        const bg = tab.isOpen ? THEME.lifted : THEME.surface3
        // Client props refuse an undefined value, so a tab without a count leaves the key out.
        const badge = tab.count === undefined ? {} : { badge: { text: String(tab.count), color: THEME.accent, bg: mix(THEME.accent, bg, BADGE_WASH) } }
        const entry = (
          <Client key={tab.id} module="./entry.tsx" height={1} props={{ id: tab.id, label: tab.label, isOpen: tab.isOpen, bg, idle: THEME.muted, still, lead: tab.icon, leadColor: THEME.accent, nerd, ...badge } satisfies EntryProps} />
        )
        return pill({ Box, Text }, nerd, bg, entry, `${tab.id}-pill`)
      })}
    </Box>
  )
}
