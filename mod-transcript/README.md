<!-- mod-transcript / README.md, by v-amorim -->
<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-transcript

Part of [moonlight-claude-mods][doc-root].

Chat bubbles for you and Claude, each finished turn folded to one line you can open, Bash commands in shell colors.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-transcript@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Automatic.

## See it

| Folded | Open | Copy a reply |
| --- | --- | --- |
| ![][img-transcript-folded] | ![][img-transcript-open] | ![][img-transcript-copy] |

| The colors a reply names |
| --- |
| ![][img-transcript-colors] |

| Unfolding a turn |
| --- |
| https://github.com/user-attachments/assets/54d5f0e0-e018-4304-ae72-0b43830b88df |

## Features

- **Turn line:** Under each prompt, a line names what the turn did: tool count, file changes with lines added and removed, skills, agents and time.
- **Tool lines:** Inside an open turn, each finished tool call is one line; a click shows its full row and diff.
- **Card:** An open turn draws as one tinted card with a bar down its left edge; the final reply stays outside it.
- **Copy button:** Under each finished reply, a button copies it as markdown, its code, plain text, its tables rebuilt as clean markdown, or its links. Pointing at a choice marks the characters it takes.

## Settings

Change them with `/mod-transcript settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Fold finished turns | on | Turns start folded to one line. The line sits under its prompt. Off, they start open and the line folds them |
| Fold tool rows | on | Each tool row folds to one line. Finished rows have their own toggle. Off, tool rows draw as Claude Code draws them |
| Show times | on | Prompt send time, tool duration. Each prompt shows when you sent it, and each tool line when it started and how long it took. Off, rows show no times |
| Show the latest turn in full | on | Stays open until your next prompt. The latest turn shows every tool row and result as Claude Code draws them. Off, finished tool calls fold right away |
| Copy button | on | On each finished reply's edge. A copy button sits there: point at it to pick reply, code, text, table or links, then click one. The reply marks what the choice under the pointer copies. Off, the edge stays plain |
| Prompt numbers | on | #N before each of your prompts. It matches the number the Prompts and Heads up panels show |
| Animations | on | The fold chip and the kind chips fade when the pointer leaves them, a running command's dot blinks, and the tabs and settings fade. Off, they switch at once and the dot stays lit |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-transcript-colors]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/transcript-colors.png
[img-transcript-copy]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/transcript-copy.png
[img-transcript-folded]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/transcript-folded.png
[img-transcript-open]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/transcript-open.png
