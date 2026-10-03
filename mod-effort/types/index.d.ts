declare module 'claude-code' {
  interface PluginState {
    'mod-effort': { current: { model: string; effort: string } | null }
  }
}
