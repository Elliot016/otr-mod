<!-- mod-file-tree / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
# mod-file-tree

Part of [moonlight-claude-mods][doc-root].

The files Claude read and changed, with a replay of each edit.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-file-tree@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Files pill.

## See it

| The Files panel | The fold toggle |
| --- | --- |
| ![][img-file-tree-panel] | ![][img-file-tree-folded] |

| Live while Claude works |
| --- |
| https://github.com/user-attachments/assets/92fb4b27-e977-4ea1-a553-32bc9e695040 |

## Features

- **File tree:** Only the files Claude read, edited, wrote or created this session, in folders you can fold, with +/- line counts for edits.
- **Live marker:** The file Claude is on lights up and says what it is doing: reading, editing, writing or creating.
- **Replay:** Prev and Next step through the last turn's edits, one diff at a time. Click a file in the tree to open its latest diff.
- **Command hooks:** On SessionStart, a small shell hook appends the event's JSON as one line to `~/.claude/mods-data/mod-file-tree/bridge/<session id>.jsonl` (under `$CLAUDE_CONFIG_DIR` when that is set), and the mod reads the file every 250 ms. A record can hold the session id, the working folder and the transcript path. SessionEnd deletes the session's file, and SessionStart deletes files older than 7 days. The hooks need a POSIX shell (Git Bash on Windows). Without one they write nothing, and the mod falls back to what it can find on its own. Some plans block plugin hooks on these events; the mod then falls back the same way.

## Settings

Change them with `/mod-file-tree settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |
| Show files Claude only read | on | Read files join the changed ones. Off, it lists only changed files |
| Wrap long diff lines | on | Replay lines wrap onto the next row. Off, they are cut at the pane edge |
| Recent view (turns) | `5` | How many latest turns to cover. The middle view shows them, from 2 to 20 |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-file-tree-folded]: https://github.com/user-attachments/assets/5c744ca8-4dc1-476c-9405-2cd6d3a618a6
[img-file-tree-panel]: https://github.com/user-attachments/assets/6955de1f-4221-4e34-b8f9-205b32caa154
