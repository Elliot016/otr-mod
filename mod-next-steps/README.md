<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-next-steps

Part of [moonlight-claude-mods][doc-root].

Suggests up to three next prompts after each turn.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-next-steps@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Automatic.

## See it

| Three suggestions |
| --- |
| ![][img-next-steps] |

| Picking one by its digit |
| --- |
| https://github.com/user-attachments/assets/00b218a3-db7b-45b4-a0a9-0b195198a207 |

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
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |

[doc-icons]: ../README.md#icons-and-nerd-fonts
[doc-install]: ../README.md#install
[doc-root]: ../README.md

[img-next-steps]: ../showcase/next-steps.png
