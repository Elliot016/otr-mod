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
| https://github.com/user-attachments/assets/7bb01973-e907-4807-b571-829e65d71659 |

## Settings

Change them with `/mod-menu settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Menu labels | `always` | always draws each menu entry with its icon and its name. never draws the icon alone, which fits more entries in a narrow window; it applies on Nerd Font icons only, since safe mode has no icon. /mod-menu labels always\|never sets it too |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: ../README.md#icons-and-nerd-fonts
[doc-install]: ../README.md#install
[doc-license]: ../LICENSE
[doc-root]: ../README.md

[img-menu-band]: ../showcase/menu-band.png
[img-menu-icons]: ../showcase/menu-icons.png
