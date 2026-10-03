declare module 'claude-code' {
  interface PluginState {
    'mod-toggle': { turns: string[]; tools: string[]; pane: boolean }
  }
}
