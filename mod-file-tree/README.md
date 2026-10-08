<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-file-tree

The files Claude read and changed, with a replay of each edit.

**How to open:** Files pill

| The Files panel |
| --- |
| ![][img-file-tree-panel] |

**Live while Claude works**

https://github.com/user-attachments/assets/676f590d-6596-469f-9cba-baa8e23745eb

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
| Turns in the recent view | `5` | How many latest turns to cover. The middle view of the tree shows them, from 2 to 20 |

## Install

```sh
claude plugin install mod-file-tree@claude-mods --scope user
```

[img-file-tree-panel]: ../showcase/file-tree-panel.png
