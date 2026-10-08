<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-manager

Part of [moonlight-claude-mods][doc-root].

Turns mods on and off and edits their settings.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-manager@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

The gear pill, or `/mod-manager`.

## See it

| Auto (Nerd Font) | Plain |
| --- | --- |
| ![][img-manager-icons-auto] | ![][img-manager-icons-plain] |

| Hover a mod, switch the icons |
| --- |
| https://github.com/user-attachments/assets/9905f3f6-c708-44c6-a14d-a91845bfc4ca |

## Settings

Change them with `/mod-manager settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |

[doc-icons]: ../README.md#icons-and-nerd-fonts
[doc-install]: ../README.md#install
[doc-root]: ../README.md

[img-manager-icons-auto]: ../showcase/manager-icons-auto.png
[img-manager-icons-plain]: ../showcase/manager-icons-plain.png
