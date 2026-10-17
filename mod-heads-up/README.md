<!-- mod-heads-up / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
# mod-heads-up

Part of [moonlight-claude-mods][doc-root].

Now and then flags one thing you should know but might miss, kept by turn in a panel.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-heads-up@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Automatic, or the Heads up pill.

## See it

| Card | Note |
| --- | --- |
| ![][img-heads-up-card] | ![][img-heads-up-note] |

| The panel and a note opened |
| --- |
| https://github.com/user-attachments/assets/b653d9d1-0811-4c33-8778-b5328cdd09ad |

## Features

- **A side check:** Every sixth step of a long turn, at most once per turn, a check reads the session and flags one thing you should understand and probably missed. Most checks show nothing.
- **A card above the prompt:** The note shows with its tag, You should know or Heads up, and says who decided. Open shows it in the panel, × dismisses it.
- **The Heads up panel:** Every note of the session under its turn, opened in place, with Got it, Ask Claude and Reword (simpler words, less detail or more detail). Hover any control for what it does.

## Costs

By default this mod makes no model call. Turn on Check while Claude works (`/mod-heads-up settings`) and it calls a model, which spends tokens and counts against your plan quota.

- **The side check:** on every sixth step of the main agent, at most once per turn and never while a note card is showing, the mod asks a model to read the session. It forks your session when its effort is low or medium, which reuses the cached conversation. At a higher effort, or with nothing to fork yet, it sends the whole conversation to your session's model at medium effort. If a newer step may have overtaken the finding, it asks once more before showing it.
- **Reword:** each click on simpler words, less detail or more detail makes one more call.
- **Off by default:** with Check while Claude works off, the side check makes no request. Reword only runs when you click it.

## Settings

Change them with `/mod-heads-up settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Check while Claude works | off | Every sixth step of a turn, at most once per turn, a side check reads the session for one thing worth flagging. Off, it makes no request |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-heads-up-card]: https://github.com/user-attachments/assets/c0d4cca6-7640-4446-a2ad-8bb71bb133ec
[img-heads-up-note]: https://github.com/user-attachments/assets/e39e05c7-4cf7-4064-9593-697591c9d51f
