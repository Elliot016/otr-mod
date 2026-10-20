<!-- mod-transcript / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
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
| https://github.com/user-attachments/assets/4acef8c7-d1a0-48c1-bd01-d2a38c73cfb2 |

## Features

- **Turn line:** Under each prompt, a line names what the turn did: tool count, file changes with lines added and removed, skills, agents and time.
- **Tool lines:** Inside an open turn, each finished tool call is one line; a click shows its full row and diff.
- **Call previews:** A tool call's preview shows its first lines. Show all opens the rest, and a line that was cut wraps in full. Show less folds it back.
- **Card:** An open turn draws as one tinted card with a bar down its left edge; the final reply stays outside it.
- **Copy button:** A button under each finished reply copies it as markdown, its code, plain text, its tables rebuilt as clean markdown, or its links. Pointing at a choice marks the characters it takes.
- **Command hooks:** On SessionStart, PermissionDenied and StopFailure, a small shell hook appends the event's JSON as one line to `~/.claude/mods-data/mod-transcript/bridge/<session id>.jsonl` (under `$CLAUDE_CONFIG_DIR` when that is set), and the mod reads the file every 250 ms. A record can hold the session id, the working folder and the transcript path, and for Stop-type events the last assistant message. SessionEnd deletes the session's file, and SessionStart deletes files older than 7 days. The hooks need a POSIX shell (Git Bash on Windows). Without one they write nothing, and the mod falls back to what it can find on its own. Some plans block plugin hooks on these events; the mod then falls back the same way.

## Settings

Change them with `/mod-transcript settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Fold finished turns | on | Turns start folded to one line. The line sits under its prompt. Off, they start open and the line folds them |
| Fold tool rows | on | Each tool row folds to one line. Finished rows have their own toggle. Off, tool rows draw as Claude Code draws them |
| Show times | on | Prompt send time, tool duration. Each prompt shows when you sent it, each tool line when it started and how long it took. Off, rows show no times |
| Show the latest turn in full | on | Stays open until your next prompt, with every tool row and result as Claude Code draws them. Off, finished tool calls fold right away |
| Copy button | on | On each finished reply's edge. Point at the copy button to pick reply, code, text, table or links, then click. The reply marks what the choice under the pointer copies. Off, the edge stays plain |
| Prompt numbers | on | #N before each of your prompts. It matches the number the Prompts and Heads up panels show |
| Animations | on | Fold and kind chips fade when the pointer leaves, a running command's dot blinks, and the tabs and settings fade. Off, they switch at once and the dot stays lit |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-transcript-colors]: https://github.com/user-attachments/assets/437b0f97-663b-4eab-96f2-063ad41ca9d2
[img-transcript-copy]: https://github.com/user-attachments/assets/d8f1e5f6-7e4c-4f2d-84c4-947f4f03f988
[img-transcript-folded]: https://github.com/user-attachments/assets/4f52eacd-e5fa-4144-b94e-2331b2da16f9
[img-transcript-open]: https://github.com/user-attachments/assets/36a258c6-6e80-432b-8009-b7146c7ba32d
