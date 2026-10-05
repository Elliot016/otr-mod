// Shared look, see mod-builder/references/standard.md. Master in templates/cli-mod; copy unchanged into every mod that draws a pane or a pill.
import type { RenderElement } from 'claude-code'

import style from './style'
import { CAPS, decodeAll, THEME } from './theme'

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

// A section's heading: a rounded pill with its icon in Nerd mode, bold accent text in safe mode.
export function heading({ Box, Text }: Elements, look: Look, key: string, icon: string, title: string) {
  if (!look.nerd) {
    return (
      <Box key={`${key}-head`}>
        <Text color={THEME.accent} bold>{title}</Text>
      </Box>
    )
  }
  return (
    <Box key={`${key}-head`} flexDirection="row">
      <Text color={THEME.border}>{CAPS.left}</Text>
      <Box key={`${key}-head-body`} backgroundColor={THEME.border}>
        <Text color={THEME.onSurface} bold>{withIcon(look, icon, title)}</Text>
      </Box>
      <Text color={THEME.border}>{CAPS.right}</Text>
    </Box>
  )
}

// A tinted section; an empty title draws no heading.
export function section(elements: Elements, look: Look, key: string, icon: string, title: string, body: unknown) {
  const { Box } = elements
  return (
    <Box key={key} flexDirection="column" backgroundColor={THEME.surface1} marginTop={1} paddingX={1}>
      {title ? heading(elements, look, key, icon, title) : null}
      {body}
    </Box>
  )
}
