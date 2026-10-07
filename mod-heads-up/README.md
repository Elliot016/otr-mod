<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-heads-up

Now and then flags one thing you should know but might miss, kept by turn in a panel.

**How to open:** Automatic, or the Heads up pill

| The panel and a note opened | Card | Note |
| --- | --- | --- |
| [![][gif-heads-up-panel]][video-heads-up-panel] | ![][img-heads-up-card] | ![][img-heads-up-note] |

## Features

- **A side check:** Every sixth step of a long turn, at most once per turn, a check reads the session and flags one thing you should understand and probably missed. Most checks show nothing.
- **A card above the prompt:** The note shows with its tag, You should know or Heads up, and says who decided. Learn more opens it in the panel; Know this already keeps it from coming back.
- **The Heads up panel:** Every note of the session under its turn, opened in place, with Chat in main session and rewrites in simpler words, with less detail or with more detail.

## Settings

Change them with `/mod-heads-up settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Check while Claude works | on | Every sixth step of a turn, at most once per turn, a side check reads the session and flags one thing worth knowing. Off, no request is made |
| Animations | on | Entries shimmer while they wait and hover colors fade. Off, everything draws still |
| Icons | `auto` | auto uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |

## Install

```sh
claude plugin install mod-heads-up@claude-mods --scope user
```

[gif-heads-up-panel]: ../showcase/gif/heads-up-panel.gif

[img-heads-up-card]: ../showcase/heads-up-card.png
[img-heads-up-note]: ../showcase/heads-up-note.png

[video-heads-up-panel]: ../showcase/heads-up-panel.mp4
