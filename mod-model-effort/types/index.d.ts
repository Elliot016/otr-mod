declare module 'claude-code' {
  interface PluginState {
    'mod-model-effort': { current: { model: string; effort: string } | null; pane: boolean }
  }
}
