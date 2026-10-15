// hooks/pills.tsx, by v-amorim
// Shared pill row. Copy unchanged into every mod that draws in the row.
import type { RenderElement } from 'claude-code'

import { mix, type EntryProps, type Tip } from './entry'
import style from './style'
import { CAPS, decodeAll, THEME, WASH } from './theme'

// The menu group on Moonlight surface-3, readouts on surface-2.
export const PILL = { primary: style.colors.pills.primary, secondary: style.colors.pills.secondary }

// Menu entries left to right, by the id in their `menu-pad-<id>` Box key; an unknown id goes last.
const ENTRY_ORDER = ['manager', 'skills', 'prompts', 'filetree', 'progress', 'headsup']

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
    // A mod still running an older copy may draw `menu-group-sep-*` separators between entries; the group drops them.
    group: childrenOf(body).filter(child => !keyOf(child)?.startsWith('menu-group-sep')),
    row: pills.filter(child => keyOf(child) !== 'menu-group'),
    rest,
    tip: children.find(child => keyOf(child) === 'menu-tip') ?? null,
  }
}

// The one-line tip above the pill row, filled while the pointer is on an entry: its "Name:" in bold accent, the rest muted.
export const tipLine = ({ Box, Text }: Elements, text: string) => {
  const at = text.indexOf(': ')
  return (
    <Box key="menu-tip" paddingLeft={2} flexDirection="row">
      {at < 0 ? null : <Text color={THEME.accent} bold>{text.slice(0, at + 1)}</Text>}
      <Text color={THEME.muted}>{at < 0 ? text : text.slice(at + 1)}</Text>
    </Box>
  )
}

// One pill with its own caps where the font has them; `on` is what it sits on, `hover` lights the caps with a Button scoped `key`.
export function pill({ Box, Text }: Elements, nerd: boolean, bg: string, body: unknown, key = 'menu-pill', on?: string, hover?: string) {
  const under = on ? { backgroundColor: on } : {}
  const lit = hover ? { hover: { scope: key, color: hover } } : {}
  return (
    <Box key={key} flexDirection="row">
      {nerd ? <Text key={`${key}-cap-left`} color={bg} {...under} {...lit}>{CAPS.left}</Text> : null}
      <Box key={`${key}-body`} flexDirection="row" backgroundColor={bg}>
        {body}
      </Box>
      {nerd ? <Text key={`${key}-cap-right`} color={bg} {...under} {...lit}>{CAPS.right}</Text> : null}
    </Box>
  )
}

// mod-menu's `labels` state: `always` draws icon and label, `never` the icon alone (Nerd only; safe mode has no icon, so it keeps the label).
export type LabelsMode = 'always' | 'never'

// The value of `{ plugin: 'mod-menu', key: 'labels' }` as a mode; a missing or unknown value is `always`, so a mod works without mod-menu.
export const labelsOf = (value: unknown): LabelsMode => (value === 'never' ? 'never' : 'always')

// A panel's entry in the menu group, keyed `menu-pad-<id>` for the row's order; the open panel's entry is a pill of its own inside the group.
export function menuEntry({ Box, Client, Text }: Elements & { Client: (props: any) => RenderElement }, nerd: boolean, id: string, { labels, ...props }: Omit<EntryProps, 'id' | 'bg' | 'tight'> & { labels?: LabelsMode }) {
  // The open panel reads as selected, like an On switch: ok text on ok washed into the group fill.
  const bg = props.isOpen ? mix(THEME.ok, PILL.primary, WASH) : PILL.primary
  const glyph = (style.glyphs.nerd.icon as Record<string, string>)[`menu-${id}`]
  const icon = nerd && !props.lead && glyph ? decodeAll(glyph) : undefined
  // The icon sits tight against the cap, so the label that follows brings its own gap.
  const shown = icon ? { lead: icon, label: labels === 'never' ? '' : ` ${props.label}` } : {}
  // On Nerd the caps take the label's padding cells, so an entry is as wide as before the caps.
  const entry = <Client key={`menu-entry-${id}`} module="./entry.tsx" height={1} props={{ id, bg, ...props, ...(props.isOpen ? { color: THEME.ok } : {}), ...shown, nerd, tight: nerd } satisfies EntryProps} />
  return (
    <Box key={`menu-pad-${id}`} flexDirection="row">
      {/* A closed entry gets caps in the group's own color, so opening a panel never shifts its neighbours. */}
      {pill({ Box, Text }, nerd, bg, entry, props.isOpen ? `menu-open-${id}` : `menu-closed-${id}`, PILL.primary)}
    </Box>
  )
}

// The band above the prompt: what else it holds (Claude Code's own effort line), then the pill row, so the pills sit on the input.
export function pillRow(elements: Elements & { Client?: (props: any) => RenderElement }, nerd: boolean, group: unknown[], row: unknown[], rest: unknown[], tip: unknown = null, _columns?: number) {
  const { Box, Client, Text } = elements
  // Mods draw in load order, which an install or a toggle changes, so entries sort by a fixed rank instead.
  const rank = (entry: unknown) => {
    const at = ENTRY_ORDER.indexOf(String(keyOf(entry) ?? '').replace(/^menu-pad-/, ''))
    return at < 0 ? ENTRY_ORDER.length : at
  }
  // Like a choice bar: the entries side by side on one pill, the open panel's lifted into its own, a divider Client between neighbours.
  const sorted = [...group].sort((a, b) => rank(a) - rank(b))
  const entries = Client
    ? sorted.flatMap((entry, at) => (at === 0 ? [entry] : [<Client key={`menu-group-sep-${at}`} module="./entry.tsx" height={1} props={{ id: `sep-${at}`, label: '', isOpen: false, bg: PILL.primary, rail: true } satisfies EntryProps} />, entry]))
    : sorted
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

// One chip per view of a panel (its list, its settings), standing in for the title: id, label, icon glyph, an optional count and an optional hover tip.
export type Tab = { id: string; label: string; icon: string; isOpen: boolean; count?: number; tip?: Tip }

// A panel's title line: the open view on surface3 and bold, the others on surface2 and muted, each icon and count a subpill; a click swaps the view.
export function tabRow({ Box, Client, Text }: Elements & { Client: (props: any) => RenderElement }, nerd: boolean, tabs: Tab[], still: boolean) {
  return (
    <Box key="tab-row" flexDirection="row" columnGap={1}>
      {tabs.map(tab => {
        const bg = tab.isOpen ? THEME.surface3 : THEME.surface2
        // Client props refuse an undefined value, so a tab without a count or tip leaves the key out.
        const badge = tab.count === undefined ? {} : { badge: { text: String(tab.count), color: THEME.accent, bg: mix(THEME.accent, bg, WASH) } }
        const tip = tab.tip ? { tip: tab.tip } : {}
        const entry = (
          <Client key={tab.id} module="./entry.tsx" height={1} props={{ id: tab.id, label: tab.label, isOpen: tab.isOpen, bg, idle: THEME.muted, still, subLead: tab.icon, subLeadColor: THEME.accent, nerd, ...badge, ...tip } satisfies EntryProps} />
        )
        return pill({ Box, Text }, nerd, bg, entry, `${tab.id}-pill`)
      })}
    </Box>
  )
}
