---
name: journal-this
description: Use when the Operator wants to capture the current session as a dated engineering/work journal entry written in their own voice — triggers include "/journal-this", "journal this", "summarize this session", "write a journal entry", "wrap this up as a journal entry", or winding-down cues like "good stopping point" / "let's call it here" at the end of substantive work. Also use on first run to configure the journal (name, voice source, destination). Saves the entry to a configured folder or GitHub repo.
---

# journal-this

## What this skill does

Turns the current conversation into a dated markdown journal entry — what got built, what broke, what got reshaped, what's deferred, and the cross-cutting lessons worth carrying forward — written in **the Operator's own voice** and saved to **the Operator's own journal** (a local folder or a GitHub repo).

It is a generalized version of a personal journaling workflow. Before it can write anything for a new Operator, it runs a one-time **setup interview** to learn three things: who the Operator is, where their existing writing lives (so it can match their voice), and where new entries should go. After setup, invoking it just produces and files the entry.

## When to use vs. not

**Use when:**
- The Operator explicitly asks to journal the session (`/journal-this`, "journal this", "summarize what we did", "write this up as a journal entry").
- The Operator names their journal as the destination.
- A substantial work session is winding down ("good stopping point", "let's call it here") — offer to journal it proactively; the entry is how context carries forward across machines and sessions.

**Don't use when:**
- The conversation just started and nothing substantive has happened — say so and skip rather than padding a thin session into a fake-substantial entry.
- The Operator wants a quick chat summary, not a durable journal record. Confirm intent if ambiguous.

## First run: the setup interview

**Trigger setup when** the config file (`~/.config/journal-this/config.json`) does not exist, OR the Operator says `/journal-this setup` (re-run / reconfigure).

Conduct the interview conversationally — ask, confirm, then write the config. Do not write entries during setup. The questions:

1. **Operator name / voice owner.** "Whose journal is this — what name should the entries be written as / attributed to?" (e.g. `Chris`). Stored as `operator_name`.

2. **Voice source (to learn their style).** "Where do your existing journal entries or writing samples live, so I can match your voice? Give me a **local folder path** (best — I read it directly), or a GitHub repo URL, or paste a sample. Optional — if you have none yet, I'll establish a clean default voice." Stored as `voice_source`.

   **Resolve to a local path when you can** — the voice-anchoring step reads files off disk, so a bare `https://github.com/...` URL can't be listed or read. When the Operator gives a URL: if it's the *same* repo as a GitHub destination they're about to configure, store the local clone path plus subfolder instead (e.g. `~/code/devlog/notes/`). If they have it cloned elsewhere, store that local path. Only if there is no local checkout at all, store the URL as-is and accept that the workflow will fall back to the default voice (it will say so). If a subfolder holds the entries (e.g. `notes/`), include it in the stored path. Store `null` if there are no samples.

3. **Destination type.** "Where should new entries be saved — a plain folder on disk, or committed to a GitHub repo?" Stored as `destination.type` = `"disk"` | `"github"`.

   - If **disk**: ask for the target directory (`destination.path`, e.g. `~/journal/`). That's all that's needed.
   - If **github**: ask for the **local clone path** of the repo (`destination.repo_path`), the **subdirectory** entries go in (`destination.subdir`, e.g. `journal`, default `""` for repo root), the **branch** (`destination.branch`, default `main`), and the **remote** (`destination.remote`, default `origin`). Confirm whether to **push directly** or open a PR (`destination.push_mode` = `"direct"` | `"pr"`, default `"direct"`). **Store `subdir` without a trailing slash** (`"notes"`, not `"notes/"`) so path-joining stays clean; an empty string means repo root.

4. **Filename pattern.** Default `YYYY-MM-DD-kebab-slug.md`. Accept the default unless the Operator wants something else. Stored as `filename_pattern`.

5. **Commit trailer (github only).** "Add a co-author trailer to commits? (default: a generic Claude trailer; or none, or your own.)" Stored as `commit_trailer` (string or `null`). For a **disk** destination this question is skipped and `commit_trailer` is `null` (there's no commit).

**Before writing the config, sanity-check the destination path.** For disk, confirm `destination.path`'s parent exists (offer to create the folder if it doesn't). For github, confirm `repo_path` exists and is a git repo (`git -C <repo_path> rev-parse --is-inside-work-tree`); if not, surface it now rather than letting the first journal attempt fail. This is a courtesy check at setup time — the workflow re-checks at write time too.

Paths are stored **as the Operator typed them** (a leading `~` is kept literal). Shell steps like `cd <repo_path>` expand `~` themselves; when a path is handed to a tool that does **not** expand `~`, expand it to `$HOME` first.

After collecting answers, write `~/.config/journal-this/config.json` (create the directory if needed), echo the resolved config back to the Operator in plain language, and tell them they're set up — next time they say "journal this", it just works. See `config.template.json` in this skill folder for the exact schema.

## Configuration schema

Read `~/.config/journal-this/config.json` at the start of every non-setup invocation. Shape:

```json
{
  "operator_name": "Chris",
  "voice_source": "~/Documents/GitHub/homelab-topology/journal/",
  "destination": {
    "type": "github",
    "repo_path": "~/Documents/GitHub/homelab-topology",
    "subdir": "journal",
    "branch": "main",
    "remote": "origin",
    "push_mode": "direct"
  },
  "filename_pattern": "YYYY-MM-DD-kebab-slug.md",
  "commit_trailer": "Co-Authored-By: Claude <noreply@anthropic.com>"
}
```

For a disk destination, `destination` carries `{ "type": "disk", "path": "~/journal/" }` and the git/commit fields are ignored.

## Workflow (after setup)

