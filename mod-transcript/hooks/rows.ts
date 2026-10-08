import type { ModelApiError } from 'claude-code'

// The words a finished call shows after its name; each comes from a typed field, never from the output's text.
export type Status = 'timedOut' | 'interrupted' | 'background' | 'declined'

type Outcome = { timedOutAfterMs?: unknown; interrupted?: unknown; backgroundTaskId?: unknown; backgroundedByUser?: unknown }

export function statusesOf(call: { isInterrupted: boolean; isDeclined: boolean; output: unknown; input?: unknown }): Status[] {
  const output = (call.output ?? {}) as Outcome
  // The row's output may not carry the task id, so the call's own run_in_background counts too.
  const asked = (call.input as { run_in_background?: unknown } | undefined)?.run_in_background === true
  return [
    ...(typeof output.timedOutAfterMs === 'number' ? ['timedOut' as const] : []),
    ...(call.isInterrupted || output.interrupted === true ? ['interrupted' as const] : []),
    ...(asked || typeof output.backgroundTaskId === 'string' || output.backgroundedByUser === true ? ['background' as const] : []),
    ...(call.isDeclined ? ['declined' as const] : []),
  ]
}

export type Question = { question: string; answer: string | undefined }

// Each question of an AskUserQuestion call, with the answer its result gives it, if any.
export function questionsOf(input: unknown, output: unknown): Question[] {
  const questions = (input as { questions?: unknown } | undefined)?.questions
  const answers = ((output as { answers?: Record<string, unknown> } | undefined)?.answers ?? {}) as Record<string, unknown>
  if (!Array.isArray(questions)) return []
  return questions.map((each: { question?: unknown }) => {
    const question = typeof each?.question === 'string' ? each.question : ''
    const answer = answers[question]
    return { question, answer: typeof answer === 'string' && answer.trim() ? answer : undefined }
  })
}

// Errors Claude Code retries on its own; every other kind waits for the person.
const RETRIED: ModelApiError[] = ['rate_limit', 'overloaded', 'server_error']

export const apiErrorAction = (error: ModelApiError) => (RETRIED.includes(error) ? 'retry' : 'act')

export type Report = { name?: string; status?: string; durationMs?: number; id?: string; type?: string }

// A subagent's or teammate's report: its sender's name, else its task's type, and the task's own fields.
export function reportOf(from: { name: string } | undefined, task: { id?: string; status?: string; type?: string; durationMs?: number } | undefined): Report {
  return { name: from?.name ?? task?.type ?? task?.id, status: task?.status, durationMs: task?.durationMs, id: task?.id, type: task?.type }
}

export type HexColor = { code: string; rgb: string }

// Each distinct hex color a text names, in order of first use. A short code needs a letter, so a prompt number stays text.
export function hexColors(text: string): HexColor[] {
  const found = new Map<string, HexColor>()
  for (const [code, digits] of text.matchAll(/(?<![\w#&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g)) {
    if (digits!.length <= 4 && !/[a-f]/i.test(digits!)) continue
    const six = digits!.length <= 4 ? [...digits!.slice(0, 3)].map(digit => digit + digit).join('') : digits!.slice(0, 6)
    const key = code.toUpperCase()
    if (!found.has(key)) found.set(key, { code, rgb: `#${six.toUpperCase()}` })
  }
  return [...found.values()]
}

// How a background task ended and how long it ran, from its notice.
export type Notice = { status?: string; durationMs?: number }

// The task a peer report came from. The declared origin names no task, but the stored one carries it as senderTaskId.
export function senderTaskOf(origin: unknown): string | undefined {
  const id = (origin as { senderTaskId?: unknown } | undefined)?.senderTaskId
  return typeof id === 'string' && id ? id : undefined
}

// A report with its task's notice: the notice's status and time, since the report row carries neither.
export function withNotice(report: Report, notice: Notice | undefined): Report {
  return { ...report, status: notice?.status ?? report.status, durationMs: notice?.durationMs ?? report.durationMs }
}

// Whole lines of a read and the unfinished last line, which the next read completes.
export function completeLines(read: string) {
  const end = read.lastIndexOf('\n') + 1
  return { lines: read.slice(0, end).split('\n').filter(line => line.trim()), rest: read.slice(end) }
}
