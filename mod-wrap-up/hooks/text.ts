// mod-wrap-up / hooks/text.ts, by v-amorim
// Every string this mod shows. Edit the values to reword or translate; keep the keys and the {slots}.
export default {
  "label": "Wrap up",
  "paneName": "mod-wrap-up",
  "paneSettings": "Settings",
  "commandDescription": "Pick what carries over, then hand off to a fresh session; `compact` fills a /compact instead, `settings` opens its settings panel",
  "settingsWaiting": "Wrap up settings waiting: {reason}",
  "statusHint": "Click a setting to change it",
  "statusHintSaved": "The mod reloads",
  "settingSaved": "{label} saved",
  "tips": {
    "head": "offers to hand off to a fresh session, or compact this one",
    "handoff": "opens the pick card to write a handoff",
    "compact": "opens the pick card to fill a /compact",
    "thread": "keeps or drops this thread",
    "also": "keeps or drops this item",
    "go": {
      "handoff": "writes the handoff and starts a fresh session",
      "compact": "fills /compact into your prompt"
    },
    "cancel": "closes this card, changes nothing",
    "tab": "shows this mod's settings"
  },
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
  },
  "tipToast": {"label":"Dismiss","text":"hides this message"}
}
