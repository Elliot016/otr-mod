---
name: session-handoff
description: Write a concise continuation message so the user can /clear and keep working. Use when the user asks for a session handoff, a wrap-up, or wants to clear without losing the thread.
---

# session-handoff

Write one message that the next session reads first, with no other context. The reader is a fresh model, not a stakeholder.

## Hard cap

At most 400 words in total. A run may state a lower or higher cap; that number replaces this one. Cut detail before you cut a section. Never exceed the cap.

## Rules

1. Reply with the message only. No preface, no closing remark, no code fence around it. Do not call tools and do not write files.
2. Synthesize from this conversation. Do not search the filesystem or run git. Report only what happened here.
3. Use absolute paths. Relative paths break in the next session.
4. Never invent state. A section with nothing to say reads `none`.
5. Name background processes by id, with the command that stops them.
6. Terse tone. No retrospective, no praise, no advice beyond the next step.

## Template

Continuing from a previous session. Read this, then act on "Next step".

**Goal:** one or two sentences on what the user is trying to achieve.

**Decisions:** bullets of choices already made and why, so the next session does not reopen them.

**Current state:** what works, what is broken, what is half done.

**Files touched:** absolute path, then a few words on the change.

**Run state:** absolute paths of any plan, progress, ledger or checklist file this session works from, plus any id needed to resume it. When the run names this session's ledger file, list it first. `none` when there is no such file.

**Open tasks:** bullets, in priority order.

**Next step:** the single action to take first.
