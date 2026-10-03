// Shared toast cards, see mod-builder/references/recipes.md. Master in mod-menu; copy unchanged into every mod that toasts.
import type { RenderElement } from 'claude-code'

import { THEME } from './theme'

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

export const TOAST_MS = 4000
const MAX_TOASTS = 3

// A mod's own toasts, newest last. A toast reaches only the hooks above its caller, so each mod catches its own.
export class ToastList {
  items: { id: number; text: string }[] = []
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

// Each toast as a card the width of the band, its text wrapped, with a × to dismiss it.
export const toastCards = ({ Box, Client, Text }: Elements, list: ToastList) =>
  list.items.map(toast => {
    const id = `toast-${list.prefix}-${toast.id}`
    return (
      <Box key={id} flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.accent} backgroundColor={THEME.surface1}>
        <Box key={`${id}-text`} flexGrow={1} flexShrink={1}>
          <Text color={THEME.onSurface} wrap="wrap">{toast.text}</Text>
        </Box>
        <Box key={`${id}-close`} flexShrink={0}>
          <Client key={id} module="./entry.tsx" height={1} props={{ id, label: '×', isOpen: false, bg: THEME.surface1 }} />
        </Box>
      </Box>
    )
  })
