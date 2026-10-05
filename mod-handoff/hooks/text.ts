// Every string this mod shows, see mod-builder/references/standard.md. Edit the values to reword or translate; keep the keys and the {slots}.
export default {
  "label": "Handoff",
  "paneName": "mod-handoff",
  "paneSettings": "Settings",
  "commandDescription": "Summarize the session, clear it, and fill the handoff into the new prompt; `settings` opens its settings panel",
  "settingsWaiting": "Handoff settings waiting: {reason}",
  "statusHint": "Click a control to change it",
  "statusHintSaved": "Saved at once, the mod reloads",
  "settingSaved": "{label} saved",
  "tip": "Handoff: summarize, clear the chat and continue fresh",
  "stage": {
    "reading": "Reading the session…",
    "picking": "Pick what carries over…",
    "writing": "Writing handoff…"
  },
  "confirmAsk": "Clear & continue?",
  "confirmYes": "Yes",
  "confirmNo": "No",
  "pickQuestion": "Which threads carry over to the new session?",
  "pickHeader": "Handoff",
  "filledIn": "Handoff filled in, review it and press Enter",
  "claudeWorking": "Claude is working, try again once it is idle",
  "claudeWorkingPill": "Claude is working, Handoff is available once it is idle",
  "cancelled": "Handoff cancelled, nothing was cleared",
  "writing": "Writing the handoff",
  "writingThenClearing": "Writing the handoff, then clearing",
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
