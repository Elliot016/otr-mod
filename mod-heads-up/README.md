<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-heads-up

Now and then flags one thing you should know but might miss, kept by turn in a panel.

**How to open:** Automatic, or the Heads up pill

| The panel and a note opened | Card | Note |
| --- | --- | --- |
| [![][gif-heads-up-panel]][video-heads-up-panel] | ![][img-heads-up-card] | ![][img-heads-up-note] |

## Features

- **A side check:** Every sixth step of a long turn, at most once per turn, a check reads the session and flags one thing you should understand and probably missed. Most checks show nothing.
- **A card above the prompt:** The note shows with its tag, You should know or Heads up, and says who decided. Open shows it in the panel, × dismisses it.
- **The Heads up panel:** Every note of the session under its turn, opened in place, with Got it, Ask Claude and Reword (simpler words, less detail or more detail). Hover any control for what it does.

## Settings

Change them with `/mod-heads-up settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Check while Claude works | on | The side check flags one thing. Every sixth step of a turn, at most once per turn, it reads the session for something worth knowing. Off, no request is made |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |

## Install

```sh
claude plugin install mod-heads-up@claude-mods --scope user
```

[gif-heads-up-panel]: ../showcase/gif/heads-up-panel.gif

[img-heads-up-card]: ../showcase/heads-up-card.png
[img-heads-up-note]: ../showcase/heads-up-note.png

[video-heads-up-panel]: ../showcase/heads-up-panel.mp4
