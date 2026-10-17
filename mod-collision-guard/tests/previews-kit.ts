// tests/previews-kit.ts, by v-amorim: a drawn tree as the literal example lines of showcase.json and tests/previews.snapshot.ts.
import { THEME } from '../hooks/theme'

export type Span = { text: string; color?: string; bg?: string; bold?: boolean }
export type Line = { spans: Span[] }
export type Frame = { border: string; bg: string }
export type Captured = { frame?: Frame; lines: Line[] }
export type Mode = 'nerd' | 'safe'
export type Snapshot = Record<string, Record<string, { frame?: Frame; nerd: Line[]; safe: Line[] }>>

type Plain = { type: string; props?: Record<string, any>; children?: Node[] }
type Node = string | number | boolean | null | undefined | Plain
type Cell = Span
type Block = Cell[][]
// A Client's drawing, asked by key and, when its element names a size, at that many cells.
export type Expand = (key: string, size?: { columns: number; rows: number }) => Promise<Node>
type Context = { expand: Expand; width?: number; height?: number; bg?: string; color?: string; bold?: boolean }

const size = (line: Cell[]) => line.reduce((sum, cell) => sum + Array.from(cell.text).length, 0)
const widthOf = (block: Block) => block.reduce((most, line) => Math.max(most, size(line)), 0)
const blank = (count: number, bg?: string): Cell[] => (count > 0 ? [{ text: ' '.repeat(count), ...(bg ? { bg } : {}) }] : [])
const padTo = (line: Cell[], width: number, bg?: string) => [...line, ...blank(width - size(line), bg)]
const number = (value: unknown) => (typeof value === 'number' ? value : 0)
const isPlain = (node: Node): node is Plain => typeof node === 'object' && node !== null
const kids = (node: Plain): Node[] => (node.children ?? []).flat(Infinity as 1) as Node[]
const propsOf = (node: Node) => (isPlain(node) ? (node.props ?? {}) : {})
const percent = (value: unknown, of?: number) => (typeof value === 'number' ? value : typeof value === 'string' && value.endsWith('%') && of !== undefined ? Math.floor((of * parseFloat(value)) / 100) : undefined)

// The cells from column `from` up to `to` of a line.
function take(line: Cell[], from: number, to: number): Cell[] {
  const out: Cell[] = []
  let at = 0
  for (const cell of line) {
    const chars = Array.from(cell.text)
    const start = Math.max(from, at)
    const end = Math.min(to, at + chars.length)
    if (end > start) out.push({ ...cell, text: chars.slice(start - at, end - at).join('') })
    at += chars.length
  }
  return out
}

// `over` drawn on top of a line from column `at`, as a positioned Box lies over its parent.
function place(line: Cell[], at: number, over: Cell[]): Cell[] {
  const base = padTo(line, at)
  return [...take(base, 0, at), ...over, ...take(base, at + size(over), Infinity)]
}

// Words wrapped at `width`, as the terminal wraps a Text; a word wider than the line breaks.
function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const hard of text.split('\n')) {
    let line = ''
    for (const word of hard.split(/(?<= )/)) {
      if (Array.from(line + word.trimEnd()).length > width && line) {
        out.push(line.trimEnd())
        line = ''
      }
      line += word
    }
    out.push(line.trimEnd())
  }
  return out
}

async function inline(node: Node, context: Context): Promise<Cell[]> {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (!isPlain(node)) return [{ text: String(node), color: context.color, bg: context.bg, bold: context.bold }]
  const props = node.props ?? {}
  const next = { ...context, color: props.color ?? context.color, bg: props.backgroundColor ?? context.bg, bold: props.bold ?? context.bold }
  return (await Promise.all(kids(node).map(child => inline(child, next)))).flat()
}

