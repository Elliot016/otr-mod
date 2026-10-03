// Shared look, see mod-builder/references/standard.md. Master in templates/cli-mod; copy unchanged into every mod that draws a pane or a pill.
import type { RenderElement } from 'claude-code'

import { THEME } from './theme'

// A Nerd Font glyph by its code point; Write and Edit drop private-use characters typed into a file.
const nf = (code: number) => String.fromCodePoint(code)

// Safe mode: common Unicode that every modern terminal font draws. Headings and rows carry no icon.
const SAFE = {
  on: '[◉]',
  off: '[○]',
  go: '[↵]',
  cycle: '[↻]',
  down: '[−]',
  up: '[+]',
  locked: '[■]',
  close: '[×]',
  warn: '!',
  ok: '✓',
  expanded: '▾',
  collapsed: '▸',
  back: '<',
  title: '▸',
  gear: '⚙',
  icon: {} as Record<string, string>,
}

// Nerd mode: Font Awesome and Material glyphs from any Nerd Font, controls padded to the same three cells.
const NERD: typeof SAFE = {
  on: ` ${nf(0xf205)} `,
  off: ` ${nf(0xf204)} `,
  go: ` ${nf(0xf054)} `,
  cycle: ` ${nf(0xf021)} `,
  down: ` ${nf(0xf068)} `,
  up: ` ${nf(0xf067)} `,
  locked: ` ${nf(0xf023)} `,
  close: ` ${nf(0xf00d)} `,
  warn: nf(0xea6c),
  ok: nf(0xeab2),
  expanded: nf(0xeab4),
  collapsed: nf(0xeab6),
  back: nf(0xf053),
  title: nf(0xf054),
  gear: nf(0xf013),
  icon: {
    settings: nf(0xf1de),
    actions: nf(0xf0e7),
    features: nf(0xf005),
    mod: nf(0xf12e),
    installed: nf(0xf487),
    skill: nf(0xf0d0),
    prompt: nf(0xf075),
    fold: nf(0xf066),
    // VS Code's own sets: codicons for chrome, seti for file types.
    files: nf(0xeb86),
    replay: nf(0xea82),
    folder: nf(0xea83),
    'folder-open': nf(0xeaf7),
    file: nf(0xea7b),
    'ext-ts': nf(0xe628),
    'ext-react': nf(0xe625),
    'ext-js': nf(0xe781),
    'ext-json': nf(0xe60b),
    'ext-md': nf(0xe609),
    'ext-py': nf(0xe73c),
    'ext-config': nf(0xe615),
    'ext-sh': nf(0xf489),
    Edit: nf(0xf040),
    MultiEdit: nf(0xf040),
    NotebookEdit: nf(0xf040),
    Write: nf(0xf15b),
    Read: nf(0xf02d),
    Bash: nf(0xf120),
    Grep: nf(0xf002),
    Glob: nf(0xf002),
    Agent: nf(0xf06a9),
    Task: nf(0xf06a9),
    Skill: nf(0xf0d0),
    WebFetch: nf(0xf0ac),
    WebSearch: nf(0xf0ac),
    TodoWrite: nf(0xf0ae),
    tool: nf(0xf0ad),
  },
}

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
      <Text color={THEME.border}>{nf(0xe0b6)}</Text>
      <Box key={`${key}-head-body`} backgroundColor={THEME.border}>
        <Text color={THEME.onSurface} bold>{withIcon(look, icon, title)}</Text>
      </Box>
      <Text color={THEME.border}>{nf(0xe0b4)}</Text>
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
