<!-- mod-manager / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
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

| Icons on Auto (Nerd Font) | Icons on Plain | A mod's page: its spend and its settings |
| --- | --- | --- |
| ![][img-manager-icons-auto] | ![][img-manager-icons-plain] | ![][img-manager-page] |

| The first-run card, a mod's spend, and a toggle |
| --- |
| https://github.com/user-attachments/assets/362d6469-ed76-4465-a7f0-b6b4457a7f2d |

## Features

- **Mods:** Installs, turns on and off, and updates mods, and edits their settings, from one panel.
- **Hover cards:** Pointing at a mod shows its description cut to two lines. Show all grows the card to the full description, and Show less cuts it back. The same switch opens a mod's whole feature list.

## Settings

Change them with `/mod-manager settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-manager-icons-auto]: https://github.com/user-attachments/assets/bb4107d9-8ce0-4400-8fda-d6c386f401e6
[img-manager-icons-plain]: https://github.com/user-attachments/assets/ec418df4-5d28-4fea-8945-e82a40727922
[img-manager-page]: https://github.com/user-attachments/assets/fabff194-14e6-4c84-a4e4-de54d9ada145
