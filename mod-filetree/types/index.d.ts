declare module 'claude-code' {
  interface PluginState {
    'mod-filetree': {
      pane: boolean
      log: {
        turn: number
        seq: number
        working: boolean
        files: { path: string; kind: string; last: string; seq: number; add: number; del: number }[]
        steps: { id: number; turn: number; path: string; tool: string; kind: string; note: string; add: number; del: number; lines: { op: string; t: string }[] }[]
      }
    }
    'mod-menu': { hidden: boolean }
  }
}
