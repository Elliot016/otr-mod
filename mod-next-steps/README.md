<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-next-steps

Suggests up to three next prompts after each turn.

**How to open:** Automatic

| Three suggestions |
| --- |
| ![][img-next-steps] |

**Picking one by its digit**

https://github.com/user-attachments/assets/be54d640-f179-4e19-8cad-1ecef74d8feb

## Features

- **Suggestions:** After a finished turn, up to three one-line next prompts appear above the input, muted until the pointer is over one.
- **Click to fill:** A click puts the suggestion in the input for you to edit; nothing is sent.
- **Stays out of the way:** They clear when you send a prompt or a new turn starts, and a failed or interrupted turn shows nothing.

## Settings

Change them with `/mod-next-steps settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Suggest next steps | on | Lists next prompts after a turn. After each finished turn, the model writes a few and lists them above the input. Off, no request is made |
| Suggestions | `3` | How many suggestions to show, 1 to 3 |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |

## Install

```sh
claude plugin install mod-next-steps@claude-mods --scope user
```

[img-next-steps]: ../showcase/next-steps.png
