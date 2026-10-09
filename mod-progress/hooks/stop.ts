// mod-progress / hooks/stop.ts, by v-amorim
// Why the main turn stopped: StopFailure's error kind in words, its tone, and when a full usage window resets. No `$` in here, so tests call it directly.
import { formatElapsed, type Stop } from './progress'
import text from './text'
import { fill } from './theme'

export type StopKind = keyof typeof text.stopKind
export type StopTone = 'warn' | 'alert'
export type LimitWindow = { percentUsed: number; resetsAt?: string }
export type StopView = { line: string; tone: StopTone }

// Each error kind of StopFailure (SDKAssistantMessageError), grouped by what the person does about it.
const KIND: Record<string, StopKind> = {
  authentication_failed: 'signIn',
  oauth_org_not_allowed: 'signIn',
  cloud_credential_error: 'signIn',
  account_on_hold: 'account',
  verification_required: 'account',
  billing_error: 'billing',
  invalid_request: 'invalid',
  model_not_found: 'invalid',
  rate_limit: 'usageLimit',
  overloaded: 'overloaded',
}

// Alert: the failure will not clear on its own, so the person must act. Warn: it may clear by itself, so waiting helps.
const TONE: Record<StopKind, StopTone> = {
  signIn: 'alert',
  account: 'alert',
  billing: 'alert',
  invalid: 'alert',
  usageLimit: 'warn',
  overloaded: 'warn',
  other: 'warn',
}

export const kindOf = (error: string): StopKind => KIND[error] ?? 'other'

// The latest reset among the windows that are full.
export function fullUntil(windows: LimitWindow[]) {
  let until: string | undefined
  for (const window of windows) {
    const at = Date.parse(window.resetsAt ?? '')
    if (window.percentUsed < 100 || Number.isNaN(at)) continue
    if (until === undefined || at > Date.parse(until)) until = window.resetsAt
  }
  return until
}

// A reset time is kept only for a usage limit, the one kind a window explains.
export function stopOf(error: string, at: number, windows: LimitWindow[]): Stop {
  const resetsAt = kindOf(error) === 'usageLimit' ? fullUntil(windows) : undefined
  return resetsAt === undefined ? { error, at } : { error, at, resetsAt }
}

// Local clock time such as 7:33pm; a reset on another day gets its date in front.
export function resumeAt(resetsAt: string, now: number) {
  const reset = new Date(resetsAt)
  const hours = reset.getHours()
  const time = `${hours % 12 || 12}:${String(reset.getMinutes()).padStart(2, '0')}${hours < 12 ? text.am : text.pm}`
  if (reset.toDateString() === new Date(now).toDateString()) return time
  return `${reset.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
}

// The line under the pane's hint and in the pill's tip, or null when the turn did not stop.
export function stopLine(stop: Stop | undefined, now: number): StopView | null {
  if (!stop) return null
  const kind = kindOf(stop.error)
  const resume = stop.resetsAt === undefined ? '' : ` ${fill(text.resumeAfter, { time: resumeAt(stop.resetsAt, now) })}`
  return { line: fill(text.stopped, { ago: formatElapsed(now - stop.at), reason: text.stopKind[kind] }) + resume, tone: TONE[kind] }
}
