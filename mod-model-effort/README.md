<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-model-effort

Shows the model and effort level; a click changes either.

**How to open:** The model pill

| Effort on hover, models on click | The model panel |
| --- | --- |
| [![][gif-model-effort-pick]][video-model-effort-pick] | ![][img-model-effort-panel] |

## Settings

Change them with `/mod-model-effort settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |

## Install

```sh
claude plugin install mod-model-effort@claude-mods --scope user
```

[gif-model-effort-pick]: ../showcase/gif/model-effort-pick.gif

[img-model-effort-panel]: ../showcase/model-effort-panel.png

[video-model-effort-pick]: ../showcase/model-effort-pick.mp4
