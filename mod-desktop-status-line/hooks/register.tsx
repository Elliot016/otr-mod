// mod-desktop-status-line / hooks/register.tsx, by v-amorim
// Draws the status line above the prompt with branch, context, limits and cost.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Look, Snapshot } from '../types'
import style from './style'
import text from './text'

export const fill = (template: string, values: Record<string, string | number> = {}) => template.replace(/{(\w+)}/g, (slot, name: string) => (name in values ? String(values[name]) : slot))

const COLORS = style.colors
const SYMBOL = style.statuslineMarks

const MOONLIGHT = {
  surface3: COLORS.theme.surface3,
  muted: COLORS.theme.muted,
}

// Neutral so the outline sits on the desktop's own gray instead of fighting it.
const PILL = { borderStyle: 'round', borderColor: COLORS.statusline.pillBorder, paddingX: 1 } as const
const MENU_BACKGROUND = COLORS.statusline.menuBackground

const THEME = 'Documents/oh-my-posh/themes/Moonlight-claude.omp.json'

const usageRules = (ramp: string[]) => [90, 79, 59, 39, 10].map((min, i) => ({ min, color: ramp[5 - i]! }))
const RAMP = COLORS.usage

// Mirrors the theme as it is today, for when the file can't be read.
const FALLBACK_LOOK: Look = {
  clock: { color: COLORS.pills.readout, rules: [] },
  git: { color: COLORS.theme.accent, rules: [] },
  path: { color: COLORS.theme.secondary, rules: [] },
  pathCycle: [COLORS.theme.onSurface, COLORS.theme.secondary],
  gitMarks: { pending: COLORS.theme.accent, divergence: COLORS.statusline.divergence, ahead: COLORS.theme.onSurface, behind: COLORS.statusline.behind },
  cost: { color: RAMP[0]!, rules: [20, 10, 5, 2, 0.5].map((min, i) => ({ min, color: RAMP[5 - i]! })) },
  context: { color: RAMP[0]!, rules: usageRules(RAMP) },
  fiveHour: { color: RAMP[0]!, rules: usageRules(RAMP) },
  sevenDay: { color: RAMP[0]!, rules: usageRules(RAMP) },
}

const SEGMENTS: [Exclude<keyof Look, 'pathCycle' | 'gitMarks'>, (seg: OmpSegment) => boolean][] = [
  ['clock', seg => seg.type === 'time'],
  ['git', seg => seg.type === 'git'],
  ['path', seg => seg.type === 'path'],
  ['cost', seg => String(seg.template).includes('.Cost.TotalCostUSD')],
  ['context', seg => String(seg.template).includes('.TokenUsagePercent')],
  ['fiveHour', seg => String(seg.template).includes('.FiveHourUsage')],
  ['sevenDay', seg => String(seg.template).includes('.SevenDayUsage')],
]

type OmpSegment = { type?: string; template?: string; foreground?: string; foreground_templates?: string[]; options?: { cycle?: string[] } }

const snapshot = atom({ plugin: 'mod-desktop-status-line', key: 'snapshot' } as const, null)
const look = atom({ plugin: 'mod-desktop-status-line', key: 'look' } as const, null)
const menuOpen = atom({ plugin: 'mod-desktop-status-line', key: 'menuOpen' } as const, false)

// oh-my-posh takes the first foreground_template that matches, else the segment's foreground.
const colorFor = (seg: Look[keyof Omit<Look, 'pathCycle' | 'gitMarks'>], value: number) =>
  seg.rules.find(rule => value >= rule.min)?.color ?? seg.color