async function textBlock(node: Plain, context: Context): Promise<Block> {
  const cells = await inline(node, context)
  const lines: Cell[][] = [[]]
  for (const cell of cells) {
    cell.text.split('\n').forEach((part, at) => {
      if (at > 0) lines.push([])
      if (part) lines[lines.length - 1]!.push({ ...cell, text: part })
    })
  }
  const limit = context.width
  if (!limit || lines.every(line => size(line) <= limit)) return lines
  if (node.props?.wrap === 'truncate' || node.props?.wrap === 'truncate-end') {
    return lines.map(line => (size(line) <= limit ? line : [{ ...line[0]!, text: `${Array.from(line.map(cell => cell.text).join('')).slice(0, limit - 1).join('')}…` }]))
  }
  // A wrapped line keeps its first cell's look, which is exact for a text of one color and close for a mix.
  return lines.flatMap(line => (size(line) <= limit ? [line] : wrap(line.map(cell => cell.text).join(''), limit).map(text => [{ ...line[0]!, text }])))
}

const chars = (...codes: number[]) => codes.map(code => String.fromCodePoint(code))
const BORDERS: Record<string, string[]> = {
  round: chars(0x256d, 0x2500, 0x256e, 0x2502, 0x2570, 0x256f),
  single: chars(0x250c, 0x2500, 0x2510, 0x2502, 0x2514, 0x2518),
  double: chars(0x2554, 0x2550, 0x2557, 0x2551, 0x255a, 0x255d),
  bold: chars(0x250f, 0x2501, 0x2513, 0x2503, 0x2517, 0x251b),
}

// A Box's own edges around its lines; an edge turned off with borderTop and the like is left out.
function bordered(lines: Block, width: number, props: Record<string, any>): Block {
  const [tl, flat, tr, side, bl, br] = BORDERS[String(props.borderStyle)] ?? BORDERS.single!
  const color = props.borderColor as string | undefined
  const mark = (text: string): Cell[] => (text ? [{ text, color }] : [])
  const hasLeft = props.borderLeft !== false
  const hasRight = props.borderRight !== false
  const out = lines.map(line => [...mark(hasLeft ? side! : ''), ...padTo(line, width), ...mark(hasRight ? side! : '')])
  if (props.borderTop !== false) out.unshift(mark(`${hasLeft ? tl : ''}${flat!.repeat(width)}${hasRight ? tr : ''}`))
  if (props.borderBottom !== false) out.push(mark(`${hasLeft ? bl : ''}${flat!.repeat(width)}${hasRight ? br : ''}`))
  return out
}

// A cell that asks for a share of its row, or holds only one that does.
function asksShare(node: Node): boolean {
  if (!isPlain(node)) return false
  if (typeof node.props?.width === 'string') return true
  const inside = kids(node).filter(child => child !== null && child !== undefined && child !== false)
  return node.type === 'Box' && inside.length === 1 && asksShare(inside[0])
}

const sides = (props: Record<string, any>, name: string) => ({
  left: number(props[`${name}Left`] ?? props[`${name}X`] ?? props[name]),
  right: number(props[`${name}Right`] ?? props[`${name}X`] ?? props[name]),
  top: number(props[`${name}Top`] ?? props[`${name}Y`] ?? props[name]),
  bottom: number(props[`${name}Bottom`] ?? props[`${name}Y`] ?? props[name]),
})

