<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-collision-guard

Asks before editing a file another session just changed.

**How to open:** Automatic

| Asking before an edit |
| --- |
| ![][img-collision-guard] |

## Features

- **Shared log:** Each session records the files it edits in its own small file under ~/.claude/mod-collision-guard, so sessions never write over each other.
- **Pause:** Before Edit, Write, MultiEdit or NotebookEdit, a question appears when another open session edited that file inside the window.
- **Four ways out:** Proceed, move to a worktree (Claude calls EnterWorktree and redoes the edit there), cancel, or type an instruction for Claude.

## Settings

Change them with `/mod-collision-guard settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Guard edits | on | Asks when another session edited it. Only edits inside the window count. Off, edits are still recorded for other sessions but never paused |
| Window (minutes) | `30` | How long an edit counts as recent. Only other sessions' edits count |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |

## Install

```sh
claude plugin install mod-collision-guard@claude-mods --scope user
```

[img-collision-guard]: ../showcase/collision-guard.png
