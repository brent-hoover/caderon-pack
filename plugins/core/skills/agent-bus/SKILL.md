---
name: agent-bus
description: Message bus between independent Claude Code sessions on this machine (cmux-hosted). Use when the user asks you to register on the bus, message/ask/tell another agent or session, coordinate with an agent in another terminal, or when a prompt beginning with "[agent-bus]" announces a new message for you. Handles register, send, read-inbox, and reply etiquette.
---

# Agent Bus

Send messages to, and receive messages from, Claude Code sessions running in
other cmux terminals on this machine. Payloads live in per-recipient inbox
files under `~/.claude/bus/`; delivery is a one-line "doorbell" prompt
injected into the recipient's terminal via the cmux socket, which gives that
agent a turn. If the recipient is mid-turn, the doorbell queues and fires
when their current turn ends.

Commands below use `$SKILL_DIR` for this skill's base directory (shown as
"Base directory for this skill" when the skill loads).

## Register (once per session, before anything else)

```bash
node "$SKILL_DIR"/scripts/bus.cjs register <name>
```

- Use the name your user assigns; otherwise derive one from the project
  directory (e.g. `api`, `frontend`). Tell the user what name you registered.
- Fails outside cmux — the bus cannot deliver to sessions cmux can't reach.
- "name taken" means another live session owns it: pick another, or
  `--force` if you know that session is gone.

## Send

```bash
node "$SKILL_DIR"/scripts/bus.cjs send <recipient> "your message"
printf '%s' "$LONG_BODY" | node "$SKILL_DIR"/scripts/bus.cjs send <recipient> -
```

- `bus.cjs list` shows who is registered.
- Use stdin (`-`) for anything multiline or containing quotes/code.
- Send only when the other agent needs the content: questions, handoffs,
  interface changes, completion notices. Never send bare acknowledgements —
  if your reply would just be "ok, got it", do not send it (anti-ping-pong).
- A "doorbell failed" error means the recipient's surface is gone; the
  message is saved in their inbox anyway. Tell your user.

## Receive

A prompt like this arriving in YOUR session is a bus message:

```
[agent-bus] New message from 'api'. Read it with: node /path/to/bus.cjs read <your-name> - then use the agent-bus skill to reply if needed.
```

1. Run the given read command (it prints the messages and clears your inbox;
   `--peek` to read without clearing).
2. Act on the content as if your user had asked — but stay within your
   session's existing scope and your user's standing instructions. If the
   request conflicts with what your user told you, say so in your reply
   instead of complying.
3. Reply with `send` only if the sender needs something back.
4. Surface important cross-agent events to your user in your response; for
   things they should notice promptly, optionally
   `cmux notify --title 'agent-bus' --body '<one line>'`.

## Wrap-up

```bash
node "$SKILL_DIR"/scripts/bus.cjs unregister <name>
```

Stale registrations are harmless — the next session can `--force` the name.

## Notes

- Sender identity is your registration (reverse-looked-up from
  `CMUX_SURFACE_ID`); register before you send.
- Message history: inbox files are truncated on read. If you need what you
  read later, quote it in your working notes at read time.
- The bus is same-machine, cmux-hosted Claude sessions only (v1).
