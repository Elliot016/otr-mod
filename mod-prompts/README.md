<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-prompts

Every prompt of the session; jump back to any of them.

**How to open:** Prompts pill

| Pick a prompt to read it |
| --- |
| [![][gif-prompts-pick]][video-prompts-pick] |

## Settings

Change them with `/mod-prompts settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait and hover colors fade. Off, everything draws still |

## Install

```sh
claude plugin install mod-prompts@claude-mods --scope user
```

[gif-prompts-pick]: ../showcase/gif/prompts-pick.gif

[video-prompts-pick]: ../showcase/prompts-pick.mp4
