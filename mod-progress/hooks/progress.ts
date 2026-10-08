// The data side of the mod: gates files, loop figures, rows. No `$` in here, so tests call it directly.
import marks from './marks'
import style from './style'
import text from './text'
import { fill } from './theme'

export type GateState = 'met' | 'open' | 'abandoned'
export type Gate = { id: string; text: string; state: GateState }
export type Task = { id: string; subject: string; status: string }
export type Loop = { model?: string; effort?: string; tokens: number; context: number; spawnedAt?: number; endedAt?: number; gatesStem?: string; tasks?: Task[]; step?: string }
export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// The main turn's last stop on an API error (StopFailure): its error kind, when it happened, and the reset of a full usage window.
export type Stop = { error: string; at: number; resetsAt?: string }

// Kept in $.store under the session id, so a reload keeps it and another session starts clean.
export type Snap = {
  sid: string
  busy: boolean
  startedAt?: number
  main: Loop
  agents: Record<string, Loop>
  tasks: Task[]
  gates: Record<string, Gate[]>
  expanded: string
  stop?: Stop
}

export const MAIN_GATES = 'GATES'

export const emptySnap = (sid: string): Snap => ({ sid, busy: false, main: { tokens: 0, context: 0 }, agents: {}, tasks: [], gates: {}, expanded: '' })

const GATE_RE = /^- \[( |x|X)\] (.*)$/
const ATTR_RE = /^\s+(CHECK|EXPECT|EVIDENCE):\s?(.*)$/
const ABANDON_RE = /^ABANDON:\s*(\S+)\s*(.*)$/

