<div align="center">
  <img src="showcase/logo.png" alt="" width="640">
</div>

# moonlight-claude-mods

Add-ons for Claude Code that add panels, buttons and safety checks around the prompt. They need Claude Code 2.1.287 or newer.

**Every terminal mod in 79 seconds**

https://github.com/user-attachments/assets/b0697288-a592-4995-b676-9b6eb7d267a1

## What each mod does

| Mod | What it does | How to open it |
| --- | --- | --- |
| `mod-menu` | One row of pills above the prompt that opens every panel | Always shown |
| `mod-manager` | Turns mods on and off and edits their settings | The gear pill, or `/mod-manager` |
| `mod-skill-panel` | Lists your skills and agents; a click adds one to the prompt | Skills pill |
| `mod-prompts` | Every prompt of the session; jump back to any of them | Prompts pill |
| `mod-file-tree` | The files Claude read and changed, with a replay of each edit | Files pill |
| `mod-transcript` | Chat bubbles for you and Claude, each finished turn folded to one line you can open, Bash commands in shell colors | Automatic |
| `mod-model-effort` | Shows the model and effort level; a click changes either | The model pill |
| `mod-heads-up` | Now and then flags one thing you should know but might miss, kept by turn in a panel | Automatic, or the Heads up pill |
| `mod-progress` | The main session and every subagent: model, effort, context fill, tokens, time and gate progress | Progress pill |
| `mod-next-steps` | Suggests up to three next prompts after each turn | Automatic |
| `mod-wrap-up` | Hands off to a fresh session, or fills `/compact` with what to keep | Wrap up pill |
| `mod-blast-radius` | Holds a risky shell command until you choose Cancel or Run | Automatic |
| `mod-collision-guard` | Asks before editing a file another session just changed | Automatic |
| `mod-desktop-status-line` | A status line for the desktop app | Desktop app only |

Where each one draws on the screen:

```mermaid
---
config:
  theme: base
  themeVariables:
    darkMode: true
    background: "#0D0E17"
    mainBkg: "#141726"
    primaryColor: "#141726"
    primaryTextColor: "#EEEEFA"
    primaryBorderColor: "#7386d0"
    secondaryColor: "#252A42"
    secondaryTextColor: "#EEEEFA"
    secondaryBorderColor: "#8A9BE0"
    tertiaryColor: "#7386D0"
    tertiaryTextColor: "#EEEEFA"
    tertiaryBorderColor: "#A2B0EA"
    lineColor: "#7386d0"
    textColor: "#EEEEFA"
    titleColor: "#EEEEFA"
    nodeBorder: "#7386d0"
    nodeTextColor: "#EEEEFA"
    clusterBkg: "#1C2033"
    clusterBorder: "#252A42"
    edgeLabelBackground: "#141726"
    arrowheadColor: "#7386d0"
    border1: "#7386d0"
    border2: "#7E86A4"
    activationBorderColor: "#ffcb6b"
    errorBkgColor: "#7386D0"
    errorTextColor: "#EEEEFA"
    fontFamily: "Mulish, system-ui, sans-serif"
    fontSize: "14px"
---
block-beta
  columns 4
  block:main:3
    columns 3
    transcript["Transcript"]:3
    transcriptmod["mod-transcript"]:3
    band["Above the prompt"]:3
    headsup["mod-heads-up"]:3
    nextsteps["mod-next-steps"] blast["mod-blast-radius"] wrapup["mod-wrap-up"]
    menu["mod-menu"] effort["mod-model-effort"] toasts["messages, every mod"]
    prompt["Prompt, Claude Code's own"]:3
  end
  block:side:1
    columns 1
    sidebar["Sidebar"]
    skills["mod-skill-panel"]
    prompts["mod-prompts"]
    files["mod-file-tree"]
    progress["mod-progress"]
    manager["mod-manager"]
    details["mod-blast-radius"]
    headsuppanel["mod-heads-up"]
  end
  classDef region fill:#252A42,stroke:#252A42,color:#EEEEFA
  classDef ghost fill:transparent,stroke:#7E86A4,stroke-dasharray:4 4,color:#7E86A4
  class transcript,band,sidebar region
  class prompt ghost
```

## See them

<!-- showcase:start -->

### mod-menu

One row of pills opens every panel. Hover one to see what it does.

| The pill row |
| --- |
| ![][img-menu-band] |

**Hovering an entry shows its tip**

https://github.com/user-attachments/assets/fc5ca63c-9206-4c17-acab-cd92b64e3ce3

