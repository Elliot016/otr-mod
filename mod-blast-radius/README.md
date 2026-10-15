<!-- mod-blast-radius / README.md, by v-amorim -->
<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-blast-radius

Part of [moonlight-claude-mods][doc-root].

Holds a risky shell command until you choose Cancel or Run.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-blast-radius@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Automatic.

## See it

| The hold card | The Details pane |
| --- | --- |
| ![][img-blast-radius-card] | ![][img-blast-radius-details] |

| A risky command held |
| --- |
| https://github.com/user-attachments/assets/a3dfb603-3060-465a-ab15-ec0aaecf6728 |

## Features

- **Hold:** A risky Bash command waits before it runs, with no timeout: rm, git reset --hard, force push, SQL DROP, production deploys, gcloud, az, databricks, chmod 777, curl into a shell, credential reads, mv over a file, > over a file and Windows deletes.
- **Your rules:** ~/.claude/mods-data/mod-blast-radius/rules.json, an array of { "pattern": "regex", "reason": "text", "flags": "i" }. Read again when the file changes. A bad entry is skipped with a note in the settings pane; the built-in checks never depend on it.
- **One prompt:** After you press Run, a settings hook's ask with a reason starting "Destructive operation detected" is answered too, so you are not asked twice. Any other ask or deny passes through.
- **No drawing surface:** In a VS Code chat panel, claude -p or an SDK session nothing can show the hold, so the call is not held: the permission system asks instead, with the reason.
- **Preview:** Paths with counts and size, git status and dry runs, the commits a force push would drop. Read-only: the command itself never runs.
- **Run or Cancel:** Cancel refuses the call with a reason Claude reads. A narrow terminal draws the same report above the prompt.

## Costs

This mod calls a model, which spends tokens and counts against your plan quota.

Each held command is sent to Haiku for a plain-language explanation, so the command text leaves your machine like any prompt. Set Explain with Haiku to off (`/mod-blast-radius settings`) and the card keeps only the rule's reason and the preview, with no request.

## Settings

Change them with `/mod-blast-radius settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Hold risky commands | on | Risky Bash waits for your choice. You pick Run or Cancel. Off, every command runs as usual |
| Explain with Haiku | on | Each held command is sent to Haiku for a plain-language explanation on the card. It spends tokens. Off, no model is called and the card shows the rule's reason and the preview |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: ../README.md#icons-and-nerd-fonts
[doc-install]: ../README.md#install
[doc-license]: ../LICENSE
[doc-root]: ../README.md

[img-blast-radius-card]: ../showcase/blast-radius-card.png
[img-blast-radius-details]: ../showcase/blast-radius-details.png