async function boxBlock(node: Plain, context: Context): Promise<Block> {
  const props = node.props ?? {}
  if (props.display === 'none') return []
  const bg: string | undefined = props.backgroundColor ?? undefined
  const painted = bg ?? context.bg
  const pad = sides(props, 'padding')
  const margin = sides(props, 'margin')
  const hasBorder = Boolean(props.borderStyle)
  const edge = { left: hasBorder && props.borderLeft !== false ? 1 : 0, right: hasBorder && props.borderRight !== false ? 1 : 0, top: hasBorder && props.borderTop !== false ? 1 : 0, bottom: hasBorder && props.borderBottom !== false ? 1 : 0 }
  const own = percent(props.width, context.width) ?? (context.width === undefined ? undefined : context.width - margin.left - margin.right)
  const inner = own === undefined ? undefined : Math.max(1, own - pad.left - pad.right - edge.left - edge.right)
  const inside: Context = { ...context, width: inner, height: undefined, bg: painted }
  const isColumn = String(props.flexDirection ?? 'row').startsWith('column')
  const gap = number(props.columnGap ?? props.gap)
  const rowGap = number(props.rowGap ?? props.gap)
  const items = kids(node).filter(child => child !== null && child !== undefined && child !== false)
  const placed = items.filter(child => propsOf(child).position === 'absolute')
  const flow = items.filter(child => propsOf(child).position !== 'absolute')
  const fixedHeight = typeof props.height === 'number' ? props.height : undefined
  const stretch = fixedHeight ?? context.height
  const innerHeight = stretch === undefined ? undefined : Math.max(0, stretch - pad.top - pad.bottom - edge.top - edge.bottom - (fixedHeight === undefined ? margin.top + margin.bottom : 0))
  let rows: Block = []

  if (isColumn) {
    const blocks = await Promise.all(flow.map(child => block(child, inside)))
    blocks.forEach((each, at) => {
      if (at > 0) rows.push(...Array.from({ length: rowGap }, () => []))
      rows.push(...each)
    })
  } else {
    // A cell that asks for a share of the row is measured against the row; the rest take their own width.
    const across = (child: Node) => (asksShare(child) ? inner : undefined)
    const blocks = await Promise.all(flow.map(child => block(child, { ...inside, width: across(child) })))
    const grows = flow.map(child => number(propsOf(child).flexGrow) > 0)
    // A Box that names its width keeps it though it holds nothing in flow, as a rail drawn by an absolute overlay.
    const widths = blocks.map((each, at) => Math.max(widthOf(each), number(isPlain(flow[at]) && propsOf(flow[at]).display !== 'none' ? propsOf(flow[at]).width : 0)))
    const total = () => widths.reduce((sum, each) => sum + each, 0) + gap * Math.max(0, blocks.length - 1)
    if (inner !== undefined && total() > inner) {
      const at = widths.indexOf(Math.max(...widths))
      const room = widths[at]! - (total() - inner)
      if (room > 0 && propsOf(flow[at]).flexShrink !== 0) {
        blocks[at] = await block(flow[at]!, { ...inside, width: room })
        widths[at] = widthOf(blocks[at]!)
      }
    }
    if (inner !== undefined && total() < inner) {
      const free = inner - total()
      const growing = grows.filter(Boolean).length
      for (let at = 0; at < blocks.length && growing > 0; at++) {
        if (!grows[at]) continue
        widths[at] = widths[at]! + Math.floor(free / growing) + (at === grows.lastIndexOf(true) ? free % growing : 0)
        blocks[at] = await block(flow[at]!, { ...inside, width: widths[at] })
      }
    }
    // A cell in a row stretches to the row's height, so an edge that draws down its sibling's rows learns how many.
    const height = Math.max(innerHeight ?? 0, ...blocks.map(each => each.length))
    for (let at = 0; at < blocks.length; at++) {
      const child = flow[at]
      if (isPlain(child) && (child.type === 'Box' || child.type === 'Client') && (blocks[at]!.length < height || child.type === 'Client')) {
        blocks[at] = await block(child, { ...inside, width: across(child) ?? widths[at], height })
        widths[at] = Math.max(widths[at]!, widthOf(blocks[at]!))
      }
    }
    let lead = 0
    let between = gap
    const spare = inner === undefined ? 0 : inner - total()
    if (spare > 0 && !grows.some(Boolean)) {
      if (props.justifyContent === 'space-between' && blocks.length > 1) between = gap + Math.floor(spare / (blocks.length - 1))
      else if (props.justifyContent === 'flex-end') lead = spare
      else if (props.justifyContent === 'center') lead = Math.floor(spare / 2)
    }
    for (let y = 0; y < height; y++) {
      const line: Cell[] = blank(lead, painted)
      blocks.forEach((each, at) => {
        if (at > 0) line.push(...blank(between, painted))
        const childBg = propsOf(flow[at]).backgroundColor as string | undefined
        line.push(...padTo(each[y] ?? [], widths[at]!, childBg))
      })
      rows.push(line)
    }
  }

  if (innerHeight !== undefined && rows.length < innerHeight) rows.push(...Array.from({ length: innerHeight - rows.length }, () => [] as Cell[]))
  if (fixedHeight !== undefined) rows = rows.slice(0, innerHeight)
  const fillTo = inner ?? widthOf(rows)
  rows = rows.map(line => (painted ? padTo(line, fillTo, painted) : line))
  rows = [...Array.from({ length: pad.top }, () => [] as Cell[]), ...rows, ...Array.from({ length: pad.bottom }, () => [] as Cell[])]
  rows = rows.map(line => [...blank(pad.left, painted), ...(painted ? padTo(line, fillTo, painted) : line), ...blank(pad.right, painted)])
  if (hasBorder) rows = bordered(rows, fillTo + pad.left + pad.right, props)
  const frame = typeof props.width === 'number' ? props.width : own !== undefined && hasBorder ? own : undefined
  if (frame !== undefined) rows = rows.map(line => padTo(line, frame, painted))

  // A positioned Box lies over this one's cells and takes no room of its own.
  const width = widthOf(rows)
  for (const child of placed) {
    const at = propsOf(child)
    const across = percent(at.width, width)
    const down = percent(at.height, rows.length)
    const drawn = await block(child, { ...inside, width: across, height: down })
    const column = at.left !== undefined ? number(at.left) : at.right !== undefined ? width - number(at.right) - widthOf(drawn) : 0
    const row = at.top !== undefined ? number(at.top) : at.bottom !== undefined ? rows.length - number(at.bottom) - drawn.length : 0
    drawn.forEach((line, y) => {
      if (rows[row + y]) rows[row + y] = place(rows[row + y]!, column, line)
    })
  }

  const lifted = margin.top < 0 ? rows.slice(0, -margin.top).every(line => size(line) === 0 || line.every(cell => !cell.text.trim())) : false
  const top = margin.top < 0 ? (lifted ? rows.slice(-margin.top) : rows) : [...Array.from({ length: margin.top }, () => [] as Cell[]), ...rows]
  const lines = [...top, ...Array.from({ length: Math.max(0, margin.bottom) }, () => [] as Cell[])]
  return lines.map(line => [...blank(margin.left), ...line])
}

