<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-progress

The main session and every subagent: model, effort, context fill, tokens, time and gate progress.

**How to open:** Progress pill

| Two agents running, opened from the pill | The pill | The panel |
| --- | --- | --- |
| [![][gif-progress-pane]][video-progress-pane] | ![][img-progress-pill] | ![][img-progress-panel] |

## Settings

Change them with `/mod-progress settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait and hover colors fade. Off, everything draws still |

## Install

```sh
claude plugin install mod-progress@claude-mods --scope user
```

[gif-progress-pane]: ../showcase/gif/progress-pane.gif

[img-progress-panel]: ../showcase/progress-panel.png
[img-progress-pill]: ../showcase/progress-pill.png

[video-progress-pane]: ../showcase/progress-pane.mp4
