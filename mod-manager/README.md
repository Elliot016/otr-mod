<!-- mod-manager / README.md, by v-amorim -->
<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-manager

Part of [moonlight-claude-mods][doc-root].

Installs, turns on and off, and updates mods, and edits their settings.

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

| Auto (Nerd Font) | Plain | A mod's page and its settings |
| --- | --- | --- |
| ![][img-manager-icons-auto] | ![][img-manager-icons-plain] | ![][img-manager-page] |

| Hover a mod, switch the icons |
| --- |
| https://github.com/user-attachments/assets/3eb36efb-13ef-4859-86e9-592eeb9f6060 |

## Settings

Change them with `/mod-manager settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-manager-icons-auto]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/manager-icons-auto.png
[img-manager-icons-plain]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/manager-icons-plain.png
[img-manager-page]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/manager-page.png
