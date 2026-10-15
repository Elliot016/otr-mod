// mod-progress / hooks/loops.tsx, by v-amorim
// The pane's list: a card per loop, two rows each, its gates under it when clicked.
import type { ClientModule, RenderChildren } from 'claude-code'

import { postTip } from './entry'
import { lookFor } from './look'
import marks from './marks'
import { countGates, gaugeColor, formatTokens, modelInfo, type Row } from './progress'
import style from './style'
import text from './text'
import { CAPS, decodeAll, fill, MARK, THEME } from './theme'

export type LoopsProps = { rows: Row[]; width: number; expanded: string; nerd: boolean; viewing: string }
export type LoopsMessage = { type: 'toggle'; id: string } | { type: 'task'; id: string }

type Line = { kind: 'head' | 'pills' | 'task' | 'gate' | 'empty' | 'gap' | 'run'; loop: number; gate?: number; task?: number; run?: string }

// The rows top to bottom: a line naming the workflow run where its agents start, then head, pills, a line per background task, the gates of the open loop, and a gap before the next card.
export function layoutLoops(rows: Row[], expanded: string) {
  const lines: Line[] = []
  rows.forEach((row, loop) => {
    if (row.run && row.run !== rows[loop - 1]?.run) lines.push({ kind: 'run', loop: -1, run: row.run })
    lines.push({ kind: 'head', loop }, { kind: 'pills', loop })
    row.tasks.forEach((_, task) => lines.push({ kind: 'task', loop, task }))
    if (row.id === expanded) {
      if (row.gates.length === 0) lines.push({ kind: 'empty', loop })
      row.gates.forEach((_, gate) => lines.push({ kind: 'gate', loop, gate }))
    }
    if (loop < rows.length - 1) lines.push({ kind: 'gap', loop: -1 })
  })
  return lines
}

const LEVELS = style.levels as Record<string, { glyph: string; color: string }>

