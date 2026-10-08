<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-wrap-up

Hands off to a fresh session, or fills `/compact` with what to keep.

**How to open:** Wrap up pill

| Compact, start to end | Pick what stays | The filled /compact |
| --- | --- | --- |
| [![][gif-wrap-up-full]][video-wrap-up-full] | ![][img-wrap-up-card] | ![][img-wrap-up-compact] |

## Features

- **Pick what stays:** A click on Wrap up offers Handoff or Compact. Either opens a card with the session's threads, read by Haiku, and fixed items such as files in play and open tasks; a click keeps or drops each line.
- **Compact:** The card writes the /compact instructions as you click and Fill prompt puts them in the prompt. You review them and press Enter.
- **Handoff:** Summarizes what stays through a hidden fork with the session-handoff skill, runs /clear, and fills the handoff into the fresh prompt.

## Settings

Change them with `/mod-wrap-up settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Handoff length | `400` | Most words the handoff may use. A hard cap on the message the model writes |
| Read the threads | on | Haiku finds up to four threads. You keep or drop each one when the card opens. Off, the card shows only the fixed items and the whole session counts |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |

## Install

```sh
claude plugin install mod-wrap-up@claude-mods --scope user
```

[gif-wrap-up-full]: ../showcase/gif/wrap-up-full.gif

[img-wrap-up-card]: ../showcase/wrap-up-card.png
[img-wrap-up-compact]: ../showcase/wrap-up-compact.png

[video-wrap-up-full]: ../showcase/wrap-up-full.mp4
