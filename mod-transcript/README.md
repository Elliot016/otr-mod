<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-transcript

Chat bubbles for you and Claude, each finished turn folded to one line you can open, Bash commands in shell colors.

**How to open:** Automatic

| Folded | Open | Copy a reply |
| --- | --- | --- |
| ![][img-transcript-folded] | ![][img-transcript-open] | ![][img-transcript-copy] |

**Unfolding a turn**

https://github.com/user-attachments/assets/63e0a726-851b-453b-9895-e6f6f2d42c0d

## Features

- **Turn line:** Under each prompt, a line names what the turn did: tool count, file changes with lines added and removed, skills, agents and time.
- **Tool lines:** Inside an open turn, each finished tool call is one line; a click shows its full row and diff.
- **Card:** An open turn draws as one tinted card with a bar down its left edge; the final reply stays outside it.
- **Copy button:** Under each finished reply, a button copies it as markdown, its code, plain text, its tables rebuilt as clean markdown, or its links.

## Settings

Change them with `/mod-transcript settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Fold finished turns | on | Turns start folded to one line. The line sits under its prompt. Off, they start open and the line folds them |
| Fold tool rows | on | Each tool row folds to one line. Finished rows have their own toggle. Off, tool rows draw as Claude Code draws them |
| Show times | on | Prompt send time, tool duration. Each prompt shows when you sent it, and each tool line when it started and how long it took. Off, rows show no times |
| Show the latest turn in full | on | Stays open until your next prompt. The latest turn shows every tool row and result as Claude Code draws them. Off, finished tool calls fold right away |
| Copy button | on | On each finished reply's edge. A copy button sits there: point at it to pick reply, code, text, table or links, then click one. Off, the edge stays plain |
| Prompt numbers | on | #N before each of your prompts. It matches the number the Prompts and Heads up panels show |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |

## Install

```sh
claude plugin install mod-transcript@claude-mods --scope user
```

[img-transcript-copy]: ../showcase/transcript-copy.png
[img-transcript-folded]: ../showcase/transcript-folded.png
[img-transcript-open]: ../showcase/transcript-open.png
