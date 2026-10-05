declare module 'claude-code' {
  interface PluginState {
    'mod-turn-fold': { turns: string[]; tools: string[]; pane: boolean }
  }
}
