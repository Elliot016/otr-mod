# My mods

Claude Code mods I develop. A mod is a plugin whose `hooks/hooks.json` points at a hooks module that reacts to engine events and can draw UI. Needs Claude Code 2.1.287 or newer. Early-access API, it can change between releases.

## Mods

| Mod | What it does | Surface | State |
| --- | --- | --- | --- |
| `mod-desktop-status-line` | Moonlight status line drawn above the prompt: clock, git, path, cost, context and usage rings | Desktop | Loaded every session |
| `mod-skill-panel` | Puts a colored single-glyph chip before each skill's description in the slash list, picked from `color-tag:` in its frontmatter; strips the chip from the model's skill list. `/mod-skill-panel` opens a mouse-only sidebar: skills as chips grouped by tag, a pinned card for the one under the pointer, and a click adds it to the prompt. An Agents tab lists your agents and the project's by model and adds `@agent-<name>` | Terminal | Loaded every session |
| `mod-manager` | `/mod-manager` or the gear in the pill row opens a pane listing every mod (these and installed ones) and toggles each with its switch pill. A click on a mod's name opens its page as a second tab: description, its settings as cards, its actions and features | Terminal first | Loaded every session. Toggles take effect with the Reload plugins pill; only a new mod folder needs one restart. Checked live on 2026-10-03 |
| `mod-model-effort` | An effort slider in the band above the prompt, after Mods and Skills, drawn as the Moonlight-claude oh-my-posh model pill: model name, then `○ ◐ ● ◉ ◈` lit up to the current level. Click a glyph to set that level, saved for the model in `modelSettings` as Alt+P does; the level word shows for 2 s. Nerd Font caps and icon only when Windows Terminal uses a Nerd Font | Terminal | Loaded every session. A click applies to requests right away, but Alt+P and the spinner keep showing Claude Code's own level until the next session (by choice: running `/effort` would add a line per click) |
| `mod-prompts` | Our take on prompt-rail as a sidebar: every prompt of the session (live branch, so `/rewind`'s abandoned ones drop out). Prompts sit on a timeline; a click on one opens it in the pinned card with its turn's time, changed lines and tool count, and its `↗` jumps the transcript there. Long sessions page by 100. Opens from `/mod-prompts` or the Prompts entry in the menu pill | Terminal | Loaded every session |
| `mod-menu` | The pill row above the prompt: the panels' entries (Mods, Skills, Prompts, Files) side by side on one pill, the open panel's lifted into its own; pointing at one shows its tip above the row. A click shows that panel and closes the open one, a click on the open one hides it. Each panel mod draws its own entry (panel contract in the standard); mod-menu owns `/mod-menu`, which hides or shows the line | Terminal | Loaded every session. Checked live on 2026-10-03 |
| `mod-turn-fold` | Folds each finished turn under its prompt to one line (`+ 12 tools · Edit(path) +3 −1 · Skill(x) · 1m 4s`), keeping the final reply. Unfolded, the turn is a tinted card with a chip per kind of work (Thought, Read, Ran, Edited); a chip lists its calls, and a call opens to its diff, file lines or output. Each prompt shows when it was sent. `/mod-turn-fold settings` opens its panel | Terminal | Loaded every session. Chips, call previews and the time pill checked live on 2026-10-05 |
| `mod-wrap-up` | A Wrap up pill above the prompt offers Handoff or Compact. Either opens a card where Haiku's threads of the session and fixed items (files in play, decisions, open tasks, errors seen) each keep or drop on a click. Compact fills `/compact` with matching instructions; Handoff writes a handoff through a hidden fork with its `session-handoff` skill, runs `/clear` and pastes it into the fresh prompt. Nothing is sent. `/mod-wrap-up [compact]` opens the card | Terminal | The pill, hover and Compact card checked live on 2026-10-05 |
| `mod-collision-guard` | Before Edit, Write, MultiEdit or NotebookEdit, checks whether another open session edited the same file in the last 30 minutes (setting). If so, asks in Claude Code's question dialog: proceed, move to a worktree, cancel or your own instruction. Each session logs its edits to its own file under `~/.claude/mod-collision-guard/` | Terminal | Not checked live yet |
| `mod-file-tree` | A Files pill opens a sidebar with the tree of files Claude touched (this turn, the last turns or the session), the file in use lit while it works, names colored by status, `+/-` counts, and a Replay view that steps through a turn's diffs. A file's `↗` opens it in VS Code or its default app; a folder's mark and the Session folder pill open the folder in the file manager | Terminal | Loaded from its folder. Opening folders checked live on 2026-10-05 |
| `mod-next-steps` | After each turn, up to three suggested next prompts above the input from a hidden fork; a click, or its digit typed alone into the empty prompt, puts one in the prompt without sending; sending a prompt clears them | Terminal | Not checked live yet |
| `mod-blast-radius` | Holds a risky Bash command (the rules of the destructive-command hook plus your own in `~/.claude/mod-blast-radius/rules.json`) in a pane that shows what it would change: paths and sizes for `rm`, git status for resets, lost commits for force pushes. It runs only on Run | Terminal | Not checked live yet |

## Showcase

Recorded in Windows Terminal with a Nerd Font on 2026-10-05. `mod-desktop-status-line` draws only in the desktop app, so it has no capture here.

<!-- showcase:start -->

Recorded with `just showcase` from the scenes in `showcase/scenes/`. Each GIF links to its full video.

### mod-menu

The pill row above the prompt. Hovering an entry shows its hint.

![Pill row](showcase/menu-band.png)

[![mod-menu](showcase/gif/menu-hover.gif)](showcase/menu-hover.mp4)

### mod-manager

Hover a mod for its description card, and switch every mod's icons between Auto, Nerd and Plain. The scene switches to Plain and back to Auto, which saves each mod's icons setting twice.

[![mod-manager](showcase/gif/manager-hover-and-icons.gif)](showcase/manager-hover-and-icons.mp4)

| Auto (Nerd Font) | Plain |
| --- | --- |
| ![Auto (Nerd Font)](showcase/manager-icons-auto.png) | ![Plain](showcase/manager-icons-plain.png) |

### mod-file-tree

The Files panel while Claude works: the file in use carries a live word, each name takes its status color (named in the footer), and line counts sit in pills.

[![mod-file-tree](showcase/gif/file-tree-live.gif)](showcase/file-tree-live.mp4)

![Files panel](showcase/file-tree-panel.png)

### mod-next-steps

After each turn, up to three numbered suggestions. Click one, or type its digit alone into the empty prompt, to fill the prompt with it; nothing is sent.

![Suggestions](showcase/next-steps.png)

[![mod-next-steps](showcase/gif/next-steps-keys.gif)](showcase/next-steps-keys.mp4)

### mod-prompts

Every prompt of the session in a sidebar; pick one to read it in the card.

[![mod-prompts](showcase/gif/prompts-pick.gif)](showcase/prompts-pick.mp4)

### mod-skill-panel

Skills as chips grouped by tag, a card for the one under the pointer, and the panel's own settings.

[![mod-skill-panel](showcase/gif/skill-panel-and-settings.gif)](showcase/skill-panel-and-settings.mp4)

| Panel | Settings |
| --- | --- |
| ![Panel](showcase/skill-panel.png) | ![Settings](showcase/skill-panel-settings.png) |

### mod-turn-fold

A finished turn folds to one line under its prompt: what it did, its line counts and how long it took. Unfolded, a chip per kind of work (Thought, Read, Ran, Edited) opens its calls with their counts and durations; a call opens to its diff or output.

[![mod-turn-fold](showcase/gif/turn-fold-unfold.gif)](showcase/turn-fold-unfold.mp4)

| Folded | Open |
| --- | --- |
| ![Folded](showcase/turn-fold-folded.png) | ![Open](showcase/turn-fold-open.png) |

### mod-model-effort

The effort pill and its settings panel; hovering the pill names the levels.

![Model effort](showcase/model-effort.png)

### mod-blast-radius

A risky command waits in a card: what it does, what it touches, a verdict, and Cancel, Details, Run. Type 1, 2 or 3 alone into the empty prompt to answer.

[![mod-blast-radius](showcase/gif/blast-radius-hold.gif)](showcase/blast-radius-hold.mp4)

![Details pane](showcase/blast-radius-details.png)

### mod-collision-guard

Another open session edited the same file: proceed, move to a worktree, cancel or say what to do.

![Collision guard](showcase/collision-guard.png)

### mod-wrap-up

Wrap up offers Handoff or Compact. Compact reads the session's threads into a card, each click keeps or drops a line, and the /compact text follows; Fill prompt leaves it in the prompt to review. Played at double speed.

[![mod-wrap-up](showcase/gif/wrap-up-full.gif)](showcase/wrap-up-full.mp4)

<!-- showcase:end -->

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
