<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-model-effort

Shows the model and effort level; a click changes either.

**How to open:** The model pill

| The model panel |
| --- |
| ![][img-model-effort-panel] |

**Effort on hover, models on click**

https://github.com/user-attachments/assets/043dd359-6d8a-44aa-b2d4-76d51d5ec376

## Settings

Change them with `/mod-model-effort settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |

## Install

```sh
claude plugin install mod-model-effort@claude-mods --scope user
```

[img-model-effort-panel]: ../showcase/model-effort-panel.png
