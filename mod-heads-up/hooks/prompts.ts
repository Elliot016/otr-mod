// The session's prompts, numbered as mod-transcript and mod-prompts number them: the place among the prompts on the live branch, oldest first. Pure: no engine calls.

// Claude Code draws a prompt once under this id as it is sent, then again under its own uuid; only the uuid draw is the prompt's row.
export const PLACEHOLDER = 'placeholder'

const WRAPPER = /^<(command-|local-command-|bash-|system-reminder|task-notification|user-prompt-submit-hook)/
const INTERRUPTED = /^\[Request interrupted by user/

export const isPrompt = (text: string) => {
  const trimmed = text.trim()
  return Boolean(trimmed) && !WRAPPER.test(trimmed) && !INTERRUPTED.test(trimmed) && !trimmed.startsWith('/')
}

const userText = (content: unknown) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('\n')
      : ''

export type NumberedPrompt = { id: string; text: string; number: number }
export type DrawnPrompt = { id: string; text: string }

export class PromptNumbers {
  private parents = new Map<string, string | undefined>()
  private prompts: DrawnPrompt[] = []
  private last: string | undefined
  private drawnPrompts: DrawnPrompt[] = []

  // Reads the transcript a line at a time, in file order.
  feed(line: string) {
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      return
    }
    if (typeof row?.uuid !== 'string' || row.isSidechain === true) return
    this.parents.set(row.uuid, row.parentUuid ?? row.logicalParentUuid ?? undefined)
    this.last = row.uuid
    const content = row.message?.content
    // A subagent's report is a meta row, which is not a prompt the person sent, so it takes no number.
    if (row.type === 'user' && !row.isMeta && !row.isCompactSummary && !(Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result'))) {
      this.add(row.uuid, userText(content))
    } else if (row.type === 'attachment' && row.attachment?.type === 'queued_command' && !row.attachment.isMeta && typeof row.attachment.prompt === 'string') {
      this.add(row.uuid, row.attachment.prompt)
    }
  }

  // The prompts drawn in the composer, oldest first. Set at each read, since the drawn list changes while the file grows.
  drawn(prompts: DrawnPrompt[]) {
    this.drawnPrompts = prompts.filter(prompt => prompt.id !== PLACEHOLDER && isPrompt(prompt.text)).map(prompt => ({ id: prompt.id, text: prompt.text.trim() }))
  }

  // The prompts on the live branch, then the drawn prompts the file does not hold yet. The parent chain from the last row drops a /rewind's abandoned prompts. A drawn prompt with a later drawn prompt already in the file was cancelled, so it takes no number.
  numbered(): NumberedPrompt[] {
    const live = new Set<string>()
    for (let id = this.last; id !== undefined && !live.has(id); id = this.parents.get(id)) live.add(id)
    const lastWritten = this.drawnPrompts.map(prompt => this.parents.has(prompt.id)).lastIndexOf(true)
    const inFlight = this.drawnPrompts.filter((prompt, index) => !this.parents.has(prompt.id) && index > lastWritten)
    return [...this.prompts.filter(prompt => live.has(prompt.id)), ...inFlight].map((prompt, index) => ({ ...prompt, number: index + 1 }))
  }

  latest(): NumberedPrompt | undefined {
    const numbered = this.numbered()
    return numbered[numbered.length - 1]
  }

  private add(id: string, text: string) {
    if (isPrompt(text)) this.prompts.push({ id, text: text.trim() })
  }
}
