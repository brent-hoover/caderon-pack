---
name: catch-me-up
description: Reconstruct and summarize the state of the current working session — what's been done, what's left, and where things stand right now. Use whenever the user asks to be "caught up", says "catch me up", "where were we", "what have we done so far", "remind me where we are", "status", "recap", "summarize what we've been doing", or comes back after a break and needs to reorient. Also use proactively when a session has run long and the user seems to have lost the thread. Anchors on THIS session's work, drawing on git state, feature docs, and memory to fill in detail.
---

# Catch Me Up

The user wants to reorient — usually after a long working session, a break, or a
context switch. Your job is to reconstruct where things stand and hand it back in a
form they can absorb in ten seconds and act on immediately.

The center of gravity is **this session**: the thread of work you and the user have
been pulling on in this conversation. The other sources (git, feature docs, memory)
exist to sharpen that picture — to confirm what actually landed on disk, to name the
larger task the session sits inside — not to summarize the whole project. If the
user wanted a project-wide status they'd ask for that; here they want "where were
*we*, just now."

## Gather the picture first

Before writing anything, spend a moment reconstructing state from what's available.
Don't narrate this gathering — just do it, then write the summary. Pull from these,
in rough priority order:

1. **The conversation itself.** This is your primary source and the spine of the
   summary. Reread the session: what did the user ask for, what did you attempt,
   what worked, what got corrected, what's half-finished. The most recent exchanges
   matter most — that's where "right now" lives.

2. **Git state.** Run `git status` and `git diff --stat` to see what's actually
   changed on disk, and `git log --oneline -5` for recent commits. This grounds the
   summary in reality: a change discussed but not yet written should land in
   "Remaining," not "Done." Uncommitted work is a strong signal of where you left off.

3. **Feature docs.** If the work sits inside a `feature-work/<feature>/` area (or a
   plan the session referenced), skim the relevant `plan.md` / `design.md`. Checked
   and unchecked items there tell you what the larger task considers done vs. pending
   — useful for the "Remaining" section, but filter to what's actually in scope for
   this session's thread.

4. **Memory.** If recent decisions or session-state notes are already surfaced in
   context (mem0, auto-memory), use them to fill gaps — especially for work that
   spanned earlier in a long session. Don't go hunting if nothing's readily present.

Weight recency and disk reality. When the conversation and git disagree — you
*said* you'd do something but the diff doesn't show it — trust the diff and flag it
as not-yet-done.

## Output format

Always use these three sections, in this order:

```
## Done
- <concrete thing that's finished — verified, committed, or observably working>

## Remaining
- <concrete thing still to do, in the order it'll likely happen>

## Where we are now
<1–3 sentences: the current focus, what's mid-flight, and the immediate next step>
```

Notes on each:

- **Done** — only things that are actually finished. "Wrote the function and tests
  pass" belongs here; "started refactoring X" does not (that's a Where-we-are item).
  If you can point to a commit or a passing check, say so briefly.
- **Remaining** — the open work, ordered so the top item is the natural next thing to
  pick up. Keep it to what's genuinely in play for this session's task, not every
  hypothetical follow-up.
- **Where we are now** — prose, not bullets. This is the sentence the user actually
  came for: what's on the workbench this second and what the very next action is.

## Style

- Lead with substance. No preamble like "Here's a summary of our session." Just open
  with `## Done`.
- Be specific and concrete — name the files, functions, commits, decisions. "Fixed
  the auth bug" is weak; "Fixed the JWT expiry check in `auth.py:verify_token`" is
  useful. A summary that could describe any session is a failed summary.
- Keep it scannable. Short bullets, no walls of text. The whole thing should be
  absorbable at a glance.
- Match the length to the work. A short session gets a short recap; don't pad three
  sections to look thorough when one line each is the honest picture.
- Report state faithfully. If something was attempted and failed, it's "Remaining"
  (or a caveat in "Where we are now"), not "Done." Don't launder half-done work into
  the Done column — the user is about to act on this, and a wrong picture costs them.

## When there's genuinely little to summarize

If the session has barely started or nothing substantive has happened yet, say so in
a sentence rather than manufacturing three sections. "We just started — you asked X
and I'm about to Y. Nothing done or pending yet." Honesty beats a padded template.