async function block(node: Node, context: Context): Promise<Block> {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (!isPlain(node)) return textBlock({ type: 'Text', children: [node] }, context)
  if (node.type === 'Text') return textBlock(node, context)
  if (node.type === 'Box') return boxBlock(node, context)
  if (node.type === 'Client') {
    const columns = percent(node.props?.width, context.width)
    const rows = percent(node.props?.height, context.height ?? 1)
    const sized = columns !== undefined || rows !== undefined ? { columns: columns ?? context.width ?? 0, rows: rows ?? 1 } : undefined
    return block(await context.expand(String(node.props?.key), sized), { ...context, height: undefined })
  }
  if (node.type === 'Button') return textBlock({ type: 'Text', props: { color: node.props?.color }, children: [String(node.props?.label ?? '')] }, context)
  return boxBlock({ ...node, type: 'Box', props: { flexDirection: 'column' } }, context)
}

const names = new Map(Object.entries(THEME).map(([name, hex]) => [String(hex).toLowerCase(), name] as const).reverse())
// A theme color by name, so a retuned theme redraws the example without a rewrite; a mixed color stays its hex.
const named = (color: string | undefined) => (color ? (names.get(color.toLowerCase()) ?? color) : undefined)

function merged(line: Cell[]): Span[] {
  const out: Span[] = []
  for (const cell of line) {
    if (!cell.text) continue
    const span: Span = { text: cell.text }
    const color = named(cell.color)
    const bg = named(cell.bg)
    if (color) span.color = color
    if (bg) span.bg = bg
    if (cell.bold) span.bold = true
    const last = out[out.length - 1]
    if (last && last.color === span.color && last.bg === span.bg && last.bold === span.bold) last.text += span.text
    else out.push(span)
  }
  // A line's trailing spaces with no fill draw nothing.
  const end = out[out.length - 1]
  if (end && !end.bg) end.text = end.text.trimEnd()
  return out.filter(span => span.text)
}

