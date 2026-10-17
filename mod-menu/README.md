<!-- mod-menu / README.md, by v-amorim -->
<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-menu

Part of [moonlight-claude-mods][doc-root].

The switch that hides or shows the pill row above the prompt, plus its hover tips; each panel mod draws its own pill.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-menu@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

`/mod-menu`.

## See it

| The pill row | Icons alone, with labels set to never |
| --- | --- |
| ![][img-menu-band] | ![][img-menu-icons] |

| Hovering an entry shows its tip |
| --- |
| https://github.com/user-attachments/assets/2e6b876d-4b02-4930-8eef-05ec66a85bc7 |

## Settings

Change them in the plugin's settings.

| Setting | Default | What it does |
| --- | --- | --- |
| Menu labels | `auto` | When pills show their names. auto draws icon and name, and drops every pill to its icon when the row is wider than the window. always keeps the names. never shows icons alone. Icons alone need Nerd Font icons, since safe mode has none. /mod-menu labels auto\|always\|never sets it too |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-menu-band]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/menu-band.png
[img-menu-icons]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/menu-icons.png