async function loadLook($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  const text = await $.fs.read(`${home}/${THEME}`).catch(() => '')
  let theme: { palette?: Record<string, string>; blocks?: { segments?: OmpSegment[] }[] } = {}
  try {
    theme = text ? JSON.parse(String(text)) : {}
  } catch {}
  const palette = theme.palette ?? {}
  const resolve = (value: string | undefined) => {
    if (!value) return undefined
    const named = value.startsWith('p:') ? palette[value.slice(2)] : value
    return named?.startsWith('p:') ? palette[named.slice(2)] : named
  }
  const segments = (theme.blocks ?? []).flatMap(block => block.segments ?? [])
  const next: Look = { ...FALLBACK_LOOK }
  for (const [name, matches] of SEGMENTS) {
    const seg = segments.find(matches)
    if (!seg) continue
    const rules = (seg.foreground_templates ?? []).flatMap(template => {
      const found = /\bge\s+\.[\w.]+\s+([\d.]+)\s*}}\s*(p:\w+|#[0-9a-fA-F]{3,8})/.exec(template)
      const color = resolve(found?.[2])
      return found && color ? [{ min: Number(found[1]), color }] : []
    })
    next[name] = { color: resolve(seg.foreground) ?? FALLBACK_LOOK[name].color, rules }
    if (name === 'path' && seg.options?.cycle?.length) {
      next.pathCycle = seg.options.cycle.map(c => resolve(c) ?? FALLBACK_LOOK.path.color)
    }
  }
  next.gitMarks = {
    pending: resolve(palette.git_changes_pending) ?? FALLBACK_LOOK.gitMarks.pending,
    divergence: resolve(palette.git_branch_divergence) ?? FALLBACK_LOOK.gitMarks.divergence,
    ahead: resolve(palette.git_commits_ahead) ?? FALLBACK_LOOK.gitMarks.ahead,
    behind: resolve(palette.git_commits_behind) ?? FALLBACK_LOOK.gitMarks.behind,
  }
  await update($, look, () => next)
}

const untilReset = (iso: string | undefined, now: number, unit: 'hm' | 'dh') => {
  if (!iso) return ''
  const minutes = Math.floor((Date.parse(iso) - now) / 60000)
  if (minutes <= 0) return text.resetsNow
  if (unit === 'hm') {
    return minutes >= 120 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
  }
  const hours = Math.floor(minutes / 60)
  return hours >= 24 ? `${Math.floor(hours / 24)}d${hours % 24}h` : `${hours}h`
}

const branchUrl = (remote: string | null, branch: string) => {
  if (!remote || !branch) return ''
  const base = remote
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/')
    .replace(/\.git$/, '')
  try {
    return new URL(`${base}/tree/${branch}`).href
  } catch {
    return ''
  }
}

const ICONS = {
  context: '<path d="M-5 -2 L0 -5 L5 -2 L0 1 Z M-5 1.5 L0 4.5 L5 1.5" />',
  clock: '<circle cx="0" cy="0" r="5" /><path d="M0 -2.5 V0 L2.5 1.5" />',
  calendar:
    '<rect x="-5" y="-4.5" width="10" height="9.5" rx="1.8" /><path d="M-5 -1.5 H5 M-2.5 -6 V-3.5 M2.5 -6 V-3.5" />',
  cost: '<path d="M0 -6 V6 M3 -3.5 C3 -5 -3 -5 -3 -2.5 C-3 0 3 0 3 2.5 C3 5 -3 5 -3 3.5" />',
} as const

const RING_SIZE = 20
const RING_CELLS = 3

// Cell offsets only, no percentages: center the card by measuring both widths in cells.
const centeredOffset = (stat: { value: string; label?: string; tooltip: string }) => {
  const pill = 4 + RING_CELLS + 1 + stat.value.length + (stat.label ? 1 + stat.label.length : 0)
  const card = 4 + stat.tooltip.length
  return Math.round((pill - card) / 2) - 1
}

const ringSvg = (kind: keyof typeof ICONS, percent: number, color: string) => {
  const circumference = 2 * Math.PI * 13
  const dash = (Math.min(100, Math.max(0, percent)) / 100) * circumference
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RING_SIZE}" height="${RING_SIZE}" viewBox="-16 -16 32 32">` +
    `<circle r="13" fill="none" stroke="${MOONLIGHT.surface3}" stroke-width="2.5"/>` +
    `<circle r="13" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${dash} ${circumference}" transform="rotate(-90)"/>` +
    `<g fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</g>` +
    '</svg>'
  )
}

async function gitState($: EngineInterface, cwd: string, root: string) {
  // A large repo or a cold disk can keep git busy for long; the band then shows no branch rather than wait.
  const status = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: 5000 }).catch(() => null)
  if (status?.exitCode === 0) {
    const lines = status.stdout.split('\n')
    const header = (name: string) => lines.find(line => line.startsWith(`# branch.${name} `))?.slice(`# branch.${name} `.length).trim() ?? ''
    const [, ahead = '0', behind = '0'] = /^\+(\d+) -(\d+)$/.exec(header('ab')) ?? []
    const isDetached = header('head') === '(detached)'
    return {
      branch: isDetached ? header('oid').slice(0, 7) : header('head'),
      isDetached,
      isDirty: lines.some(line => line && !line.startsWith('#')),
      ahead: Number(ahead),
      behind: Number(behind),
    }
  }
  // No git on PATH: read the branch name alone from the repository files.
  const head = String(await $.fs.read(`${root}/.git/HEAD`).catch(() => ''))
  const branch = /ref: refs\/heads\/(.+)/.exec(head)?.[1]?.trim()
  return branch ? { branch, isDetached: false, isDirty: false, ahead: 0, behind: 0 } : null
}

