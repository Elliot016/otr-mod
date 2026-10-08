<!-- Written by showcase/tools/play.py readme from the root README, plugin.json, showcase.json and the scene; edit those. -->
# mod-prompts

Every prompt of the session; jump back to any of them.

**How to open:** Prompts pill

**Pick a prompt to read it**

https://github.com/user-attachments/assets/6fcaf366-bf6a-4a54-8856-6e80b529f11f

## Settings

Change them with `/mod-prompts settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font, read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole, and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |

## Install

```sh
claude plugin install mod-prompts@claude-mods --scope user
```
