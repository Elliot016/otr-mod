<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-skill-panel

Part of [moonlight-claude-mods][doc-root].

Lists your skills and agents; a click adds one to the prompt.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-skill-panel@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Skills pill.

## See it

| Panel | Tags on slash commands | Added to the prompt |
| --- | --- | --- |
| ![][img-skill-panel] | ![][img-skill-panel-slash] | ![][img-skill-panel-added] |

| Settings |
| --- |
| ![][img-skill-panel-settings] |

| Tags while typing /, add a skill, then the settings |
| --- |
| https://github.com/user-attachments/assets/cd3fef1e-dea9-4a25-b110-e2a87366a7b1 |

## Settings

Change them with `/mod-skill-panel settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |

[doc-icons]: ../README.md#icons-and-nerd-fonts
[doc-install]: ../README.md#install
[doc-root]: ../README.md

[img-skill-panel-added]: ../showcase/skill-panel-added.png
[img-skill-panel-settings]: ../showcase/skill-panel-settings.png
[img-skill-panel-slash]: ../showcase/skill-panel-slash.png
[img-skill-panel]: ../showcase/skill-panel.png
