// mod-manager / hooks/spend.ts, by v-amorim
// Reads a mod's spend.json, prices it and words it for the list tip and the page card.
import { fill, MARK } from './theme'
import text from './text'

export type Counts = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }
export type Spend = { calls: number; tokensIn: number; tokensOut: number; dollars: number | null; isPartial: boolean }

export const WINDOW_DAYS = 7
const DAY_MS = 86_400_000

// USD per million tokens, read 2026-10-17 from https://platform.claude.com/docs/en/about-claude/pricing (the claude-api skill is not installed here, so the pricing page is the source).
// cacheWrite is the 5 minute rate. Haiku 5.5 is its small-prompt tier, so a very large prompt costs more than the line says.
// An alias (haiku, sonnet, opus) is priced as the newest model of its family on that page, which is an assumption.
type Price = { model: string; input: number; cacheWrite: number; cacheRead: number; output: number }
export const PRICES: Record<string, Price> = {
  'haiku 5.5': { model: 'Claude Haiku 5.5', input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  'haiku 4.5': { model: 'Claude Haiku 4.5', input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
  'sonnet 5.5': { model: 'Claude Sonnet 5.5', input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  'sonnet 5.0': { model: 'Claude Sonnet 5', input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'sonnet 4.6': { model: 'Claude Sonnet 4.6', input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'sonnet 4.5': { model: 'Claude Sonnet 4.5', input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'sonnet 4.0': { model: 'Claude Sonnet 4', input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'opus 5.5': { model: 'Claude Opus 5.5', input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'opus 5.0': { model: 'Claude Opus 5', input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'opus 4.8': { model: 'Claude Opus 4.8', input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'opus 4.7': { model: 'Claude Opus 4.7', input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'opus 4.6': { model: 'Claude Opus 4.6', input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'opus 4.5': { model: 'Claude Opus 4.5', input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
}
const NEWEST: Record<string, string> = { haiku: 'haiku 5.5', sonnet: 'sonnet 5.5', opus: 'opus 5.5' }

// A model as the mod asked for it (an alias or an id such as claude-sonnet-5-5[1m]); undefined when the table does not know it.
export function priceOf(model: string): Price | undefined {
  const name = model.toLowerCase()
  const found = /(haiku|sonnet|opus)(?:[-. ](\d+)(?:[-. ](\d{1,2})(?!\d))?)?/.exec(name)
  if (!found) return undefined
  const [, family, major, minor] = found
  if (major === undefined) return /^(haiku|sonnet|opus)$/.test(name.trim()) ? PRICES[NEWEST[family!]!] : undefined
  return PRICES[`${family} ${major}.${minor ?? '0'}`]
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const whole = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

// The last WINDOW_DAYS days of a parsed spend.json; null when it holds no call or is not the file's shape.
export function summarize(raw: unknown, now: number): Spend | null {
  const days = raw && typeof raw === 'object' ? (raw as { days?: unknown }).days : null
  if (!days || typeof days !== 'object') return null
  const oldest = dayKey(now - (WINDOW_DAYS - 1) * DAY_MS)
  let calls = 0
  let tokensIn = 0
  let tokensOut = 0
  let dollars = 0
  let isPriced = false
  let isPartial = false
  for (const [day, models] of Object.entries(days as Record<string, unknown>)) {
    if (day < oldest || !models || typeof models !== 'object') continue
    for (const [model, c] of Object.entries(models as Record<string, Record<string, unknown>>)) {
      if (!c || typeof c !== 'object') continue
      const n = whole(c.calls)
      if (n === 0) continue
      const [input, output, cacheRead, cacheWrite] = [whole(c.input), whole(c.output), whole(c.cacheRead), whole(c.cacheWrite)]
      calls += n
      tokensIn += input + cacheRead + cacheWrite
      tokensOut += output
      const price = priceOf(model)
      if (!price) {
        isPartial = true
        continue
      }
      isPriced = true
      dollars += (input * price.input + cacheWrite * price.cacheWrite + cacheRead * price.cacheRead + output * price.output) / 1_000_000
    }
  }
  if (calls === 0) return null
  return { calls, tokensIn, tokensOut, dollars: isPriced ? dollars : null, isPartial }
}

const tokens = (n: number) => {
  if (n < 1000) return String(n)
  const [value, unit] = n >= 1_000_000 ? [n / 1_000_000, 'M'] : [n / 1000, 'K']
  return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}${unit}`
}

const money = (dollars: number) => (dollars < 0.01 ? '<$0.01' : `$${dollars.toFixed(2)}`)

// Dollars first, then tokens, calls and the window; a plus after the dollars when a model has no price, no dollars when none has.
export function spendLine(spend: Spend) {
  const sep = ` ${MARK.sep} `
  const amount = spend.dollars === null ? '' : `${fill(text.spendAbout, { amount: money(spend.dollars) })}${spend.isPartial ? '+' : ''} `
  const counts = fill(text.spendTokens, { in: tokens(spend.tokensIn), out: tokens(spend.tokensOut), sep: MARK.sep })
  return [`${amount}${counts}`, fill(spend.calls === 1 ? text.spendCall : text.spendCalls, { n: spend.calls }), fill(text.spendWindow, { n: WINDOW_DAYS })].join(sep)
}

export const spendPath = (config: string, mod: string) => `${config.replace(/\\/g, '/').replace(/\/+$/, '')}/mods-data/${mod}/spend.json`

// The summary of one mod's file; a missing or corrupt file is no spend.
export async function readSpend(read: (path: string) => Promise<unknown>, config: string, mod: string, now: number): Promise<Spend | null> {
  try {
    return summarize(JSON.parse(String(await read(spendPath(config, mod)))), now)
  } catch {
    return null
  }
}

// Empties the file; $.fs has no delete, and an empty one reads as no calls.
export const resetSpend = (write: (path: string, text: string) => Promise<void>, config: string, mod: string) => write(spendPath(config, mod), '{"days":{}}')
