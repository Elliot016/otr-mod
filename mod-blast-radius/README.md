<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-blast-radius

Holds a risky shell command until you choose Cancel or Run.

**How to open:** Automatic

| A risky command held | The hold card | The Details pane |
| --- | --- | --- |
| [![][gif-blast-radius-hold]][video-blast-radius-hold] | ![][img-blast-radius-card] | ![][img-blast-radius-details] |

## Features

- **Hold:** A risky Bash command waits before it runs, with no timeout: every check of your block-destructive hook (rm, git reset --hard, force push, SQL DROP, production deploys, gcloud, az, databricks, chmod 777, curl into a shell, credential reads) plus mv over a file, > over a file and Windows deletes.
- **Your rules:** ~/.claude/mods-data/mod-blast-radius/rules.json, an array of { "pattern": "regex", "reason": "text", "flags": "i" }. Read again when the file changes. A bad entry is skipped with a note in the settings pane; the built-in checks never depend on it.
- **One prompt:** After you press Run, the settings hook's own Destructive operation ask is answered, so you are not asked twice. Any other ask or deny passes through.
- **No drawing surface:** In a VS Code chat panel, claude -p or an SDK session nothing can show the hold, so the call is not held: the permission system asks instead, with the reason.
- **Preview:** Paths with counts and size, git status and dry runs, the commits a force push would drop. Read-only: the command itself never runs.
- **Run or Cancel:** Cancel refuses the call with a reason Claude reads. A narrow terminal draws the same report above the prompt.

## Settings

Change them with `/mod-blast-radius settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait and hover colors fade. Off, everything draws still |
| Hold risky commands | on | On, a risky Bash command waits for your Run or Cancel. Off, every command runs as usual |
| Icons | `auto` | auto uses Nerd Font icons when Windows Terminal runs a Nerd Font, and safe Unicode glyphs elsewhere. nerd and safe force one |

## Install

```sh
claude plugin install mod-blast-radius@claude-mods --scope user
```

[gif-blast-radius-hold]: ../showcase/gif/blast-radius-hold.gif

[img-blast-radius-card]: ../showcase/blast-radius-card.png
[img-blast-radius-details]: ../showcase/blast-radius-details.png

[video-blast-radius-hold]: ../showcase/blast-radius-hold.mp4