// PowerShell's -EncodedCommand takes UTF-16LE base64, which sidesteps quoting a path with spaces.
const encodePowerShell = (script: string) => {
  const bytes = new Uint8Array(script.length * 2)
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i)
    bytes[i * 2] = code & 0xff
    bytes[i * 2 + 1] = code >> 8
  }
  // @ts-expect-error The runtime has Uint8Array.toBase64, the installed lib types predate it.
  return bytes.toBase64()
}

const OPENERS = {
  explorer: {
    name: text.openFileManagerName,
    label: text.openFileManagerLabel,
    windows: (quoted: string) => `Start-Process -FilePath ${quoted}`,
    mac: (path: string) => ['open', path],
  },
  vscode: {
    name: text.openVscodeName,
    label: text.openVscodeLabel,
    // code.cmd is a batch file, so its own console stays hidden while VS Code opens normally.
    windows: (quoted: string) => `Start-Process -FilePath 'code' -ArgumentList ('"' + ${quoted} + '"') -WindowStyle Hidden`,
    mac: (path: string) => ['open', '-a', 'Visual Studio Code', path],
  },
} as const

async function openWith($: EngineInterface, app: keyof typeof OPENERS, path: string) {
  const opener = OPENERS[app]
  const quoted = `'${path.replaceAll("'", "''")}'`
  // A child of the engine inherits its hidden window state; Start-Process asks for a visible one.
  const argv = /^[A-Za-z]:/.test(path)
    ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(opener.windows(quoted))]
    : opener.mac(path)
  const result = await $.process.run(argv).catch(error => ({ exitCode: -1, stderr: String(error) }))
  if (result.exitCode !== 0) $.ui.toast(fill(text.openFailed, { name: opener.name, error: result.stderr.trim() }))
}

// Refreshes start from the timer, a turn's end and a session's end; one that a newer one overtook drops its older figures.
let refreshes = 0

async function refresh($: EngineInterface) {
  const mine = ++refreshes
  const [root, usage, now] = await Promise.all([
    $.session.root(),
    $.session.usage(),
    $.clock.now(),
  ])
  const repo = await $.session.repo().catch(() => null)
  const git = await gitState($, root, repo?.root ?? root)
  const limit = (kind: string) => {
    const found = usage.rateLimits.find(one => one.kind === kind)
    return found ? { percent: Math.round(found.percentUsed), resetsAt: found.resetsAt } : null
  }
  const next: Snapshot = {
    now,
    branch: git?.branch ?? '',
    branchUrl: git?.isDetached ? '' : branchUrl(repo?.remote ?? null, git?.branch ?? ''),
    isDirty: git?.isDirty ?? false,
    ahead: git?.ahead ?? 0,
    behind: git?.behind ?? 0,
    root,
    path: root.split(/[\\/]/).filter(Boolean).slice(-2).join(` ${SYMBOL.pathSep} `),
    cost: usage.cost?.usd ?? null,
    contextPercent: usage.context.percent ?? null,
    fiveHour: limit('five_hour'),
    sevenDay: limit('seven_day'),
  }
  if (mine === refreshes) await update($, snapshot, () => next)
}

// The 30 s refresh; a second session.start restarts it instead of stacking another.
let ticker: { cancel: () => void } | null = null

// session.start waits this long at most for the first figures, so a slow git never holds up the start.
const FIRST_REFRESH_MS = 2000

