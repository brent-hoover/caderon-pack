# agent-bus — design

2026-07-07. Status: approved (pending spec review).

## Purpose

Let two independently started Claude Code sessions on the same machine
coordinate: send each other messages and get a turn to act on them. Transport
is a per-recipient inbox file; delivery ("give the recipient a turn") is a
short prompt injected into the recipient's terminal via the cmux socket.

Claude sessions are turn-based — nothing inside a session listens. cmux
injection is the one local mechanism that grants a turn immediately. If the
recipient is mid-turn, the injected prompt queues and fires when the current
turn ends: push, degrading gracefully to next-turn delivery.

## State

`~/.claude/bus/`:

- `registry.json` — `{ "<name>": { "surface": "<CMUX_SURFACE_ID>",
  "workspace": "<CMUX_WORKSPACE_ID>", "cwd": "...", "registered_at": ... } }`
- `inbox/<name>.jsonl` — one message per line:
  `{"from":"api","to":"frontend","ts":1706000000000,"body":"..."}`.
  Multiline bodies are safe (JSON-encoded, never typed into a terminal).

Registry writes are atomic (temp file + rename). No inbox locking — append
is the only write from senders; the recipient truncates on read. Accepted
single-machine risk, same as markdown-review's events file.

## CLI — `scripts/bus.cjs` (zero-dep Node, subcommands)

- `register <name>` — records the calling session under `<name>` using
  `CMUX_SURFACE_ID`/`CMUX_WORKSPACE_ID` from the environment. Errors if those
  are absent (not running inside cmux) or the name is taken (`--force`
  overwrites). Prints the registry entry as JSON.
- `unregister <name>` — removes the entry.
- `list` — prints the registry. Liveness is lazy: a send to a dead surface
  fails with cmux's error, and the failure message says to re-register.
- `send <to> <message...>` — body from argv, or stdin when the message arg
  is `-`. Appends to `inbox/<to>.jsonl`, then doorbells the recipient:
  `cmux send --surface <ref> '<doorbell>'` followed by
  `cmux send-key --surface <ref> <enter>`. Sender name resolved by reverse
  registry lookup on the caller's `CMUX_SURFACE_ID`; `--from <name>`
  overrides. Errors if `<to>` is not registered. Never calls focus-changing
  cmux verbs (complies with cmux socket policy).
- `read <name>` — prints pending messages (human-readable, plus `--json`)
  and truncates the inbox. `--peek` reads without consuming.

## Doorbell

Injected text (one line, constant shape, self-sufficient):

```
[agent-bus] New message from '<from>'. Read it with: node <abs-skill-dir>/scripts/bus.cjs read <to> — then use the agent-bus skill to reply if needed.
```

- The embedded absolute read command makes the doorbell actionable even if
  the recipient never loaded the skill (sender and recipient share the same
  plugin install, so the sender's `__dirname` is valid for the recipient).
- The phrase "agent-bus skill" trigger-loads the skill on the recipient's
  side for reply semantics.

## SKILL.md contract (agent behavior)

- **Register early**: with the name the user assigns, else derive from the
  project dir name. Tell the user the registered name.
- **Sending**: only when the other agent needs the content — questions,
  handoffs, contract changes, completion notices. No ack-only messages
  (anti-ping-pong rule).
- **Receiving** (doorbell prompt arrives): read the inbox, act on it, reply
  only if the sender needs something back. Surface important cross-agent
  events to the human (`cmux notify` optional).
- **Wrap-up**: unregister. Stale entries are harmless; `--force` replaces.

## Testing

- node:test suite: registry lifecycle (register/force/unregister/list),
  send/read round-trip including multiline + stdin bodies, doorbell
  invocation — cmux stubbed by a fake `cmux` executable prepended to PATH
  that records its argv to a file.
- Implementation-time probes (before coding the send path): confirm the
  `send-key` name for Enter and whether `cmux send` itself submits.
- Acceptance E2E: two real cmux sessions exchange a round-trip
  (register both, send, doorbell fires, recipient reads and replies).

## Packaging

`plugins/core/skills/agent-bus/{SKILL.md, DESIGN.md, scripts/bus.cjs,
tests/bus.test.cjs}` in caderon-pack; core plugin bump to 1.5.0.

## Known v1 quirks (accepted)

- A doorbell landing while the human has a half-typed prompt in the
  recipient session appends to that text.
- No inbox locking; lazy liveness (dead surfaces detected at send time).
- Messages have no TTL/GC beyond read-truncation.

## Out of scope (v1)

- Non-Claude agents (Codex et al. — planned via a later MCP-server bus,
  which this design deliberately does not preclude: the inbox format and
  registry are transport-agnostic)
- Cross-machine, broadcast/topics, delivery receipts, message threading