### mod-manager

Hover a mod to read about it, and switch every mod's icons at once.

| Auto (Nerd Font) | Plain |
| --- | --- |
| ![][img-manager-icons-auto] | ![][img-manager-icons-plain] |

**Hover a mod, switch the icons**

https://github.com/user-attachments/assets/d93b77a8-7a43-4b82-ac00-1ffc6e6b8da3

### mod-file-tree

The files Claude touches, colored by what happened to them.

| The Files panel |
| --- |
| ![][img-file-tree-panel] |

**Live while Claude works**

https://github.com/user-attachments/assets/8652a526-e409-4fac-a0fc-bf8da47239d9

### mod-next-steps

Up to three next prompts. Click one, or type its number, to fill the prompt.

| Three suggestions |
| --- |
| ![][img-next-steps] |

**Picking one by its digit**

https://github.com/user-attachments/assets/be54d640-f179-4e19-8cad-1ecef74d8feb

### mod-prompts

Every prompt of the session; pick one to read it again.

**Pick a prompt to read it**

https://github.com/user-attachments/assets/b1ba4293-9ecc-484b-9e0a-d0d5607bd37b

### mod-skill-panel

Your skills grouped by color, and the panel's settings.

| Panel | Settings |
| --- | --- |
| ![][img-skill-panel] | ![][img-skill-panel-settings] |

**Skills, then the settings**

https://github.com/user-attachments/assets/90eb8704-5dc3-4695-8a08-96a7bebbc9d0

### mod-transcript

Each finished turn folds to one line; open it to see every step, or copy a reply from its bottom edge.

| Folded | Open | Copy a reply |
| --- | --- | --- |
| ![][img-transcript-folded] | ![][img-transcript-open] | ![][img-transcript-copy] |

**Unfolding a turn**

https://github.com/user-attachments/assets/63e0a726-851b-453b-9895-e6f6f2d42c0d

### mod-model-effort

The model and its effort level, one click to change.

| The model panel |
| --- |
| ![][img-model-effort-panel] |

**Effort on hover, models on click**

https://github.com/user-attachments/assets/6677931a-ca6a-4334-aa5f-b839f8a803d7

### mod-heads-up

Now and then, one thing you should know; every note stays in its panel.

| Card | Note |
| --- | --- |
| ![][img-heads-up-card] | ![][img-heads-up-note] |

**The panel and a note opened**

https://github.com/user-attachments/assets/a79162ea-11b7-438f-8909-014bd804070f

### mod-progress

Every agent at a glance: model, effort, context, tokens, time and gates.

| The pill | The panel |
| --- | --- |
| ![][img-progress-pill] | ![][img-progress-panel] |

**Two agents running, opened from the pill**

https://github.com/user-attachments/assets/473e8e21-cd0c-4971-8cef-448d2b092cf0

### mod-blast-radius

A risky command waits for your answer. Type 1, 2 or 3 into the empty prompt, or click.

| The hold card | The Details pane |
| --- | --- |
| ![][img-blast-radius-card] | ![][img-blast-radius-details] |

**A risky command held**

https://github.com/user-attachments/assets/a3484d78-eacf-4901-a981-e91bf8e6c5a8

### mod-collision-guard

Another session just edited this file, so Claude asks first.

| Asking before an edit |
| --- |
| ![][img-collision-guard] |

### mod-wrap-up

Pick what carries over, then hand off or compact. Played at double speed.

| Pick what stays | The filled /compact |
| --- | --- |
| ![][img-wrap-up-card] | ![][img-wrap-up-compact] |

**Compact, start to end**

https://github.com/user-attachments/assets/d998cb3a-d2cc-4e6e-ae70-30c4f8dfcd60

<!-- showcase:end -->

## Use them