// @ts-expect-error Row holds undefined fields, which the host's JsonValue props type refuses.
const Loops: ClientModule<LoopsProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, width, expanded, nerd, viewing } = props
  const look = lookFor(nerd)
  const own = decodeAll(marks.glyphs)[nerd ? 'nerd' : 'safe']
  const lines = layoutLoops(rows, expanded)
  // The state is the line under the pointer: a task line is its own target, any other line stands for its card.
  const hoveredAt = surface.state ?? -1
  const taskOf = (at: number) => {
    const line = lines[at]
    return line?.kind === 'task' ? rows[line.loop]?.tasks[line.task!] : undefined
  }
  const targetOf = (at: number) => (taskOf(at) ? `task:${taskOf(at)!.id}` : `loop:${lines[at]?.loop ?? -1}`)

  surface.onPointer(event => {
    const at = event.type === 'leave' || (lines[event.y]?.loop ?? -1) < 0 ? -1 : event.y
    if (at !== hoveredAt) {
      surface.setState(at)
      if (targetOf(at) !== targetOf(hoveredAt)) {
        const task = taskOf(at)
        const row = rows[lines[at]?.loop ?? -1]
        postTip(surface, 'loops', task ? { glyph: task.kind === 'shell' ? look.glyph.icon.Bash ?? look.glyph.expanded : look.glyph.expanded, label: task.kind === 'shell' ? text.taskShell : text.taskMonitor, text: text.tipTask } : row ? { glyph: row.id === expanded ? look.glyph.expanded : look.glyph.collapsed, label: row.name, text: text.tipLoop } : null)
      }
    }
    if (event.type !== 'down' || event.button !== 'left' || at < 0) return
    const task = taskOf(at)
    if (task) surface.post({ type: 'task', id: task.id } satisfies LoopsMessage)
    else surface.post({ type: 'toggle', id: rows[lines[at]!.loop]!.id } satisfies LoopsMessage)
  })

  // A pill on the card: rounded caps on Nerd, a space each side on safe.
  const pill = (key: string, on: string, body: RenderChildren) => (
    <Box key={key} flexDirection="row" flexShrink={0}>
      <Text key={`${key}-left`} color={THEME.surface3} backgroundColor={on}>{nerd ? CAPS.left : ' '}</Text>
      <Box key={`${key}-body`} flexDirection="row" backgroundColor={THEME.surface3}>{body}</Box>
      <Text key={`${key}-right`} color={THEME.surface3} backgroundColor={on}>{nerd ? CAPS.right : ' '}</Text>
    </Box>
  )

  const drawLine = (line: Line, at: number) => {
    const key = `line-${at}`
    if (line.kind === 'gap') return <Box key={key} height={1} />
    if (line.kind === 'run') {
      const members = rows.filter(each => each.run === line.run)
      const label = fill(text.workflowRun, { id: line.run!.replace(/^wf_/, '').slice(0, 6), sep: MARK.sep, done: members.filter(each => each.status !== 'running').length, total: members.length })
      return <Box key={key} height={1} width={width} paddingLeft={1}><Text wrap="truncate-end" color={THEME.secondary} bold>{label}</Text></Box>
    }
    const row = rows[line.loop]!
    const isHover = line.kind === 'task' ? hoveredAt === at : lines[hoveredAt]?.kind !== 'task' && (lines[hoveredAt]?.loop ?? -1) === line.loop
    const on = isHover ? THEME.lifted : THEME.surface1
    const strip = <Text key={`${key}-strip`} color={row.hue}>{own.strip}</Text>
    const isViewed = line.kind === 'head' && row.id === viewing
    const frame = (inner: RenderChildren) => (
      <Box key={key} height={1} width={width} flexDirection="row" backgroundColor={on}>
        {strip}
        <Text key={`${key}-pad`} color={THEME.accent} bold>{isViewed ? MARK.cursor : ' '}</Text>
        {inner}
      </Box>
    )

    if (line.kind === 'head') {
      const mark = row.status === 'running' ? { glyph: own.running, color: THEME.accent } : row.status === 'done' ? { glyph: look.glyph.ok, color: THEME.good } : { glyph: look.glyph.warn, color: THEME.alert }
      const right = fill(text.tokensTime, { tokens: formatTokens(row.tokens), sep: MARK.sep, time: row.elapsed || '0s' })
      return frame(
        <Box key={`${key}-body`} flexDirection="row" flexGrow={1} columnGap={1}>
          <Text key={`${key}-mark`} color={mark.color}>{mark.glyph}</Text>
          <Box key={`${key}-name`} flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={isHover || isViewed ? THEME.accent : THEME.onSurface} bold>{row.name}</Text>
              <Text color={THEME.muted}>{row.description ? ` ${row.description}` : ''}</Text>
            </Text>
          </Box>
          <Box key={`${key}-right`} flexShrink={0}>
            <Text color={THEME.muted}>{`${right} `}</Text>
          </Box>
        </Box>,
      )
    }

    if (line.kind === 'pills') {
      const info = modelInfo(row.model)
      const level = row.effort ? LEVELS[row.effort] : undefined
      const gates = countGates(row.gates)
      const filled = Math.round((marks.barCells * gates.done) / Math.max(1, gates.total))
      const cells = gates.done > 0 && gates.done < gates.total ? Math.min(marks.barCells - 1, Math.max(1, filled)) : filled
      const doneColor = gates.done === gates.total ? THEME.good : THEME.secondary
      const gauge = row.percent === undefined ? 0 : Math.round((row.percent / 100) * marks.gaugeCells)
      return frame(
        <Box key={`${key}-body`} flexDirection="row" columnGap={1} paddingLeft={2}>
          {row.model ? pill(`${key}-model`, on, (
            <Text color={info.hue} bold>
              {info.name}
              {level ? <Text color={level.color}>{` ${level.glyph}`}</Text> : null}
            </Text>
          )) : null}
          {row.percent === undefined ? null : pill(`${key}-gauge`, on, (
            <Text color={gaugeColor(row.percent)}>{`${own.gaugeIcon} ${own.gaugeFull.repeat(gauge)}${own.gaugeEmpty.repeat(marks.gaugeCells - gauge)} ${fill(text.gaugePercent, { percent: row.percent })}`}</Text>
          ))}
          {row.hasGates ? pill(`${key}-gates`, on, (
            <Text>
              <Text color={doneColor}>{own.barCell.repeat(cells)}</Text>
              <Text color={THEME.lifted}>{own.barCell.repeat(marks.barCells - cells)}</Text>
              <Text color={THEME.muted}>{` ${fill(text.gatesCount, { done: gates.done, total: gates.total })}${row.isPhaseDone ? ` ${MARK.sep} ${text.phaseDone}` : ''}`}</Text>
            </Text>
          )) : null}
        </Box>,
      )
    }

    if (line.kind === 'task') {
      const task = row.tasks[line.task!]!
      const mark = task.status === 'running' ? { glyph: own.running, color: THEME.accent } : task.status === 'done' ? { glyph: look.glyph.ok, color: THEME.good } : { glyph: look.glyph.warn, color: THEME.alert }
      return frame(
        <Box key={`${key}-body`} flexDirection="row" flexGrow={1} columnGap={1} paddingLeft={2}>
          <Text key={`${key}-mark`} color={mark.color}>{mark.glyph}</Text>
          <Box key={`${key}-text`} flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={THEME.muted}>{`${task.kind === 'shell' ? text.taskShell : text.taskMonitor} `}</Text>
              <Text color={isHover ? THEME.accent : task.status === 'running' ? THEME.onSurface : THEME.muted}>{task.command}</Text>
            </Text>
          </Box>
          <Box key={`${key}-right`} flexShrink={0}>
            <Text color={THEME.muted}>{`${task.elapsed} `}</Text>
          </Box>
        </Box>,
      )
    }

    if (line.kind === 'empty') {
      return frame(<Text key={`${key}-empty`} color={THEME.muted}>{`   ${text.noGates}`}</Text>)
    }

    const gate = row.gates[line.gate!]!
    const mark = gate.state === 'met' ? { glyph: look.glyph.ok, color: THEME.good } : gate.state === 'open' ? { glyph: look.glyph.expanded, color: THEME.warn } : { glyph: look.glyph.warn, color: THEME.alert }
    return frame(
      <Box key={`${key}-body`} flexDirection="row" columnGap={1} paddingLeft={2} flexGrow={1} flexShrink={1}>
        <Text key={`${key}-mark`} color={mark.color}>{mark.glyph}</Text>
        <Box key={`${key}-text`} flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" color={gate.state === 'open' ? THEME.onSurface : THEME.muted}>
            {`${row.isMain && gate.file ? `${gate.file}/` : ''}${gate.id} ${gate.text}${gate.state === 'abandoned' ? ` ${MARK.sep} ${text.abandoned}` : ''}`}
          </Text>
        </Box>
      </Box>,
    )
  }

  return <Box flexDirection="column">{lines.map(drawLine)}</Box>
}

export default Loops
