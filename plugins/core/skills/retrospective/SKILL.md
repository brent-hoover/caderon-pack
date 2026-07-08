---
name: retrospective
description: Analyze the current (or a past) working session end-to-end and deliver a retrospective — what went well, what could improve, and what to stop doing — covering both the user and Claude, with concrete follow-ups like CLAUDE.md edits, new skills, or hooks. Use whenever the user asks for a "retro", "retrospective", "post-mortem", "how did that session go", "what could we have done better", "review how we worked", "lessons learned", or wants feedback on the collaboration itself (not the code). Reads the raw session transcript so it sees the whole history even after compaction.
---

# Retrospective

The user wants an honest look back at how a working session went — the *process*, not
just the artifact. Your job is to reconstruct what actually happened, then hand back a
balanced, specific, actionable retrospective: what worked, what didn't, what to stop,
and concrete changes that would make the next session better.

The center of gravity is **the collaboration** — the interaction between the user and
Claude across the session. A good retrospective is specific ("you re-ran the same failing
test three times before checking the import" / "I asked three clarifying questions when
the CLAUDE.md already answered two"), balanced (both sides, both strengths and misses),
and actionable (every "could improve" points at a concrete next step). A retro that could
describe any session is a failed retro.

## Why read the transcript instead of just using context

You could analyze the conversation already in your context, but long sessions get
compacted or summarized — by the time someone wants a retro, the early history may be
gone from context. The raw transcript JSONL is the complete, ground-truth record: every
prompt, every tool call, every error, in order. Read it. It's also the only way to retro
a *different* session than the one you're in.

## Step 1 — Get the transcript digest

A raw transcript is far too large to reason over directly (tens of thousands of lines once
tool results are counted). The bundled script distills one down to the human's prompts,
Claude's visible replies, a compact tool-call trace, and any tool errors:

```bash
python3 "$SKILL_DIR"/scripts/extract_transcript.py
```

`$SKILL_DIR` is this skill's base directory (shown as "Base directory for this skill"
when the skill loads).

With no arguments it picks the **most recently modified transcript for the current working
directory** — which, when you run the retro from inside the session being reviewed, is that
session. It prints the chosen path to stderr so you can confirm.

Other modes:
- `--list` — show recent transcripts (session id + opening prompt) so the user can pick one
- `<path.jsonl>` — a specific transcript file
- `--session <id>` — select by session id (the filename stem)
- `--include-thinking` — also emit Claude's reasoning blocks (useful for judging *why*
  Claude did something, at the cost of a longer digest)

If the user says "retro the session where we did X" and it isn't the current one, run
`--list`, find the match by its opening prompt, and pass that path.

**Read the digest carefully before writing anything.** The digest header gives you turn
counts, the tool-usage histogram, and an error count — a quick shape of the session. The
timeline is the substance.

### Reading the digest accurately

- `🧑 User` = something the human actually typed. `🤖 Claude` = Claude's visible reply.
- `🔧 Tool(target)` = a tool call. The histogram in the header shows the mix — a wall of
  `Bash×40` with few `Read`s tells a different story than balanced exploration.
- `⚠️ tool error` = a tool call that failed. Clusters of these are prime retro material:
  what went wrong, and did Claude diagnose it or thrash?
- `📎 injected context` = a loaded skill body or slash-command expansion. This is Claude
  Code machinery, **not** the user speaking — don't read it as a user request, and don't
  count it against either party.

## Step 2 — Analyze into three buckets

Work through the session and sort your observations into the three sections below. For
each bucket, look at **both** the user and Claude — the point is a shared retro, not a
review of one side.

**What signals to look for:**

- *Went well* — clear prompts, good course-corrections, the right tool for the job,
  catching an error early, a clean verification, an efficient path to the goal.
- *Could improve* — thrashing (repeating a failing action without changing approach),
  missed context (re-asking what CLAUDE.md/memory already answered), skipped verification,
  premature claims of "done", scope creep, an underused or ignored skill that fit, a slow
  path where a faster one existed, ambiguous prompts that sent Claude the wrong way.
- *Stop doing* — patterns actively worth dropping: a habit that repeatedly cost time, a
  reflexive behavior that didn't pay off, an anti-pattern that showed up more than once.

Ground every observation in **specific evidence from the timeline** — quote the moment,
name the file/tool/turn. "Communication could be tighter" is useless; "turns 4–6 re-ran
`pytest` unchanged after the same ImportError — the fix was a missing `__init__.py`" is a
retro someone can act on.

Be honest and balanced. Don't manufacture findings to fill a section — if the session was
clean, say so briefly. Don't launder real problems into praise. And critique your own
(Claude's) behavior at least as hard as the user's; that's usually where the actionable
wins are.

### Turn "could improve" into concrete follow-ups

The most valuable part of a retro is what changes next time. Where a finding suggests a
durable fix, name the specific mechanism:

- **CLAUDE.md edit** — a recurring instruction the user had to give, or a preference Claude
  kept missing, belongs in CLAUDE.md. Propose the exact line(s) to add.
- **New skill** — a multi-step workflow that showed up and would recur is a skill candidate.
  Name it and say what it'd do.
- **Memory** — a durable fact about the user, project, or a confirmed preference belongs in
  persistent memory. Say what to store.
- **Hook** — an automated behavior the user wants *every* time ("always run ruff after
  editing Python") can't live in memory; it needs a hook. Flag it as such.
- **Slash command / alias, config change, tool** — smaller ergonomic fixes count too.

Only suggest a follow-up when the evidence supports it. One well-justified "add this to
CLAUDE.md" beats five speculative ones.

## Output format

Present the retrospective in this structure:

```
## Session retrospective
<one line: what the session was about + rough shape — e.g. "~2h building the auth
refactor; mostly smooth, one debugging detour">

## ✅ What went well
- <specific, evidenced — who did what well>

## 🔧 What could improve
- <specific, evidenced> → <concrete follow-up if there is one>

## 🛑 What to stop doing
- <a pattern worth dropping, with the evidence for why>

## Suggested follow-ups
- <the actionable items, each tagged with its mechanism: CLAUDE.md / skill / memory / hook / …>
```

Notes:
- Attribute observations (user vs. Claude) where it's useful — but don't force it, and
  keep it collaborative in tone, not accusatory.
- If a bucket is genuinely empty, a single honest line beats padding.
- Match length to the session. A 20-minute session gets a tight retro; don't inflate it.
- Lead with substance — no "Here is your retrospective" preamble.

## Step 3 — Offer to apply the follow-ups

After presenting, offer to act on the actionable items — don't apply them silently. List
what you *could* do and let the user choose which, if any:

> Want me to apply any of these? I can add the CLAUDE.md lines, scaffold the `X` skill, or
> save the memory about `Y`.

When applying:
- **CLAUDE.md / dotfiles** — show the exact edit first. Respect how the user manages these
  (e.g. chezmoi-managed dotfiles are edited at their source, not the deployed copy) rather
  than assuming a plain file edit.
- **New skill** — use the skill-creator / writing-skills workflow rather than hand-rolling.
- **Memory** — follow the user's memory conventions (one fact per entry, index pointer).
- **Hook** — hooks are the only way to guarantee an automatic behavior every time; use the
  hook-development / update-config workflow. Confirm the trigger and action first.
- Never edit shared or version-controlled files as a side effect of a retro without saying
  so. The retro's job is to recommend; applying is a separate, opt-in step.
