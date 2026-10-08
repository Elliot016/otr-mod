<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-manager

Turns mods on and off and edits their settings.

**How to open:** The gear pill, or `/mod-manager`

| Auto (Nerd Font) | Plain |
| --- | --- |
| ![][img-manager-icons-auto] | ![][img-manager-icons-plain] |

**Hover a mod, switch the icons**

https://github.com/user-attachments/assets/d93b77a8-7a43-4b82-ac00-1ffc6e6b8da3

## Settings

Change them with `/mod-manager settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |

## Install

```sh
claude plugin install mod-manager@claude-mods --scope user
```

[img-manager-icons-auto]: ../showcase/manager-icons-auto.png
[img-manager-icons-plain]: ../showcase/manager-icons-plain.png
