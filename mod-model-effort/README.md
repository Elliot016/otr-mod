<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-model-effort

Shows the model and effort level; a click changes either.

**How to open:** The model pill

| Effort pill and its settings |
| --- |
| ![][img-model-effort] |

## Settings

Change them with `/mod-model-effort settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait and hover colors fade. Off, everything draws still |

## Install

```sh
claude plugin install mod-model-effort@claude-mods --scope user
```

[img-model-effort]: ../showcase/model-effort.png
