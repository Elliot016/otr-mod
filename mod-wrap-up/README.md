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

| Pick what stays | The filled /compact | The countdown |
| --- | --- | --- |
| ![][img-wrap-up-card] | ![][img-wrap-up-compact] | ![][img-wrap-up-countdown] |

| Carried over |
| --- |
| ![][img-wrap-up-carried] |

| Compact, start to end |
| --- |
| https://github.com/user-attachments/assets/79c3e6bd-84f0-4d55-b8a0-edc8b969f62f |

| Auto handoff at the mark: countdown, clear, carry on |
| --- |
| https://github.com/user-attachments/assets/ab60369a-5192-4192-84a7-77be42c21fe5 |

## Features

- **Pick what stays:** A click on Wrap up offers Handoff or Compact. Either opens a card with the session's threads, read by Haiku, and fixed items such as files in play and open tasks; a click keeps or drops each line. The Auto switch beside them turns the auto handoff on or off, and its tip says what is set now.
- **Compact:** The card writes the /compact instructions as you click and Fill prompt puts them in the prompt. You review them and press Enter.
- **Handoff:** Summarizes what stays through a hidden fork with the session-handoff skill, runs /clear, and fills the handoff into the fresh prompt.
- **Automatic handoff:** After each turn Sonnet keeps a ledger of decisions and tasks, plus a fresh handoff, in the background. /compact is given the handoff and the next prompt carries it. With Auto handoff at the mark on, a card counts down 5 seconds between turns at 400K tokens or 65% of the window, whichever comes first; Cancel, a typed draft or a new turn stops it. At zero the ledger is brought up to date and the chat is cleared. If the ledger has an open task, Claude continues it from the handoff; otherwise the handoff is filled into the prompt and nothing is sent. After /clear, a related first prompt carries it and an unrelated one starts a new ledger; a card offers a switch. Each session keeps its own ledger, so sessions in one folder never mix.

## Costs

This mod calls a model in four places, which spends tokens and counts against your plan quota.

| When | Model | Turn it off |
| --- | --- | --- |
| After each turn (or every few turns, set by Update every (turns)), the automatic handoff updates the ledger and handoff from the turns since the last update, up to 150,000 characters | Sonnet at low effort | Automatic handoff off |
| The first prompt after a /clear that is not a slash command, a "related?" check against the ledger | Sonnet at low effort, a reply of at most 100 tokens | Automatic handoff off |
| Opening the Wrap up card splits the session into threads | Haiku | Read the threads off |
| Handoff in the card writes the summary | Your session's model through a fork; Sonnet when there is nothing to fork yet | Does not run unless you click it |

With Auto handoff at the mark on, the countdown first runs one more ledger update if turns are waiting. Set Automatic handoff to off and only the Wrap up pill hands off. Change settings with `/mod-wrap-up settings`.

The ledger holds the handoff text. It is one JSON file per session chain, written under `~/.claude/mods-data/mod-wrap-up/<project>/ledgers/`. When `CLAUDE_CONFIG_DIR` is set, the folder is `$CLAUDE_CONFIG_DIR/mods-data/mod-wrap-up/` instead. The mod never prunes these files, so delete old ones by hand.

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
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-wrap-up-card]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/wrap-up-card.png
[img-wrap-up-carried]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/wrap-up-carried.png
[img-wrap-up-compact]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/wrap-up-compact.png
[img-wrap-up-countdown]: https://raw.githubusercontent.com/v-amorim/moonlight-claude-mods/main/showcase/wrap-up-countdown.png
