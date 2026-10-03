// Shared mod theme, see mod-builder/references/standard.md. Copy unchanged; edit the template first.
export const THEME = {
  bg: '#0D0E17',
  surface1: '#141726',
  // Moonlight surface-2: the active tab, a section header, a row highlight.
  surface2: '#1C2033',
  border: '#3A3F5C',
  onSurface: '#EEEEFA',
  muted: '#9BA3C4',
  accent: '#7386D0',
  secondary: '#B9C6F5',
  good: '#49EF95',
  alert: '#CA5F71',
  // Moonlight warning: cautions only, never decoration.
  warn: '#FFCB6B',
  // Moonlight-claude usage_0, the statusline text: pill-row labels at rest.
  pill: '#CED9FF',
  // Moonlight diff insert and delete, blended over surface1 because a terminal draws no alpha.
  addBg: '#1D3B38',
  delBg: '#3D2737',
}

// Moonlight syntax roles, for drawing a shell command: what runs, its options, quoted text, variables, numbers and the glue between steps.
export const SYNTAX = {
  command: '#7386D0',
  option: '#FFAFAF',
  text: '#A5CFFF',
  variable: '#79C0FF',
  number: '#B0C8FF',
  operator: '#CDCFE7',
}

// One cell each and never an emoji: ⚠ switches to its emoji form in some fonts and draws two cells wide.
export const MARK = { stage: '▸', cursor: '❯', bullet: '•', ok: '✓', warn: '!', sep: '·' }

export const statusColor = (note: string) =>
  note.startsWith(MARK.ok) ? THEME.good : note.startsWith(MARK.warn) ? THEME.alert : THEME.muted
