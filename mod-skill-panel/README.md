<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-skill-panel

Lists your skills and agents; a click adds one to the prompt.

**How to open:** Skills pill

| Skills, then the settings | Panel | Settings |
| --- | --- | --- |
| [![][gif-skill-panel-and-settings]][video-skill-panel-and-settings] | ![][img-skill-panel] | ![][img-skill-panel-settings] |

## Settings

Change them with `/mod-skill-panel settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait and hover colors fade. Off, everything draws still |

## Install

```sh
claude plugin install mod-skill-panel@claude-mods --scope user
```

[gif-skill-panel-and-settings]: ../showcase/gif/skill-panel-and-settings.gif

[img-skill-panel-settings]: ../showcase/skill-panel-settings.png
[img-skill-panel]: ../showcase/skill-panel.png

[video-skill-panel-and-settings]: ../showcase/skill-panel-and-settings.mp4
