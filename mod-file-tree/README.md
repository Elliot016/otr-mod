<!-- mod-file-tree / README.md, by v-amorim -->
<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
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

| The Files panel | Fold all |
| --- | --- |
| ![][img-file-tree-panel] | ![][img-file-tree-folded] |

| Live while Claude works |
| --- |
| https://github.com/user-attachments/assets/da738c8d-4dda-4ed3-a6a3-fb6d2e8fe72e |

## Features

- **File tree:** Only the files Claude read, edited, wrote or created this session, in folders you can fold, with +/- line counts for edits.
- **Live marker:** While Claude works, the file it is on right now is lit and says what it is doing: reading, editing, writing, creating.
- **Replay:** Steps through the edits of the last turn one diff at a time with Prev and Next; a click on a file in the tree opens its latest diff.

## Settings

Change them with `/mod-file-tree settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Show files Claude only read | on | Read files join the changed ones. Off, it lists only changed files |
| Wrap long diff lines | on | Replay lines wrap onto the next row. Off, they are cut at the pane edge |
| Recent view (turns) | `5` | How many latest turns to cover. The middle view of the tree shows them, from 2 to 20 |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-file-tree-folded]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/file-tree-folded.png
[img-file-tree-panel]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/file-tree-panel.png
