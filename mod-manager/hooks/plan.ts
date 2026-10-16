// mod-manager / hooks/plan.ts, by v-amorim
// Works out what Apply will do and what was checked, and runs the claude CLI steps one by one.
import type { CatalogMod, Io } from './registry'
import text from './text'
import { fill } from './theme'

// kind on and off are settings.json toggles Apply writes first; install and update carry the CLI call.
export type Step = { kind: 'on' | 'off' | 'install' | 'update'; name: string; line: string; argv?: string[] }

export type PlanInput = {
  // Mods toggled in the pane and not yet applied, by name, with the state they should get.
  pending: ReadonlyMap<string, boolean>
  shown: (name: string) => string
  catalog: CatalogMod[]
  // Catalog keys ticked for install, and update keys the person unticked (updates start ticked).
  installs: ReadonlySet<string>
  skipped: ReadonlySet<string>
  // This mod's own icons setting: a forced mode rides along with an install of a mod that declares icons.
  iconMode: string
  arrow: string
}

// Each CLI call may take a while: it downloads the plugin.
export const CLI_MS = 120000

// Toggles first, then installs, then updates: the order Apply runs them in.
export function planOf({ pending, shown, catalog, installs, skipped, iconMode, arrow }: PlanInput): Step[] {
  const toggles = [...pending].map(([name, isOn]): Step => ({ kind: isOn ? 'on' : 'off', name, line: fill(isOn ? text.planOn : text.planOff, { name: shown(name) }) }))
  const added = catalog
    .filter(mod => mod.canInstall && installs.has(mod.key))
    .map((mod): Step => {
      const withIcons = iconMode !== 'auto' && mod.declaresIcons
      return {
        kind: 'install',
        name: mod.name,
        line: fill(withIcons ? text.planInstallIcons : text.planInstall, { name: shown(mod.name), version: mod.version, mode: iconMode }),
        argv: ['claude', 'plugin', 'install', mod.target, '--scope', 'user', ...(withIcons ? ['--config', `icons=${iconMode}`] : [])],
      }
    })
  const updated = catalog
    .filter(mod => mod.canUpdate && !skipped.has(mod.key))
    .map((mod): Step => ({ kind: 'update', name: mod.name, line: fill(text.planUpdate, { name: shown(mod.name), from: mod.installedVersion, to: mod.version, arrow }), argv: ['claude', 'plugin', 'update', mod.target] }))
  return [...toggles, ...added, ...updated]
}

export type Check = { ok: boolean; line: string }

export type CheckedInput = { version: string | null; market: string; hasCatalog: boolean; fontFound: boolean | null }

// What was detected: the Claude Code version, the marketplace and the font. A miss is not an error, only a heads-up.
export function checkedOf({ version, market, hasCatalog, fontFound }: CheckedInput): Check[] {
  const number = version ? /\d+\.\d+\.\d+\S*/.exec(version)?.[0] : undefined
  return [
    number ? { ok: true, line: fill(text.checkVersion, { version: number }) } : { ok: false, line: text.checkVersionUnknown },
    hasCatalog ? { ok: true, line: fill(text.checkMarket, { market }) } : { ok: false, line: fill(text.checkMarketMissing, { market }) },
    fontFound ? { ok: true, line: text.checkFont } : { ok: false, line: text.checkNoFont },
  ]
}

const firstLine = (output: string) => output.trim().split('\n').find(Boolean)?.trim() ?? ''

// Runs each CLI step in turn; a failure goes to onFail and the rest still run. Returns how many failed.
export async function runSteps(io: Io, steps: Step[], onFail: (step: Step, reason: string) => void): Promise<number> {
  let failed = 0
  for (const step of steps) {
    if (!step.argv) continue
    try {
      if (!io.run) throw new Error('cannot run claude')
      const result = await io.run(step.argv, CLI_MS)
      if (result.exitCode !== 0) throw new Error(firstLine(result.stderr) || firstLine(result.stdout) || `exit ${result.exitCode}`)
    } catch (error) {
      failed++
      onFail(step, error instanceof Error ? error.message : String(error))
    }
  }
  return failed
}
