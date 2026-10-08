<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-file-tree

The files Claude read and changed, with a replay of each edit.

**How to open:** Files pill

| The Files panel |
| --- |
| ![][img-file-tree-panel] |

**Live while Claude works**

https://github.com/user-attachments/assets/8652a526-e409-4fac-a0fc-bf8da47239d9

## Features

- **File tree:** Only the files Claude read, edited, wrote or created this session, in folders you can fold, with +/- line counts for edits.
- **Live marker:** While Claude works, the file it is on right now is lit and says what it is doing: reading, editing, writing, creating.
- **Replay:** Steps through the edits of the last turn one diff at a time with Prev and Next; a click on a file in the tree opens its latest diff.

## Settings

Change them with `/mod-file-tree settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Show files Claude only read | on | Read files join the changed ones. Off, it lists only changed files |
| Wrap long diff lines | on | Replay lines wrap onto the next row. Off, they are cut at the pane edge |
| Turns in the recent view | `5` | How many latest turns to cover. The middle view of the tree shows them, from 2 to 20 |

## Install

```sh
claude plugin install mod-file-tree@claude-mods --scope user
```

[img-file-tree-panel]: ../showcase/file-tree-panel.png
