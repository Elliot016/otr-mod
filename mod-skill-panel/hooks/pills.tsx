// Shared pill row, see mod-builder/references/standard.md. Copy unchanged into every mod that draws in the row.
import type { RenderElement } from 'claude-code'

// The Moonlight-claude oh-my-posh backgrounds: the menu group on primary, readouts on secondary.
export const PILL = { primary: '#141726', secondary: '#1C2033' }

const CAP_LEFT = '\uE0B6'
const CAP_RIGHT = '\uE0B4'

type Node = { props?: Record<string, unknown>; children?: unknown[] } | null | undefined
type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

const keyOf = (node: unknown) => (node as Node)?.props?.key as string | undefined
const childrenOf = (node: unknown) => (node as Node)?.children ?? []

// Splits next(e) into the menu entries other mods drew, the rest of the row, and what else the band holds.
export function splitRow(others: unknown) {
  if (keyOf(others) !== 'menu-rows') return { group: [] as unknown[], row: [] as unknown[], rest: [others] }
  const children = childrenOf(others)
  const rest = children.filter(child => keyOf(child) !== 'menu-row')
  const pills = childrenOf(children.find(child => keyOf(child) === 'menu-row'))
  const groupPill = pills.find(child => keyOf(child) === 'menu-group')
  const body = childrenOf(groupPill).find(child => keyOf(child) === 'menu-group-body')
  return {
    group: childrenOf(body).filter(child => !keyOf(child)?.startsWith('menu-group-sep')),
    row: pills.filter(child => keyOf(child) !== 'menu-group'),
    rest,
  }
}

// One pill with its own caps, so it stands alone whichever mods are loaded; caps only where the font has them.
export function pill({ Box, Text }: Elements, nerd: boolean, bg: string, body: unknown, key = 'menu-pill') {
  return (
    <Box key={key} flexDirection="row">
      {nerd ? <Text key={`${key}-cap-left`} color={bg}>{CAP_LEFT}</Text> : null}
      <Box key={`${key}-body`} flexDirection="row" backgroundColor={bg}>
        {body}
      </Box>
      {nerd ? <Text key={`${key}-cap-right`} color={bg}>{CAP_RIGHT}</Text> : null}
    </Box>
  )
}

// The band above the prompt: what else it holds (Claude Code's own effort line), then the pill row, so the pills sit on the input.
export function pillRow(elements: Elements, nerd: boolean, group: unknown[], row: unknown[], rest: unknown[]) {
  const { Box, Text } = elements
  const entries = group.flatMap((entry, index) =>
    // Boxes keep their key in the drawn tree and Texts lose it, so the separator sits in a keyed Box the next mod can drop.
    index === 0 ? [entry] : [<Box key={`menu-group-sep-${index}`}><Text color="#3A3F5C">│</Text></Box>, entry],
  )
  return (
    <Box key="menu-rows" flexDirection="column">
      {rest}
      <Box key="menu-row" flexDirection="row" columnGap={1}>
        {group.length > 0 ? pill(elements, nerd, PILL.primary, entries, 'menu-group') : null}
        {row}
      </Box>
    </Box>
  )
}
