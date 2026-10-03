// Shared mod theme, see mod-builder/references/standard.md. Copy unchanged; edit the template first.
export const THEME = {
  bg: '#0D0E17',
  surface1: '#141726',
  border: '#3A3F5C',
  onSurface: '#EEEEFA',
  muted: '#9BA3C4',
  accent: '#7386D0',
  secondary: '#B9C6F5',
  good: '#49EF95',
  alert: '#CA5F71',
}

export const MARK = { stage: '▸', cursor: '❯', bullet: '•', ok: '✓', warn: '⚠', sep: '·' }

export const statusColor = (note: string) =>
  note.startsWith(MARK.ok) ? THEME.good : note.startsWith(MARK.warn) ? THEME.alert : THEME.muted
