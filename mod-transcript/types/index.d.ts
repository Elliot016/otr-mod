declare module 'claude-code' {
  interface PluginState {
    'mod-transcript': { turns: string[]; tools: string[]; pane: boolean }
  }
}
