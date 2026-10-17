<!-- mod-skill-panel / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
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
| https://github.com/user-attachments/assets/9dc338ca-887f-4cc3-881e-e3967c364d59 |

## Features

- **Skills and agents:** Lists your skills and agents, personal and the open project's: skills grouped by tag, agents by model. A click adds one to the prompt.
- **Color tags:** Give a skill a `color-tag: <tag>` line in its SKILL.md frontmatter to group it under that tag and badge it in the slash typeahead. The tags are router, start, debug, review, interface, writing, utility and mods; a skill without one, or with another name, lands under personal.

## Settings

Change them with `/mod-skill-panel settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-skill-panel-added]: https://github.com/user-attachments/assets/f23354f8-77f8-41ee-bbde-1d37c1582dd9
[img-skill-panel-settings]: https://github.com/user-attachments/assets/30559e4a-e9b7-4d27-ac4a-6d36dbf37c99
[img-skill-panel-slash]: https://github.com/user-attachments/assets/ac6c844b-8638-473e-807d-2f31b992b9c9
[img-skill-panel]: https://github.com/user-attachments/assets/c11fe973-679a-49a3-8457-0f0ddd3d1c52