async function band($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]) {
  const snap = await read($, snapshot)
  const theme = (await read($, look)) ?? FALLBACK_LOOK
  const isMenuOpen = await read($, menuOpen)

  if (!snap) return null

  // @ts-expect-error The host types omit Svg from this element set, yet the band draws it.
  const { Box, Button, Link, Svg, Text } = $.ui.resolve(e)
  const clock = new Date(snap.now).toTimeString().slice(0, 5)
  const stats: { kind: keyof typeof ICONS; percent: number; value: string; label?: string; tooltip: string; color: string }[] = []

  if (snap.contextPercent !== null) {
    const percent = Math.round(snap.contextPercent)
    stats.push({ kind: 'context', percent, value: `${percent}%`, tooltip: text.contextTooltip, color: colorFor(theme.context, percent) })
  }
  if (snap.fiveHour) {
    const { percent } = snap.fiveHour
    stats.push({ kind: 'clock', percent, value: `${percent}%`, label: untilReset(snap.fiveHour.resetsAt, snap.now, 'hm'), tooltip: text.fiveHourTooltip, color: colorFor(theme.fiveHour, percent) })
  }
  if (snap.sevenDay) {
    const { percent } = snap.sevenDay
    stats.push({ kind: 'calendar', percent, value: `${percent}%`, label: untilReset(snap.sevenDay.resetsAt, snap.now, 'dh'), tooltip: text.sevenDayTooltip, color: colorFor(theme.sevenDay, percent) })
  }
  if (snap.cost !== null) {
    stats.push({ kind: 'cost', percent: 100, value: `$${snap.cost.toFixed(2)}`, tooltip: text.costTooltip, color: colorFor(theme.cost, snap.cost) })
  }

  const folders = snap.path.split(` ${SYMBOL.pathSep} `)
  const marks = theme.gitMarks
  const branch = (
    <Text>
      <Text color={theme.git.color}>{`${SYMBOL.branch} ${snap.branch}`}</Text>
      {snap.isDirty && <Text color={marks.pending}>{` ${SYMBOL.dirty}`}</Text>}
      {snap.ahead > 0 && snap.behind > 0 && <Text color={marks.divergence}>{` ${SYMBOL.diverged}${snap.ahead}/${snap.behind}`}</Text>}
      {snap.ahead > 0 && snap.behind === 0 && <Text color={marks.ahead}>{` ${SYMBOL.ahead}${snap.ahead}`}</Text>}
      {snap.behind > 0 && snap.ahead === 0 && <Text color={marks.behind}>{` ${SYMBOL.behind}${snap.behind}`}</Text>}
    </Text>
  )

  return (
    <Box gap={1} flexWrap="wrap" alignItems="center">
      <Box {...PILL}>
        <Text color={theme.clock.color}>{clock}</Text>
      </Box>
      {snap.branch && <Box {...PILL}>{snap.branchUrl ? <Link href={snap.branchUrl}>{branch}</Link> : branch}</Box>}
      <Box {...PILL} gap={1}>
        <Text>
          {folders.map((folder, i) => {
            const color = theme.pathCycle[i % theme.pathCycle.length] ?? theme.path.color
            return <Text key={`f${i}`} color={color}>{i > 0 ? ` ${SYMBOL.pathSep} ${folder}` : folder}</Text>
          })}
        </Text>
        {isMenuOpen &&
          (Object.keys(OPENERS) as (keyof typeof OPENERS)[]).map(app => (
            <Button
              key={`open-${app}`}
              plain
              label={OPENERS[app].label}
              onPress={() => {
                void update($, menuOpen, () => false)
                void openWith($, app, snap.root)
              }}
            />
          ))}
        <Button key="open" plain label={isMenuOpen ? SYMBOL.close : SYMBOL.menu} onPress={() => update($, menuOpen, isOpen => !isOpen)} />
      </Box>
      {stats.map(stat => (
        <Box key={stat.kind} {...PILL} gap={1} alignItems="center" position="relative">
          <Svg source={ringSvg(stat.kind, stat.percent, stat.color)} alt={stat.tooltip} width={RING_SIZE} height={RING_SIZE} />
          <Text color={stat.color} bold>{stat.value}</Text>
          {stat.label && <Text color={MOONLIGHT.muted}>{stat.label}</Text>}
          <Box
            position="absolute"
            top={-2}
            left={centeredOffset(stat)}
            display="none"
            hover={{ display: 'flex' }}
            paddingX={1}
            borderStyle="round"
            borderColor={PILL.borderColor}
            backgroundColor={MENU_BACKGROUND}
          >
            <Text color={MOONLIGHT.muted}>{stat.tooltip}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadLook($)
    ticker?.cancel()
    ticker = $.clock.every(30000, () => void refresh($).catch(() => {}))
    await Promise.race([refresh($).catch(() => {}), $.clock.sleep(FIRST_REFRESH_MS).catch(() => {})])

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($).catch(() => {})

    return next(e)
  })

  // A /resume or /clear changes the branch, cost and context shown: the old figures go at once, the new ones follow once the switch is done.
  on('session.end', async ($, e, next) => {
    refreshes += 1
    await update($, snapshot, () => null)
    $.clock.after(500, () => void refresh($).catch(() => {}))

    return next(e)
  })

  // The terminal keeps its oh-my-posh status line; the row is for the desktop only.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)

    return (await band($, e)) ?? next(e)
  })
}
