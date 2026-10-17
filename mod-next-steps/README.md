<!-- mod-next-steps / README.md, by v-amorim -->
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
| https://github.com/user-attachments/assets/a7ac7b78-b812-4c20-9e30-3bc8dba54b8b |

## Features

- **Suggestions:** After a finished turn, up to three one-line next prompts appear above the input, muted until the pointer is over one.
- **Click to fill:** A click puts the suggestion in the input for you to edit; nothing is sent.
- **Stays out of the way:** They clear when you send a prompt or a new turn starts, and a failed or interrupted turn shows nothing.

## Costs

By default this mod makes no model call. Turn on Suggest next steps (`/mod-next-steps settings`) and it calls a model, which spends tokens and counts against your plan quota.

After each finished turn of the main agent (not an interrupted one, not a subagent's), it forks your session to ask for the suggestions. The fork runs on your session's model and reuses the cached conversation, so a long session still makes a sizable request every turn.

With Suggest next steps off, the default, no request is made.

## Settings

Change them with `/mod-next-steps settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Suggest next steps | off | Lists next prompts after a turn. The model writes them after each finished turn. Off, no request is made |
| Suggestions | `3` | How many suggestions to show, 1 to 3 |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-next-steps]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/next-steps.png
