# My mods

Claude Code mods I develop. A mod is a plugin whose `hooks/hooks.json` points at a hooks module that reacts to engine events and can draw UI. Needs Claude Code 2.1.287 or newer. Early-access API, it can change between releases.

## Mods

| Mod | What it does | Surface | State |
| --- | --- | --- | --- |
| `mod-desktop-status-line` | Moonlight status line drawn above the prompt: clock, git, path, cost, context and usage rings | Desktop | Loaded every session |
| `mod-skill-panel` | Puts a colored single-glyph chip before each skill's description in the slash list, picked from `color-tag:` in its frontmatter; strips the chip from the model's skill list. `/mod-skill-panel` opens a mouse-only sidebar: invocable skills grouped by tag in columns, a card with the clicked skill, and `↵` to add it to the prompt | Terminal | Loaded every session |
| `mod-manager` | `/mod-manager` or the gear in the pill row opens a pane listing every mod (these and installed ones) and toggles each on or off. A click on a mod opens its page (`< back` returns): description, its settings and actions, its features | Terminal first | Loaded every session. Toggles take effect with Apply (reload plugins); only a new mod folder needs one restart. Checked live on 2026-10-03 |
| `mod-model-effort` | An effort slider in the band above the prompt, after Mods and Skills, drawn as the Moonlight-claude oh-my-posh model pill: model name, then `○ ◐ ● ◉ ◈` lit up to the current level. Click a glyph to set that level, saved for the model in `modelSettings` as Alt+P does; the level word shows for 2 s. Nerd Font caps and icon only when Windows Terminal uses a Nerd Font | Terminal | Loaded every session. A click applies to requests right away, but Alt+P and the spinner keep showing Claude Code's own level until the next session (by choice: running `/effort` would add a line per click) |
| `mod-prompts` | Our take on prompt-rail as a sidebar: every prompt of the session (live branch, so `/rewind`'s abandoned ones drop out). Mouse only: a click on a prompt shows it in the sticky card, `[↵]` jumps the transcript there. Opens from `/mod-prompts` or the Prompts entry in the menu pill | Terminal | Loaded after one restart. Not checked live yet |
| `mod-menu` | A pill above the prompt, `( Mods │ Skills )` (open bright, closed dim): a click shows that panel and closes the open one, a click on the open one hides it. Each panel mod draws its own entry (panel contract in the standard); mod-menu owns `/mod-menu`, which hides or shows the line | Terminal | Loaded every session. Checked live on 2026-10-03 |
| `mod-turn-fold` | Folds each finished turn under its prompt to one line (`+ 12 tools · Edit(path) +3 −1 · Skill(x) · 1m 4s`), keeping the final reply. Unfolded, the turn is a tinted card with a strip down its left: each tool call is one line with its own toggle, and a click on the chip, the line or the strip folds it back. `/mod-turn-fold settings` opens its panel: two settings with example cards, and its actions | Terminal | Loaded after one restart. Folding, chips, settings panel and actions checked live on 2026-10-03 |
| `mod-handoff` | A Handoff pill above the prompt: one click asks `Clear & continue?` in place, Yes writes a handoff of the chat through a hidden fork with its `session-handoff` skill, runs `/clear` and pastes the handoff into the fresh prompt to review and send. `/mod-handoff` runs it without the confirm | Terminal | Not checked live yet |
| `mod-collision-guard` | Before Edit, Write, MultiEdit or NotebookEdit, checks whether another open session edited the same file in the last 30 minutes (setting). If so, asks in Claude Code's question dialog: proceed, move to a worktree, cancel or your own instruction. Each session logs its edits to its own file under `~/.claude/mod-collision-guard/` | Terminal | Not checked live yet |
| `mod-file-tree` | A Files pill opens a sidebar with the tree of files Claude touched this session, the latest one lit while it works, `+/-` counts per edit, and a Replay view that steps through the last turn's diffs with Prev and Next | Terminal | Not checked live yet |
| `mod-next-steps` | After each turn, up to three suggested next prompts above the input from a hidden fork; a click puts one in the prompt, sending a prompt clears them | Terminal | Not checked live yet |
| `mod-blast-radius` | Holds a risky Bash command (the rules of the destructive-command hook plus your own in `~/.claude/mod-blast-radius/rules.json`) in a pane that shows what it would change: paths and sizes for `rm`, git status for resets, lost commits for force pushes. It runs only on Run | Terminal | Not checked live yet |

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

## `showcase.json` (my convention, read by mod-manager and each mod's own settings panel)

Optional file at a mod's root. Without it, mod-manager derives the feature list from the events found in the hooks source.

```json
{
  "tagline": "One line shown under the description",
  "features": [{ "title": "Short name", "detail": "What it does, one or two sentences." }],
  "actions": [{ "label": "Button text", "command": "mod-x", "args": "debug" }],
  "previews": { "field": { "true": [{ "bar": "accent", "spans": [{ "text": "example", "color": "muted" }] }] } }
}
```

A mod's settings are Claude Code's `userConfig` in its `plugin.json`, not this file. They show in `/config`, in the mod's own `/mod-x settings` panel, and on its page in mod-manager.

## Standard

Every mod follows `~/.claude/skills/mod-builder/references/standard.md`:

- Plugin, folder and main command share one kebab-case name, `mod-<name>`: `mod-manager`, `mod-skill-panel`. None may collide with a skill or a built-in.
- Each mod carries an unchanged copy of `templates/cli-mod/hooks/theme.ts` (Moonlight tokens and the tool-wizard marks). Edit the template first, then the copies.
- Panes are flat: a `▸ Title · count` heading, a status line, `•` rows, and one fixed-height card for the selected item's detail.
- Glyphs are portable single-width Unicode written as `\uXXXX`, never Nerd Font.
- Every pane is mouse only, so the prompt keeps the keyboard: a click on the row's action glyph (`◉`, `[↵]`) acts, a click on the text shows it in the sticky card.
