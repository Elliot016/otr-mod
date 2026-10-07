// Shared toast cards. Master in mod-menu; copy unchanged into every mod that toasts.
import type { RenderElement } from 'claude-code'

import type { Tip } from './entry'
import style from './style'
import { CAPS, MARK, THEME } from './theme'

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// The part of a mod's look.tsx Look the cards read; mod-menu carries no look.tsx, so it is typed here.
type ToastLook = { nerd: boolean; glyph: { close: string } }

export const TOAST_MS = 4000

// What the × says when the caller passes no tip of its own.
const DISMISS_TIP = { label: 'Dismiss', text: 'hides this message' }
const MAX_TOASTS = 3

// A mod's own toasts, newest last. A toast reaches only the hooks above its caller, so each mod catches its own.
export class ToastList {
  items: { id: number; text: string }[] = []
  // The owning mod's animations setting is off, so the dismiss × does not fade.
  isStill = false
  private lastId = 0

  // `prefix` keeps the dismiss Client keys apart from other mods' cards in the band.
  constructor(readonly prefix: string) {}

  add(text: string) {
    const id = (this.lastId += 1)
    this.items = [...this.items, { id, text }].slice(-MAX_TOASTS)
    return id
  }

  drop(id: number) {
    this.items = this.items.filter(toast => toast.id !== id)
  }

  // The toast a dismiss click names, or undefined when the click was not on one of these cards.
  idOf(entryId: string) {
    const head = `toast-${this.prefix}-`
    return entryId.startsWith(head) ? Number(entryId.slice(head.length)) : undefined
  }
}

// A control glyph without the brackets and padding it has as a standalone button (safe `[×]`), since a pill already frames it.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// The tone a toast's text opens with, so callers keep writing `✓ Saved` or `! Failed` and the card draws the mark.
function toneOf(text: string) {
  for (const [mark, color, bold] of [[MARK.ok, THEME.good, false], [MARK.warn, THEME.alert, true]] as const) {
    if (text.startsWith(mark)) return { mark, color, bold, text: text.slice(mark.length).trimStart() }
  }
  return { mark: MARK.bullet, color: THEME.accent, bold: false, text }
}

// Each toast as a card the width of the band: its status mark, its text wrapped, and a × pill to dismiss it.
// closeTip: the × hover tip's label and text, the same for every card; the owning mod's ui.message answers the tip post.
export const toastCards = ({ Box, Client, Text }: Elements, list: ToastList, look?: ToastLook, closeTip: Pick<Tip, 'label' | 'text'> = DISMISS_TIP) =>
  list.items.map(toast => {
    const id = `toast-${list.prefix}-${toast.id}`
    const tone = toneOf(toast.text)
    const nerd = look?.nerd === true
    const close = bare(look?.glyph.close ?? style.glyphs.safe.close)
    return (
      <Box key={id} flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.accent} backgroundColor={THEME.surface1}>
        <Box key={`${id}-mark`} flexShrink={0}>
          <Text color={tone.color} bold={tone.bold}>{tone.mark}</Text>
        </Box>
        <Box key={`${id}-text`} flexGrow={1} flexShrink={1}>
          <Text color={THEME.onSurface} wrap="wrap">{tone.text}</Text>
        </Box>
        <Box key={`${id}-close`} flexDirection="row" flexShrink={0}>
          {nerd ? <Text key={`${id}-close-left`} color={THEME.surface3} backgroundColor={THEME.surface1}>{CAPS.left}</Text> : null}
          <Client key={id} module="./entry.tsx" height={1} props={{ id, label: close, isOpen: false, bg: THEME.surface3, still: list.isStill, tip: { glyph: close, ...closeTip } }} />
          {nerd ? <Text key={`${id}-close-right`} color={THEME.surface3} backgroundColor={THEME.surface1}>{CAPS.right}</Text> : null}
        </Box>
      </Box>
    )
  })
