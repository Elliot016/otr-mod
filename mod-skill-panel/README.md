<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-skill-panel

Lists your skills and agents; a click adds one to the prompt.

**How to open:** Skills pill

| Panel | Settings |
| --- | --- |
| ![][img-skill-panel] | ![][img-skill-panel-settings] |

**Skills, then the settings**

https://github.com/user-attachments/assets/90eb8704-5dc3-4695-8a08-96a7bebbc9d0

## Settings

Change them with `/mod-skill-panel settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |

## Install

```sh
claude plugin install mod-skill-panel@claude-mods --scope user
```

[img-skill-panel-settings]: ../showcase/skill-panel-settings.png
[img-skill-panel]: ../showcase/skill-panel.png
