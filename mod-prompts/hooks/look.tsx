// Shared look; every mod carries the same copy.
import type { RenderElement } from 'claude-code'

import style from './style'
import type { Tip } from './entry'
import { CAPS, decodeAll, MARK, mix, THEME, WASH } from './theme'

type Glyphs = Omit<typeof style.glyphs.nerd, 'icon' | 'mark'> & { icon: Record<string, string>; mark: Record<string, string> }

// Safe mode: common Unicode that every modern terminal font draws. Headings and rows carry no icon.
const SAFE: Glyphs = decodeAll(style.glyphs.safe)

// Nerd mode: Font Awesome, Material and VS Code glyphs from any Nerd Font, controls padded to the same three cells.
const NERD: Glyphs = decodeAll(style.glyphs.nerd)

export type Look = { nerd: boolean; glyph: typeof SAFE }

export const lookFor = (nerd: boolean): Look => ({ nerd, glyph: nerd ? NERD : SAFE })

// The icons setting every drawing mod declares in its userConfig.
export type IconMode = 'auto' | 'nerd' | 'safe'

// Windows Terminal is the one terminal whose font a mod can read, so auto checks these files and stays safe elsewhere.
export const terminalSettings = (localAppData: string) => [
  `${localAppData}/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`,
  `${localAppData}/Microsoft/Windows Terminal/settings.json`,
]

export const isNerdFace = (settingsText: string) => /"face"\s*:\s*"[^"]*(nerd|\bNFM?\b)/i.test(settingsText)

// `text` led by its icon in Nerd mode; the text alone in safe mode or when the name has no icon.
export const withIcon = (look: Look, name: string, text: string) => (look.glyph.icon[name] ? `${look.glyph.icon[name]} ${text}` : text)

// A status note with its leading mark (MARK.warn or MARK.ok from theme.ts) drawn as this look's glyph.
export function withMark(look: Look, note: string) {
  if (note.startsWith('! ')) return `${look.glyph.warn} ${note.slice(2)}`
  if (note.startsWith('✓ ')) return `${look.glyph.ok} ${note.slice(2)}`
  return note
}

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// A pane's title line: the name's icon in Nerd mode, the safe mark otherwise.
export const paneTitle = ({ Text }: Elements, look: Look, icon: string, text: string) => (
  <Text key="pane-title" color={THEME.accent} bold>{`${look.glyph.icon[icon] ?? look.glyph.title} ${text}`}</Text>
)

// The footer rows every pane reserves at its bottom: a rule, then the hovered control's glyph, label and what it does.
export const FOOTER_ROWS = 2

// Pinned at the pane bottom (scroll offset plus body rows); the row under the rule stays blank with no tip, so nothing jumps.
export function paneFooter({ Box, Text }: Elements, tip: Tip | null, columns: number, scroll: { offset: number; bodyRows: number }) {
  return (
    <Box key="pane-footer" position="absolute" top={Math.max(0, scroll.offset + scroll.bodyRows - FOOTER_ROWS)} left={0} width={columns} height={FOOTER_ROWS} flexDirection="column">
      <Text key="footer-rule" color={THEME.border}>{MARK.rule.repeat(Math.max(1, columns))}</Text>
      {tip ? (
        <Box key="footer-tip" flexDirection="row" paddingX={1}>
          <Text color={THEME.accent}>{tip.glyph}</Text>
          <Text color={THEME.onSurface} wrap="truncate-end">{` ${tip.label}`}</Text>
          <Text color={THEME.muted} wrap="truncate-end">{` ${MARK.sep} ${tip.text}`}</Text>
        </Box>
      ) : (
        <Text key="footer-tip"> </Text>
      )}
    </Box>
  )
}

// A pill's leading icon, mark or digit, or its count: a rounded subpill washed from `hue` into the `fill` it sits on.
export function subpill({ Box, Text }: Elements, nerd: boolean, fill: string, text: string, key: string, hue: string = THEME.accent) {
  const bg = mix(hue, fill, WASH)
  return (
    <Box key={key} flexDirection="row" flexShrink={0}>
      {nerd ? <Text key={`${key}-left`} color={bg} backgroundColor={fill}>{CAPS.left}</Text> : null}
      <Text key={`${key}-text`} color={hue} backgroundColor={bg} bold>{nerd ? text : ` ${text} `}</Text>
      {nerd ? <Text key={`${key}-right`} color={bg} backgroundColor={fill}>{CAPS.right}</Text> : null}
    </Box>
  )
}

// A section's heading: a surface3 pill led by its icon as a subpill in Nerd mode, bold accent text in safe mode.
export function heading(elements: Elements, look: Look, key: string, icon: string, title: string) {
  const { Box, Text } = elements
  if (!look.nerd) {
    return (
      <Box key={`${key}-head`}>
        <Text color={THEME.accent} bold>{title}</Text>
      </Box>
    )
  }
  const glyph = look.glyph.icon[icon]
  return (
    <Box key={`${key}-head`} flexDirection="row">
      <Text color={THEME.surface3}>{CAPS.left}</Text>
      <Box key={`${key}-head-body`} flexDirection="row" backgroundColor={THEME.surface3}>
        {glyph ? subpill(elements, true, THEME.surface3, glyph, `${key}-head-icon`) : null}
        <Text color={THEME.onSurface} bold>{glyph ? ` ${title}` : title}</Text>
      </Box>
      <Text color={THEME.surface3}>{CAPS.right}</Text>
    </Box>
  )
}

// A round-bordered card with its heading on the first row; an empty title draws the border alone.
export function section(elements: Elements, look: Look, key: string, icon: string, title: string, body: unknown) {
  const { Box } = elements
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={THEME.border} backgroundColor={THEME.surface1} marginTop={1} paddingX={1}>
      {title ? heading(elements, look, key, icon, title) : null}
      {body}
    </Box>
  )
}

