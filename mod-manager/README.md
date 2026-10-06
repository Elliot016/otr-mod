<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-manager

Turns mods on and off and edits their settings.

**How to open:** The gear pill, or `/mod-manager`

| Hover a mod, switch the icons | Auto (Nerd Font) | Plain |
| --- | --- | --- |
| [![][gif-manager-hover-and-icons]][video-manager-hover-and-icons] | ![][img-manager-icons-auto] | ![][img-manager-icons-plain] |

## Settings

Change them with `/mod-manager settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait and hover colors fade. Off, everything draws still |
| Icons | `auto` | auto uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |

## Install

```sh
claude plugin install mod-manager@claude-mods --scope user
```

[gif-manager-hover-and-icons]: ../showcase/gif/manager-hover-and-icons.gif

[img-manager-icons-auto]: ../showcase/manager-icons-auto.png
[img-manager-icons-plain]: ../showcase/manager-icons-plain.png

[video-manager-hover-and-icons]: ../showcase/manager-hover-and-icons.mp4
