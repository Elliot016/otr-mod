export type Wedge = { left: string; right: string }

export const FILLED: Wedge = { left: '◤', right: '◥' }
export const OUTLINE: Wedge = { left: '◸', right: '◹' }

// iTerm2 draws ◢◣◤◥ itself as full-cell shapes unless its "Disable custom box drawing" advanced setting is on; any other terminal draws them from its font.
export async function detectWedge(termProgram: string | undefined, run: (argv: string[]) => Promise<string>): Promise<Wedge> {
  if (termProgram !== 'iTerm.app') return FILLED
  const isFontDrawn = await run(['defaults', 'read', 'com.googlecode.iterm2', 'DisableCustomBoxDrawing']).then(
    out => out.trim() === '1',
    () => false,
  )
  return isFontDrawn ? FILLED : OUTLINE
}
