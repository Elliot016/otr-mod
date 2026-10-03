export type Snapshot = {
  now: number
  branch: string
  branchUrl: string
  isDirty: boolean
  ahead: number
  behind: number
  root: string
  path: string
  cost: number | null
  contextPercent: number | null
  fiveHour: { percent: number; resetsAt?: string } | null
  sevenDay: { percent: number; resetsAt?: string } | null
}

export type ThemeSegment = { color: string; rules: { min: number; color: string }[] }

export type Look = {
  clock: ThemeSegment
  git: ThemeSegment
  path: ThemeSegment
  pathCycle: string[]
  gitMarks: { pending: string; divergence: string; ahead: string; behind: string }
  cost: ThemeSegment
  context: ThemeSegment
  fiveHour: ThemeSegment
  sevenDay: ThemeSegment
}

declare module 'claude-code' {
  interface PluginState {
    'mod-app-statusline': { snapshot: Snapshot | null; look: Look | null; menuOpen: boolean }
  }
}