// The border and fill become the frame; padding and a left strip are drawn into the lines; `expand` draws a Client by key (`ui.drawn({ in: key })`).
// Narrow enough for a settings card in a pane whose example frame holds 59 columns, since a wider line wraps there and breaks the example.
export const EXAMPLE_COLUMNS = 56

export async function capture(root: Node, expand: Expand, width = EXAMPLE_COLUMNS): Promise<Captured> {
  if (!isPlain(root)) throw new Error('nothing drawn to capture')
  const props = root.props ?? {}
  const frame = props.borderStyle ? { border: named(props.borderColor) ?? '', bg: named(props.backgroundColor) ?? '' } : undefined
  const pad = number(props.paddingLeft ?? props.paddingX ?? props.padding)
  const strip = kids(root).find(child => propsOf(child).position === 'absolute')
  const mark = isPlain(strip) ? ((await inline(strip, { expand }))[0] ?? undefined) : undefined
  const plain = { ...root, children: kids(root).filter(child => propsOf(child).position !== 'absolute'), props: { flexDirection: props.flexDirection, justifyContent: props.justifyContent, columnGap: props.columnGap, rowGap: props.rowGap, gap: props.gap, ...(props.borderStyle ? {} : { backgroundColor: props.backgroundColor }) } }
  const inner = width - pad - number(props.paddingRight ?? props.paddingX ?? props.padding) - (props.borderStyle ? 2 : 0)
  const body = await block(plain, { expand, width: inner })
  const lead = mark && pad > 0 ? [{ ...mark, text: Array.from(mark.text)[0]! }, ...blank(pad - 1)] : blank(pad)
  const lines = body.map(line => ({ spans: merged([...lead, ...line]) }))
  while (lines.length && lines[lines.length - 1]!.spans.length === 0) lines.pop()
  return { ...(frame ? { frame } : {}), lines }
}

// Rows that stack as one example, each its own mounted drawing.
export const stacked = (...parts: Captured[]): Captured => ({ ...(parts.find(part => part.frame)?.frame ? { frame: parts.find(part => part.frame)!.frame } : {}), lines: parts.flatMap(part => part.lines) })

// A line written from a mod's own strings, for an example the host draws (a dialog) and the mod only words.
// A one-span line wider than the example wraps here, as the terminal would wrap it.
export const written = (...lines: Span[][]): Captured => ({
  lines: lines.flatMap(spans => (spans.length === 1 ? wrap(spans[0]!.text, EXAMPLE_COLUMNS - 1).map(text => [{ ...spans[0]!, text }]) : [spans])).map(spans => ({ spans: [{ text: ' ' }, ...spans] })),
})

// Passes when the drawing equals the committed example; else fails with the new example as a @@PREVIEW line.
export function expectPreview(snapshot: Snapshot, field: string, value: string, mode: Mode, got: Captured) {
  const widest = Math.max(0, ...got.lines.map(line => line.spans.reduce((sum, span) => sum + Array.from(span.text).length, 0)))
  if (widest > EXAMPLE_COLUMNS) throw new Error(`the ${mode} example of ${field}=${value} is ${widest} cells wide, over the ${EXAMPLE_COLUMNS} a settings card holds; draw it narrower`)
  const want = snapshot[field]?.[value]
  const same = want && JSON.stringify(want[mode]) === JSON.stringify(got.lines) && JSON.stringify(want.frame ?? null) === JSON.stringify(got.frame ?? null)
  if (same) return
  throw new Error(`the ${mode} example of ${field}=${value} differs from showcase.json; copy the @@PREVIEW line below into its previews and tests/previews.snapshot.ts\n@@PREVIEW ${JSON.stringify({ field, value, mode, frame: got.frame, lines: got.lines })}`)
}