| Goal | How |
| --- | --- |
| Install from GitHub | `claude plugin marketplace add v-amorim/moonlight-claude-mods`, then `claude plugin install <name>@claude-mods` |
| Try one mod in one session | `claude --plugin-dir <clone>/<name>` |
| Load them every session | Add each folder to `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, separated by `;` on Windows and `:` elsewhere |
| Apply changes in an open session | `/reload-plugins` |
| Turn one off, or change its settings | The gear pill, or `/mod-<name> settings` |
| Pass a slash command from Git Bash | `MSYS_NO_PATHCONV=1 claude "/mod-<name> settings"`, since Git Bash rewrites `/x` into a Windows path |

> [!WARNING]
> Mods are not sandboxed: they run with your permissions.

## Build your own

<details>
<summary>Make a new mod</summary>

1. Clone the repo, then copy an existing mod's folder to `<clone>/<name>` and rename it in `plugin.json` and its test.
2. Check it with `claude plugin validate <clone>/<name>`.
3. Test it with `claude plugin test <clone>/<name>`.
4. Try it with `claude --plugin-dir <clone>/<name>`, then add its folder to `CLAUDE_CODE_PLUGIN_DIRS`.

Each mod's folder:

```
<mod-name>/
  .claude-plugin/plugin.json     manifest
  hooks/hooks.json               { "modules": ["./register.tsx"] }
  hooks/register.tsx             the hooks module
  tests/*.test.tsx               run by claude plugin test
  showcase.json                  optional: tagline, features, actions, example cards
```

</details>

<details>
<summary>The shared standard</summary>

Every mod follows the same rules:

| Rule | In short |
| --- | --- |
| Name | Plugin, folder and command share one name, `mod-<name>` |
| Shared files | Each mod carries its own copy of the shared files, so it works alone |
| Panes | Tabs, a one-line hint, then bordered sections |
| Controls | Every control is a pill; mouse only, so the prompt keeps the keyboard |
| Icons | Plain symbols everywhere, Nerd Font icons when the terminal has one |

One panel shows at a time, and no mod needs to know the others:

```mermaid
---
config:
  theme: base
  sequence:
    mirrorActors: false
  themeVariables:
    darkMode: true
    background: "#0D0E17"
    mainBkg: "#141726"
    primaryColor: "#141726"
    primaryTextColor: "#EEEEFA"
    primaryBorderColor: "#7386d0"
    secondaryColor: "#252A42"
    secondaryTextColor: "#EEEEFA"
    secondaryBorderColor: "#8A9BE0"
    tertiaryColor: "#7386D0"
    tertiaryTextColor: "#EEEEFA"
    tertiaryBorderColor: "#A2B0EA"
    lineColor: "#7386d0"
    textColor: "#EEEEFA"
    titleColor: "#EEEEFA"
    actorBkg: "#141726"
    actorBorder: "#7386d0"
    actorTextColor: "#EEEEFA"
    actorLineColor: "#7386d0"
    signalColor: "#7386d0"
    signalTextColor: "#EEEEFA"
    labelBoxBkgColor: "#252A42"
    labelBoxBorderColor: "#7386d0"
    labelTextColor: "#EEEEFA"
    loopTextColor: "#EEEEFA"
    noteBkgColor: "#7386D0"
    noteTextColor: "#EEEEFA"
    noteBorderColor: "#7386d0"
    activationBkgColor: "#252A42"
    activationBorderColor: "#ffcb6b"
    arrowheadColor: "#7386d0"
    errorBkgColor: "#7386D0"
    errorTextColor: "#EEEEFA"
    fontFamily: "Mulish, system-ui, sans-serif"
    fontSize: "14px"
    sequenceNumberColor: "#0D0E17"
---
sequenceDiagram
  actor you as You
  participant files as mod-file-tree
  participant cc as Claude Code
  participant skills as mod-skill-panel
  you->>files: click Files
  files->>cc: open the Files pane
  cc->>skills: a pane opened
  skills->>cc: close the Skills pane
```

</details>

<!-- showcase-links:start -->
[img-blast-radius-card]: showcase/blast-radius-card.png
[img-blast-radius-details]: showcase/blast-radius-details.png
[img-collision-guard]: showcase/collision-guard.png
[img-file-tree-panel]: showcase/file-tree-panel.png
[img-heads-up-card]: showcase/heads-up-card.png
[img-heads-up-note]: showcase/heads-up-note.png
[img-manager-icons-auto]: showcase/manager-icons-auto.png
[img-manager-icons-plain]: showcase/manager-icons-plain.png
[img-menu-band]: showcase/menu-band.png
[img-model-effort-panel]: showcase/model-effort-panel.png
[img-next-steps]: showcase/next-steps.png
[img-progress-panel]: showcase/progress-panel.png
[img-progress-pill]: showcase/progress-pill.png
[img-skill-panel-settings]: showcase/skill-panel-settings.png
[img-skill-panel]: showcase/skill-panel.png
[img-transcript-copy]: showcase/transcript-copy.png
[img-transcript-folded]: showcase/transcript-folded.png
[img-transcript-open]: showcase/transcript-open.png
[img-wrap-up-card]: showcase/wrap-up-card.png
[img-wrap-up-compact]: showcase/wrap-up-compact.png
<!-- showcase-links:end -->

