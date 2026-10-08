<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-progress

The main session and every subagent: model, effort, context fill, tokens, time and gate progress.

**How to open:** Progress pill

| The pill | The panel |
| --- | --- |
| ![][img-progress-pill] | ![][img-progress-panel] |

**Two agents running, opened from the pill**

https://github.com/user-attachments/assets/473e8e21-cd0c-4971-8cef-448d2b092cf0

## Settings

Change them with `/mod-progress settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |

## Install

```sh
claude plugin install mod-progress@claude-mods --scope user
```

[img-progress-panel]: ../showcase/progress-panel.png
[img-progress-pill]: ../showcase/progress-pill.png
