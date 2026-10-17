<!-- mod-progress / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
# mod-progress

Part of [moonlight-claude-mods][doc-root].

The main session, every subagent and every agent of a workflow run: model, effort, context fill, tokens, time and gate progress, plus the background shells and monitors each one started, with their live output.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-progress@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Progress pill.

## See it

| The pill | The panel | A shell's command and output |
| --- | --- | --- |
| ![][img-progress-pill] | ![][img-progress-panel] | ![][img-progress-shell] |

| An agent's transcript |
| --- |
| ![][img-progress-transcript] |

| Two agents running, opened from the pill |
| --- |
| https://github.com/user-attachments/assets/8fea424e-bb34-4132-8d4b-f72c64602f85 |

## Features

- **The gates view:** A card per loop with its gates ticked off, and a band count of every gate in the session. Gates come from `GATES.md` files written by your own skill or script, not from the model. The rest of the mod works without them.
- **GATES.md format:** The ledger is `GATES.md` plus every `gates/<name>.md` in `~/.claude/gates/<repo>/<session id>/` (or under `GATES_HOME`). A gate is a line `- [ ] G1: what must hold`, with an indented `EVIDENCE:` line under it. It counts as met only when its box is `[x]` and its evidence is not `pending`. A line starting `ABANDON: G1 reason` gives that gate up. A `gates/<name>.md` file also belongs to the agent of that name.

## Settings

Change them with `/mod-progress settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-progress-panel]: https://github.com/user-attachments/assets/811ac06b-c3cc-4c39-bd17-168503adef0b
[img-progress-pill]: https://github.com/user-attachments/assets/42ddc20e-3b34-430d-a82a-3ffca022da67
[img-progress-shell]: https://github.com/user-attachments/assets/376a0f70-d9ec-468c-97aa-ce3cea0ebf86
[img-progress-transcript]: https://github.com/user-attachments/assets/48072a82-e9f0-487c-8df5-6e8ae12b4612
