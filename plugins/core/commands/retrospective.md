---
description: Retrospective on a working session — what went well, what to improve, what to stop — with concrete follow-ups.
argument-hint: [session id | "current" | words to match a past session]
---

# retrospective

Run a retrospective on a working session using the **retrospective** skill.

Invoke the `retrospective` skill and follow it. It reads the session transcript,
distills it with `scripts/extract_transcript.py`, and delivers a three-bucket
retro (went well / could improve / stop doing) covering both the user and Claude,
ending in concrete, mechanism-tagged follow-ups — then offers to apply them.

## Which session

`$ARGUMENTS` selects the session to review:

- **empty** or `current` — the current session (the newest transcript for this
  working directory; this is the skill's default, so just run it).
- **a session id** (a UUID-like filename stem) — pass it through as
  `--session <id>`.
- **anything else** (a few words describing a past session) — run the extractor
  with `--list`, match `$ARGUMENTS` against the opening prompts, and use the
  transcript whose first prompt fits. If several plausibly match, show the
  candidates and ask which one.
