<!-- mod-wrap-up / README.md, by v-amorim -->
<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-wrap-up

Part of [moonlight-claude-mods][doc-root].

Hands off to a fresh session, or fills `/compact` with what to keep.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-wrap-up@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Wrap up pill.

## See it

| Pick what stays | The filled /compact |
| --- | --- |
| ![][img-wrap-up-card] | ![][img-wrap-up-compact] |

| Compact, start to end |
| --- |
| https://github.com/user-attachments/assets/0b9c9abd-03e8-4f36-9069-ae02042a809d |

## Features

- **Pick what stays:** A click on Wrap up offers Handoff or Compact. Either opens a card with the session's threads, read by Haiku, and fixed items such as files in play and open tasks; a click keeps or drops each line. The Auto switch beside them turns the auto handoff on or off, and its tip says what is set now.
- **Compact:** The card writes the /compact instructions as you click and Fill prompt puts them in the prompt. You review them and press Enter.
- **Handoff:** Summarizes what stays through a hidden fork with the session-handoff skill, runs /clear, and fills the handoff into the fresh prompt.
- **Automatic handoff:** After each turn Sonnet keeps a ledger of decisions and tasks, plus a fresh handoff, in the background. /compact is given the handoff and the next prompt carries it. With Auto handoff at the mark on, a card counts down 5 seconds between turns at 400K tokens or 65% of the window, whichever comes first; Cancel, a typed draft or a new turn stops it. At zero the ledger is brought up to date and the chat is cleared. If the ledger has an open task, Claude continues it from the handoff; otherwise the handoff is filled into the prompt and nothing is sent. After /clear, a related first prompt carries it and an unrelated one starts a new ledger; a card offers a switch. Each session keeps its own ledger, so sessions in one folder never mix.

## Settings

Change them with `/mod-wrap-up settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Handoff length (words) | `400` | Most words the handoff may use. A hard cap on the message the model writes |
| Read the threads | on | Haiku finds up to four threads. You keep or drop each one when the card opens. Off, the card shows only the fixed items and the whole session counts |
| Automatic handoff | on | After a turn, Sonnet keeps a ledger of decisions and tasks and a fresh handoff in the background. /compact is given the handoff, and the next prompt after a compaction or a related /clear carries it. Off, only the Wrap up pill hands off |
| Update every (turns) | `1` | Turns between automatic handoff updates, at least 1 |
| Auto handoff at the mark | off | Once either mark below is reached, a 5 second countdown card appears between turns; unless you cancel, type a draft or start a turn, the ledger is brought up to date, the chat is cleared and Claude continues the open task from the handoff (with no open task, the handoff is filled into the prompt instead). Replaces the old auto compact. Meant for sessions with Claude Code's own auto-compact off. Needs Automatic handoff on |
| Hand off at (%) | `65` | Context percent at which the auto handoff counts down between turns. Guards small windows; the token mark comes first on large ones |
| Hand off at (tokens) | `400000` | Context tokens at which the auto handoff counts down between turns, whichever of the two marks comes first |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: ../README.md#icons-and-nerd-fonts
[doc-install]: ../README.md#install
[doc-license]: ../LICENSE
[doc-root]: ../README.md

[img-wrap-up-card]: ../showcase/wrap-up-card.png
[img-wrap-up-compact]: ../showcase/wrap-up-compact.png