### 1. Load config and anchor on voice

Read the config. If `voice_source` is a **local path**, list its entries and read the 1–2 most recent (`ls <voice_source> | tail -2`, then read them). This is the single most important step for not sounding like generic LLM prose — match the Operator's sentence rhythm, vocabulary, structure, and how much they explain *why* vs. just *what*. If `voice_source` is `null`, **a remote URL with no local checkout** (you can't `ls` a URL — don't try), or a **local path that's missing or empty** (common on the very first entry when the journal points at its own still-empty folder), use the default style below and note in your report that you couldn't anchor on samples.

**Capture the structural skeleton, not just the prose.** While reading the samples, note the *mechanical* conventions the entries share, not only the voice: a **YAML frontmatter block** and exactly which keys it carries (e.g. `date`/`title`/`description`, and how values are quoted), any eyebrow/kicker line, the heading shape, and any standard footer. **Some of these are load-bearing** — a journal site often generates its index/sidebar/sort order from each entry's frontmatter, so an entry that omits it can fail to render or break the build. You can't know which conventions matter from the generic template; you learn them only by reading the real entries. Treat the skeleton you observe as a contract to replicate in step 3.

### 2. Identify the substantive work

Filter the conversation for what actually moved:
- Features/changes shipped, infrastructure wired, things deployed
- Decision pivots — places where the Operator overrode a default; these are load-bearing because they aren't visible in the artifacts otherwise
- Bugs caught, gaps closed, things that broke and how they were resolved
- Operator dialogue that crystallized a design decision (keep load-bearing quotes verbatim)

Filter out banter, clarifying round-trips that didn't change direction, and low-level tool mechanics. If nothing substantive happened, say so and ask whether to write a stub or skip.

### 3. Write the entry

Date = **today's date** (from the system context). If work crossed midnight, date it the day it's written, not when the work began. Slug = a 2–6 word kebab-case description of the dominant arc; name the actual thing that happened, never `session-summary` or `wrap-up`.

**If you read sample entries in step 1, replicate their skeleton exactly** — reproduce the frontmatter block with the same keys and quoting, any kicker/eyebrow line, the heading shape, and the footer. This is not optional polish: the frontmatter is frequently what the journal's tooling uses to index and sort entries, so a missing or malformed block can drop the entry from the index or break the site build. The generic structure below is only the **fallback for when there are no samples to copy**:

```markdown
# Title — what this session was about (YYYY-MM-DD)

[2–4 paragraph opener: the arc, the through-line.]

## 1. <First section>
[Concrete prose — file paths, commit hashes, decisions, error messages. Verbatim Operator quotes where load-bearing.]

## 2. <Second section>
[...]

## What's deferred
1. **<Item>** — what it is, why deferred, where it's tracked.

## Side findings
- **<Cross-cutting observation>.** What was noticed that didn't fit the main arc.

---

Stopped here. [One sentence: state of the work + what's next.]
```

Default style: substantial (depth over length, no filler), peer-to-peer voice, concrete refs over abstractions, explains *why* not just *what*. This is a personal record, not customer-facing copy — natural punctuation including em-dashes is fine unless the Operator's samples avoid them.

### 4. Save the entry

**Disk destination:** write the file into `destination.path`, confirm the absolute path back to the Operator. Done.

**GitHub destination:**

```bash
cd <repo_path>
git rev-parse --abbrev-ref HEAD          # sanity-check branch == destination.branch
# Path-join: "<subdir>/<file>" when subdir is set, else just "<file>" (subdir is stored without a trailing slash)
git add <subdir>/YYYY-MM-DD-<slug>.md    # e.g. journal/2026-06-07-foo.md  (root: just YYYY-MM-DD-<slug>.md)
git commit -m "$(cat <<'EOF'
journal(YYYY-MM-DD): <one-line summary matching the title>

<2–4 line description of the arc>

<commit_trailer, if set>
EOF
)"
```

Then, if `push_mode == "direct"`, push and handle the multi-machine pull–rebase race (the remote may have commits the local clone doesn't):

```bash
git push 2>&1 | tee /tmp/journal-this-push.log
if grep -q "non-fast-forward\|rejected" /tmp/journal-this-push.log; then
  git pull --rebase
  git push
fi
```

Rebase (not merge) keeps history linear. If `push_mode == "pr"`, create a branch, push it, and open a PR instead of pushing to the protected branch. A branch-protection warning that still lets the push land (admin bypass) is informational — report it, don't treat it as failure.

### 5. Report back

Tight confirmation only: file path, and for github the commit hash + push range (`<old>..<new> branch -> branch`). The file and commit are the artifact; the report is just the receipt.

## Edge cases

- **No config yet** → run the setup interview first (see above), then proceed.
- **Nothing substantive to journal** → refuse politely and explain; don't manufacture content.
- **Multiple distinct arcs in one session** → the convention is one arc per file. Ask whether to write one combined entry or split them.
- **Voice source missing/empty** → fall back to the default style; mention you couldn't anchor on samples.
- **Destination repo/folder doesn't exist** → surface it immediately rather than failing partway; don't guess alternate paths.
- **Push fails for a reason other than non-fast-forward** (auth expired, network down, real branch-protection rejection) → surface the error verbatim and ask; don't retry blindly.

## Why this skill exists

A running journal is how an Operator carries context forward across machines and sessions — the lessons, the decision pivots, the "why we did it this way" that the code and git history don't record. The mechanics (where it goes, the naming pattern, the commit + push dance) are stable and worth automating; the value Claude adds is in the prose and in matching the Operator's voice. Reading a couple of prior entries first is the cheapest guard against drifting into generic machine prose — the failure mode this skill is built to prevent.