// The execute skill's gate format: a box is met only when checked and its EVIDENCE is no longer pending; ABANDON lines give a gate up.
export function parseGates(source: string): Gate[] {
  const found: { id: string; text: string; checked: boolean; evidence: string | null }[] = []
  const abandoned = new Set<string>()
  let current: (typeof found)[number] | null = null
  source.split(/\r?\n/).forEach((line, at) => {
    const gate = GATE_RE.exec(line)
    if (gate) {
      const body = gate[2]!.trim()
      const id = /^(\S+?):/.exec(body)?.[1] ?? `line${at + 1}`
      current = { id, text: body.replace(/^\S+?:\s*/, ''), checked: gate[1]!.toLowerCase() === 'x', evidence: null }
      found.push(current)
      return
    }
    const attr = current ? ATTR_RE.exec(line) : null
    if (attr) {
      if (attr[1] === 'EVIDENCE') current!.evidence = attr[2]!.trim()
      return
    }
    const gone = ABANDON_RE.exec(line)
    if (gone) abandoned.add(gone[1]!.replace(/:$/, ''))
    if (/^#|^- /.test(line)) current = null
  })
  return found.map(each => ({
    id: each.id,
    text: each.text,
    state: abandoned.has(each.id) ? 'abandoned' : each.checked && each.evidence && !/^pending$/i.test(each.evidence) ? 'met' : 'open',
  }))
}

export const isGatesPath = (path: string) => /(^|\/)(GATES\.md|gates\/[^/]+\.md)$/i.test(path.replace(/\\/g, '/'))

export const stemOf = (file: string) => file.replace(/\.md$/i, '')

// The first gates file a brief names: execute's leaf briefs point at gates/<stem>.md.
export const gatesStemIn = (prompt: string) => prompt.replace(/\\/g, '/').match(/gates\/([^/\s`'")]+)\.md/i)?.[1]

// An agent's gates file: the one its brief names, else gates/<name>.md, else the description's first word ("leaf-1.1.1: ...").
export const gatesOf = (snap: { gates: Record<string, Gate[]> }, info: { name?: string; description: string }, stem?: string) =>
  (stem ? snap.gates[stem] : undefined) ?? (info.name ? snap.gates[info.name] : undefined) ?? snap.gates[info.description.trim().split(/\s+/)[0]?.replace(/:$/, '') ?? '']

export function applyStep(snap: Snap, agentId: string | undefined, model: string, effort: unknown, usage: Usage | null | undefined) {
  const loop = agentId ? (snap.agents[agentId] ??= { tokens: 0, context: 0 }) : snap.main
  loop.model = model
  if (typeof effort === 'string') loop.effort = effort
  else delete loop.effort
  if (usage) {
    loop.tokens += usage.output_tokens
    loop.context = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  }
}

// The main session's tasks sit on the snap, an agent's on its loop; one function serves both.
export function applyTask(owner: { tasks?: Task[] }, tool: string, input: Record<string, unknown>, createdId?: string) {
  const tasks = (owner.tasks ??= [])
  if (tool === 'TaskCreate' && createdId) tasks.push({ id: createdId, subject: String(input.subject ?? ''), status: 'pending' })
  if (tool !== 'TaskUpdate') return
  const task = tasks.find(each => each.id === String(input.taskId))
  if (!task) return
  if (input.status === 'deleted') owner.tasks = tasks.filter(each => each !== task)
  else {
    if (typeof input.status === 'string') task.status = input.status
    if (typeof input.subject === 'string') task.subject = input.subject
  }
}

const baseName = (path: string) => path.replace(/\\/g, '/').split('/').pop() ?? ''
const hostOf = (url: string) => /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url

// A call with no file, pattern or command to name shows the tool's own name.
export function stepOf(tool: string, input: Record<string, unknown>) {
  const slot = (key: string) => (typeof input[key] === 'string' ? (input[key] as string).replace(/\s+/g, ' ').trim() : '')
  const named = (template: string, value: string) => (value ? fill(template, { what: value }) : tool)
  switch (tool) {
    case 'Read':
      return named(text.stepRead, baseName(slot('file_path')))
    case 'Edit':
    case 'MultiEdit':
      return named(text.stepEdit, baseName(slot('file_path')))
    case 'Write':
      return named(text.stepWrite, baseName(slot('file_path')))
    case 'Grep':
    case 'Glob':
      return named(text.stepSearch, slot('pattern'))
    case 'Bash':
      return slot('description') || named(text.stepRun, slot('command').split(' ')[0] ?? '')
    case 'WebFetch':
      return named(text.stepFetch, hostOf(slot('url')))
    case 'Agent':
      return text.stepAgent
    default:
      return tool
  }
}

const BOOKKEEPING = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite'])

export function applyCall(snap: Snap, agentId: string | undefined, tool: string, input: Record<string, unknown>) {
  const loop = agentId ? snap.agents[agentId] : snap.main
  // Task bookkeeping says nothing about the work, so the step before it stays.
  if (loop && !BOOKKEEPING.has(tool)) loop.step = stepOf(tool, input)
}

const FAMILIES = ['opus', 'sonnet', 'haiku']
const HUES = style.colors.models as Record<string, string>

// The family and version read from a model id, the family alone from an alias, the raw id from anything else.
export function modelInfo(model: string | undefined) {
  if (!model) return { name: '', family: 'inherit', hue: HUES.inherit! }
  const family = FAMILIES.find(each => model.toLowerCase().includes(each))
  if (!family) return { name: model.replace(/^claude-/, ''), family: 'inherit', hue: HUES.inherit! }
  const label = family[0]!.toUpperCase() + family.slice(1)
  const version = new RegExp(`${family}-(\\d+)(?:[-.](\\d{1,2}))?(?!\\d)`, 'i').exec(model)
  return { name: version ? `${label} ${version[1]}${version[2] ? `.${version[2]}` : ''}` : label, family, hue: HUES[family]! }
}

// A request never exceeds its window, so context past the default proves the 1M window; a 1M main session gives its agents 1M too.
export function windowFor(model: string | undefined, mainModel: string | undefined, mainWindow: number | undefined, context = 0) {
  if (model?.includes('[1m]') || context > marks.windows.default) return marks.windows.oneMillion
  if (mainWindow && model === mainModel) return mainWindow
  return (mainWindow ?? 0) >= marks.windows.oneMillion ? marks.windows.oneMillion : marks.windows.default
}

export const gaugeColor = (percent: number) => {
  const at = marks.gaugeFrom.reduce((found, from, index) => (percent >= from ? index : found), 0)
  return style.colors.usage[at]!
}

export function formatTokens(count: number) {
  if (count < 1000) return String(count)
  if (count < 100000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  return `${(count / 1000000).toFixed(1)}M`
}

export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

export type AgentLite = { id: string; name?: string; description: string; type: string; status: string }
export type UsageLite = { tokens?: number; window?: number; percent?: number; startedAt?: number }
export type Status = 'running' | 'done' | 'failed'

export type Row = {
  id: string
  isMain: boolean
  name: string
  description: string
  status: Status
  model: string
  hue: string
  effort: string | undefined
  percent: number | undefined
  tokens: number
  elapsed: string
  gates: Gate[]
  hasGates: boolean
}

export const statusOf = (status: string): Status => (status === 'completed' ? 'done' : status === 'failed' || status === 'killed' ? 'failed' : 'running')

// Marks an agent that stopped as ended at the first look that saw it stopped; true when something changed.
export function settle(snap: Snap, list: AgentLite[], now: number) {
  let changed = false
  for (const info of list) {
    const loop = (snap.agents[info.id] ??= { tokens: 0, context: 0 })
    if (statusOf(info.status) !== 'running' && loop.endedAt === undefined) {
      loop.endedAt = now
      delete loop.step
      changed = true
    }
  }
  return changed
}

const taskGate = (task: Task): Gate => ({ id: `#${task.id}`, text: task.subject, state: task.status === 'completed' ? 'met' : 'open' })

// One rule for main and every agent: a gates file with entries wins over the task list.
const gatesFor = (file: Gate[] | undefined, tasks: Task[] = []) => (file && file.length > 0 ? file : tasks.map(taskGate))

// The call's phrase shows only while the loop runs, so a finished card keeps its description.
const shownDescription = (loop: Loop, status: Status, description: string) => (status === 'running' && loop.step ? loop.step : description)

// The main session first, then each agent in spawn order.
export function buildRows(snap: Snap, list: AgentLite[], usage: UsageLite | undefined, now: number, mainName: string, mainTask: string, mainModel: string | undefined): Row[] {
  const main = snap.main
  const model = main.model ?? mainModel
  const mainGates = gatesFor(snap.gates[MAIN_GATES], snap.tasks)
  const window = windowFor(model, model, usage?.window)
  const started = usage?.startedAt ?? snap.startedAt
  const percent = (loop: Loop, size: number) => (loop.context > 0 ? Math.min(100, Math.round((loop.context / size) * 100)) : undefined)
  const doing = snap.tasks.find(task => task.status === 'in_progress') ?? snap.tasks.find(task => task.status !== 'completed')
  const mainStatus: Status = snap.busy ? 'running' : 'done'
  const rows: Row[] = [{
    id: 'main',
    isMain: true,
    name: mainName,
    description: shownDescription(main, mainStatus, doing?.subject ?? mainTask),
    status: mainStatus,
    model: model ?? '',
    hue: modelInfo(model).hue,
    effort: main.effort,
    percent: usage?.percent ?? percent(main, window),
    tokens: main.tokens,
    elapsed: started === undefined ? '' : formatElapsed(now - started),
    gates: mainGates,
    hasGates: mainGates.length > 0,
  }]
  for (const info of list) {
    const loop = snap.agents[info.id] ?? { tokens: 0, context: 0 }
    const status = statusOf(info.status)
    const gates = gatesFor(gatesOf(snap, info, loop.gatesStem), loop.tasks)
    rows.push({
      id: info.id,
      isMain: false,
      name: info.name ?? info.type,
      description: shownDescription(loop, status, info.description),
      status,
      model: loop.model ?? '',
      hue: modelInfo(loop.model).hue,
      effort: loop.effort,
      percent: percent(loop, windowFor(loop.model, model, usage?.window, loop.context)),
      tokens: loop.tokens,
      elapsed: loop.spawnedAt === undefined ? '' : formatElapsed((loop.endedAt ?? now) - loop.spawnedAt),
      gates,
      hasGates: gates.length > 0,
    })
  }
  return rows
}

export const countGates = (gates: Gate[]) => ({ done: gates.filter(gate => gate.state === 'met').length, total: gates.length })

// The band pill's badge: how many agents ran besides the main session.
export function bandSummary(rows: Row[]) {
  const gates = countGates(rows.flatMap(row => row.gates))
  return { count: rows.filter(row => !row.isMain && row.status === 'running').length, ...gates }
}
