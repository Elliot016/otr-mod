// Every string this mod shows, see mod-builder/references/standard.md. Edit the values to reword or translate; keep the keys and the {slots}.
export default {
  "label": "Wrap up",
  "paneName": "mod-wrap-up",
  "paneSettings": "Settings",
  "commandDescription": "Pick what carries over, then hand off to a fresh session; `compact` fills a /compact instead, `settings` opens its settings panel",
  "settingsWaiting": "Wrap up settings waiting: {reason}",
  "statusHint": "Click a control to change it",
  "statusHintSaved": "Saved at once, the mod reloads",
  "settingSaved": "{label} saved",
  "tip": "Wrap up: hand off to a fresh session, or compact this one",
  "writingStage": "Writing handoff…",
  "choice": {
    "handoff": "Handoff",
    "compact": "Compact"
  },
  "card": {
    "title": "pick what stays",
    "hint": "click a line to keep or drop it",
    "threads": "Threads",
    "also": "Also keep",
    "reading": "Reading the session…",
    "noThreads": "No threads found, the whole session counts",
    "handoffFoot": "Writes a handoff of what stays, clears the chat and fills it into the prompt",
    "go": {
      "handoff": "Hand off",
      "compact": "Fill prompt"
    },
    "cancel": "Cancel"
  },
  "alsoKeep": {
    "files": "Files in play",
    "decisions": "Decisions",
    "tasks": "Open tasks",
    "errors": "Errors seen"
  },
  "cardOpened": "Pick what carries over above the prompt",
  "filledIn": "Handoff filled in, review it and press Enter",
  "compactFilled": "/compact filled in, review it and press Enter",
  "compactNotFilled": "Could not fill the prompt with /compact",
  "claudeWorking": "Claude is working, try again once it is idle",
  "claudeWorkingPill": "Claude is working, Wrap up is available once it is idle",
  "writing": "Writing the handoff",
  "startedWorking": "Claude started working, nothing was cleared",
  "clearFailed": "Could not run /clear, press Enter to clear and the handoff fills in after",
  "clearedNotFilled": "Cleared, but the handoff could not be filled in",
  "forkFailures": {
    "nothingToFork": "Nothing to hand off yet, send a message first",
    "apiError": "The summary request failed",
    "emptyReply": "The model returned no handoff",
    "aborted": "The summary was interrupted"
  }
}
