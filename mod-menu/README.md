<!-- mod-menu / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
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
| https://github.com/user-attachments/assets/3c7094dd-d77f-4651-b6c0-22cfdc623bc2 |

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

[img-menu-band]: https://github.com/user-attachments/assets/a5ca950a-04aa-4c98-9461-57574c8f77ec
[img-menu-icons]: https://github.com/user-attachments/assets/e2daa60a-6319-497c-988b-13ddf80d32a0
