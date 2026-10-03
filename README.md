# My mods

Claude Code mods I develop. A mod is a plugin whose `hooks/hooks.json` points at a hooks module that reacts to engine events and can draw UI. Needs Claude Code 2.1.287 or newer. Early-access API, it can change between releases.

## Mods

| Mod | What it does | Surface | State |
| --- | --- | --- | --- |
| `mod-app-statusline` | Moonlight status line drawn above the prompt: clock, git, path, cost, context and usage rings | Desktop | Loaded every session |
| `mod-skill-panel` | Puts a colored single-glyph chip before each skill's description in the slash list, picked from `color-tag:` in its frontmatter; strips the chip from the model's skill list. `/mod-skill-panel` opens a mouse-only sidebar: invocable skills grouped by tag in columns, a card with the clicked skill, and `↵` to add it to the prompt | Terminal | Loaded every session |
| `mod-manager` | `/mod-manager` opens a pane listing every mod (these and installed ones), toggles each on or off, shows description and an interactive feature showcase | Terminal first | Loaded every session. Toggles take effect with Apply (reload plugins); only a new mod folder needs one restart. Checked live on 2026-10-03 |
| `mod-effort` | An effort slider in the band above the prompt, after Mods and Skills, drawn as the Moonlight-claude oh-my-posh model pill: model name, then `○ ◐ ● ◉ ◈` lit up to the current level. Click a glyph to set that level, saved for the model in `modelSettings` as Alt+P does; the level word shows for 2 s. Nerd Font caps and icon only when Windows Terminal uses a Nerd Font | Terminal | Loaded every session. Not checked live yet |
| `mod-prompts` | Our take on prompt-rail as a sidebar: every prompt of the session (live branch, so `/rewind`'s abandoned ones drop out). Mouse only: a click on a prompt shows it in the sticky card, `[↵]` jumps the transcript there. Opens from `/mod-prompts` or the Prompts entry in the menu pill | Terminal | Loaded after one restart. Not checked live yet |
| `mod-menu` | A pill above the prompt, `( Mods │ Skills )` (open bright, closed dim): a click shows that panel and closes the open one, a click on the open one hides it. Each panel mod draws its own entry (panel contract in the standard); mod-menu owns `/mod-menu`, which hides or shows the line | Terminal | Loaded every session. Checked live on 2026-10-03 |

## Layout

```
mods/
  <mod-name>/
    .claude-plugin/plugin.json     manifest (name required)
    hooks/hooks.json               { "modules": ["./register.tsx"] }
    hooks/register.tsx             export const register: Register = on => { ... }
    tests/*.test.tsx               run by claude plugin test
    showcase.json                  optional, read by mod-manager
```

`.claude-plugin/types/` appears after the first load. Claude Code writes it, do not edit it.

## Loading

| Goal | How |
| --- | --- |
| Try one mod in one session | `claude --plugin-dir ~/.claude/mods/<name>` (hot reloads on save) |
| Load for every session | Add the path to `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, separated by `;` on Windows and `:` elsewhere |
| Hot reload in long-running sessions | `env.CLAUDE_CODE_PLUGIN_DIR_WATCH` set to `1` (already set) |
| Pick up changes in an open session | `/reload-plugins` |

Only mods I write belong in `CLAUDE_CODE_PLUGIN_DIRS`. Installed plugins stay under `enabledPlugins`. Mods are not sandboxed and run with my permissions.

## Make a new mod

1. Ask the `mod-builder` agent, or copy `~/.claude/skills/mod-builder/templates/cli-mod` to `~/.claude/mods/<name>` and rename it in `plugin.json` and its test.
2. `claude plugin validate ~/.claude/mods/<name>`
3. `claude plugin test ~/.claude/mods/<name>`
4. Try it with `--plugin-dir`, then add it to `CLAUDE_CODE_PLUGIN_DIRS`.

References: `~/.claude/skills/mod-builder/` (`SKILL.md`, `references/overview.md`, `references/gotchas.md`, `references/docs/`).

## `showcase.json` (my convention, read only by mod-manager)

Optional file at a mod's root. Without it, mod-manager derives the feature list from the events found in the hooks source.

```json
{
  "tagline": "One line shown under the description",
  "features": [{ "title": "Short name", "detail": "What it does, one or two sentences." }]
}
```

## Standard

Every mod follows `~/.claude/skills/mod-builder/references/standard.md`:

- Plugin, folder and main command share one kebab-case name, `mod-<name>`: `mod-manager`, `mod-skill-panel`. None may collide with a skill or a built-in.
- Each mod carries an unchanged copy of `templates/cli-mod/hooks/theme.ts` (Moonlight tokens and the tool-wizard marks). Edit the template first, then the copies.
- Panes are flat: a `▸ Title · count` heading, a status line, `•` rows, and one fixed-height card for the selected item's detail.
- Glyphs are portable single-width Unicode written as `\uXXXX`, never Nerd Font.
- Every pane is mouse only, so the prompt keeps the keyboard: a click on the row's action glyph (`◉`, `[↵]`) acts, a click on the text shows it in the sticky card.
