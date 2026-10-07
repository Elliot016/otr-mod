<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-transcript

Chat bubbles for you and Claude, each finished turn folded to one line you can open, Bash commands in shell colors.

**How to open:** Automatic

| Unfolding a turn | Folded | Open |
| --- | --- | --- |
| [![][gif-transcript-unfold]][video-transcript-unfold] | ![][img-transcript-folded] | ![][img-transcript-open] |

| Copy a reply |
| --- |
| ![][img-transcript-copy] |

## Features

- **Turn line:** Under each prompt, a line names what the turn did: tool count, file changes with lines added and removed, skills, agents and time.
- **Tool lines:** Inside an open turn, each finished tool call is one line; a click shows its full row and diff.
- **Card:** An open turn draws as one tinted card with a bar down its left edge; the final reply stays outside it.
- **Copy button:** Under each finished reply, a button copies it as markdown, its code, plain text, its tables rebuilt as clean markdown, or its links.

## Settings

Change them with `/mod-transcript settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Fold finished turns | on | Each finished turn starts folded to one summary line under its prompt. Off, turns start open and the line folds them |
| Fold tool rows | on | Each finished tool row is one line with its own toggle. Off, tool rows draw as Claude Code draws them |
| Show times | on | Each prompt shows when you sent it, and each tool line when it started and how long it took. Off, rows show no times |
| Show the latest turn in full | on | The latest turn shows every tool row and result as Claude Code draws them, and folds when your next prompt starts. Off, finished tool calls fold right away |
| Prompt numbers | on | Shows each prompt's number (#N) beside your message, matching the Prompts and Heads up panels |
| Copy button | on | Each finished reply's bottom edge carries a copy button: point at it to pick reply, code, text, table or links, then click one. Off, the edge stays plain |
| Icons | `auto` | auto uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |

## Install

```sh
claude plugin install mod-transcript@claude-mods --scope user
```

[gif-transcript-unfold]: ../showcase/gif/transcript-unfold.gif

[img-transcript-copy]: ../showcase/transcript-copy.png
[img-transcript-folded]: ../showcase/transcript-folded.png
[img-transcript-open]: ../showcase/transcript-open.png

[video-transcript-unfold]: ../showcase/transcript-unfold.mp4
