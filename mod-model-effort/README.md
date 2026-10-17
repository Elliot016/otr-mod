<!-- mod-model-effort / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
# mod-model-effort

Part of [moonlight-claude-mods][doc-root].

Shows the model and effort level; a click changes either.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-model-effort@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

The model pill.

## See it

| The model panel |
| --- |
| ![][img-model-effort-panel] |

| Effort on hover, models on click |
| --- |
| https://github.com/user-attachments/assets/a4402cb0-b9dc-4a38-b0ca-d19bc988bf75 |

## Settings

Change them with `/mod-model-effort settings` or the gear pill.

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

[img-model-effort-panel]: https://github.com/user-attachments/assets/553da178-9c80-4304-88a5-edaee43700a8
