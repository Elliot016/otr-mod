// Shared pill row, see mod-builder/references/standard.md. Copy unchanged into every mod that draws in the row.
import type { RenderElement } from 'claude-code'

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

// One pill with its own caps, so it stands alone whichever mods are loaded; caps only where the font has them.
export function pill({ Box, Text }: Elements, nerd: boolean, bg: string, body: unknown, key = 'menu-pill') {
  return (
    <Box key={key} flexDirection="row">
      {nerd ? <Text key={`${key}-cap-left`} color={bg}>{CAPS.left}</Text> : null}
      <Box key={`${key}-body`} flexDirection="row" backgroundColor={bg}>
        {body}
      </Box>
      {nerd ? <Text key={`${key}-cap-right`} color={bg}>{CAPS.right}</Text> : null}
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

// A panel's title row: the title, then a pill entry at the right end that swaps the panel and its settings.
export function titleRow({ Box, Client, Text }: Elements & { Client: (props: any) => RenderElement }, nerd: boolean, title: unknown, id: string, label: string, still: boolean) {
  const entry = <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: false, bg: PILL.primary, idle: THEME.pill, still }} />
  return (
    <Box key="title-row" flexDirection="row">
      <Box key="title-row-text" flexGrow={1} flexShrink={1}>{title}</Box>
      {pill({ Box, Text }, nerd, PILL.primary, entry, `${id}-pill`)}
    </Box>
  )
}
