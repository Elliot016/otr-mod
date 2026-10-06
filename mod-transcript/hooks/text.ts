// Every string this mod shows, see mod-builder/references/standard.md. Edit the values to reword or translate; keep the keys and the {slots}.
export default {
  "commandDescription": "Fold or unfold every finished turn; `settings` opens its settings panel, `debug` writes the drawn row ids to %TEMP%",
  "panePlacedTitle": "mod-transcript",
  "paneWaiting": "Settings panel waiting: {reason}",
  "paneHeading": "Toggle",
  "paneSubheading": "Settings",
  "paneHintClick": "Click a setting to change it",
  "paneHintSaved": "The mod reloads",
  "noteSettingSaved": "{label} saved",
  "noteCommandRan": "ran /{command}",
  "noteFolded": "Folded every finished turn",
  "noteUnfolded": "Unfolded every finished turn",
  "toolCountOne": "{n} tool",
  "toolCountMany": "{n} tools",
  "durationSeconds": "{s}s",
  "durationMinutes": "{m}m {s}s",
  "durationHours": "{h}h {m}m",
  "turnTook": "took {time}",
  "thought": "Thought",
  "kindChip": {
    "read": "Read",
    "search": "Searched",
    "edit": "Edited",
    "shell": "Ran",
    "web": "Fetched",
    "agent": "Agents",
    "tool": "Other"
  },
  "thoughtNoText": "Claude Code kept no text for this thought",
  "previewMore": "+ {n} more lines",
  "previewEmpty": "No output",
  "kind": {
    "read": { "one": "Read {n} file", "many": "Read {n} files" },
    "search": { "one": "Searched {n} pattern", "many": "Searched {n} patterns" },
    "edit": { "one": "Edited {n} file", "many": "Edited {n} files" },
    "shell": { "one": "Ran {n} shell command", "many": "Ran {n} shell commands" },
    "web": { "one": "Fetched {n} page", "many": "Fetched {n} pages" },
    "agent": { "one": "Ran {n} agent", "many": "Ran {n} agents" },
    "tool": { "one": "Used {n} other tool", "many": "Used {n} other tools" }
  }
}
