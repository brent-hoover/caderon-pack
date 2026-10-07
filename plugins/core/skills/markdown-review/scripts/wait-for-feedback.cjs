#!/usr/bin/env node
// Deliver a session's unread review events to the agent once the operator
// submits them.
//
// Run by the agent with Bash run_in_background: the script exits when the
// operator clicks Submit comments or Approve in the browser, and that exit
// gives the idle agent a new turn. Comments alone never wake the agent —
// a review produces one every 10-30s, and the operator decides when a batch
// is finished.
//
// Usage: wait-for-feedback.cjs --session-dir <dir> [--status]
//
// Exit codes:
//   0  unread events printed as JSONL (or, with --status, {"watching":bool})
//   3  server stopped or session dir removed: unread events, then a server-stopped line
//   4  another live watcher owns this session
//   1  usage error
//
// state/events is append-only; this script never moves or truncates it. It keeps
// a byte offset in state/events.cursor and delivers only complete lines past it,
// so a late or half-written event is picked up on the next run instead of lost.
const fs = require('fs');
const path = require('path');

const POLL_INTERVAL_MS = 250;
const TRIGGER_EVENT_TYPES = ['submit', 'approve'];

const EXIT_DELIVERED = 0;
const EXIT_USAGE = 1;
const EXIT_SERVER_STOPPED = 3;
const EXIT_ALREADY_WATCHING = 4;

main();

function main() {
  const options = parseArgs(process.argv.slice(2));
  const session = sessionPaths(options.sessionDir);
  if (options.isStatusQuery) {
    const pid = readWatcherPid(session);
    emitThenExit(JSON.stringify({ watching: pid !== null && isProcessAlive(pid) }) + '\n', EXIT_DELIVERED);
    return;
  }
  const ownerPid = acquireWatcherLock(session);
  if (ownerPid !== process.pid) {
    emitThenExit(JSON.stringify({ type: 'already-watching', pid: ownerPid }) + '\n', EXIT_ALREADY_WATCHING);
    return;
  }
  process.on('SIGTERM', () => { releaseWatcherLock(session); process.exit(143); });
  process.on('SIGINT', () => { releaseWatcherLock(session); process.exit(130); });
  watch(session);
}

function parseArgs(args) {
  const options = { sessionDir: null, isStatusQuery: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session-dir') options.sessionDir = args[++i];
    else if (args[i] === '--status') options.isStatusQuery = true;
    else failUsage('unknown argument: ' + args[i]);
  }
  if (!options.sessionDir) failUsage('--session-dir is required (the session_dir printed by start-server.sh)');
  if (!fs.existsSync(path.join(options.sessionDir, 'state'))) {
    failUsage('not an md-review session: ' + options.sessionDir + ' (no state/ directory)');
  }
  return options;
}

function failUsage(message) {
  process.stderr.write('wait-for-feedback: ' + message + '\n');
  process.exit(EXIT_USAGE);
}

function sessionPaths(sessionDir) {
  const stateDir = path.join(sessionDir, 'state');
  return {
    stateDir,
    eventsFile: path.join(stateDir, 'events'),
    cursorFile: path.join(stateDir, 'events.cursor'),
    pidFile: path.join(stateDir, 'watcher.pid'),
    stoppedFile: path.join(stateDir, 'server-stopped')
  };
}

function watch(session) {
  const timer = setInterval(() => {
    const outcome = pollOnce(session);
    if (outcome === null) return;
    clearInterval(timer);
    deliver(session, outcome);
  }, POLL_INTERVAL_MS);
}

// Returns what to deliver and how to exit, or null to keep waiting.
function pollOnce(session) {
  try {
    if (!fs.existsSync(session.stateDir)) return sessionRemovedOutcome();
    // Check for a stop before reading events: the server appends its last
    // events before writing server-stopped, so this order cannot miss them.
    const stopReason = readStopReason(session);
    const unread = readUnreadEvents(session);
    if (stopReason !== null) return { unread, trailer: stoppedLine(stopReason), exitCode: EXIT_SERVER_STOPPED };
    const submitted = throughLastTrigger(unread);
    if (submitted.text) return { unread: submitted, trailer: '', exitCode: EXIT_DELIVERED };
    return null;
  } catch (e) {
    // stop-server.sh deletes /tmp sessions; that can land between any two
    // file operations above.
    if (e.code === 'ENOENT' && !fs.existsSync(session.stateDir)) return sessionRemovedOutcome();
    throw e;
  }
}

function sessionRemovedOutcome() {
  return { unread: { text: '', endOffset: 0 }, trailer: stoppedLine('session-removed'), exitCode: EXIT_SERVER_STOPPED };
}

// Print before saving the cursor: a crash in between re-delivers the batch on
// the next run (at-least-once) instead of losing it.
function deliver(session, outcome) {
  process.stdout.write(outcome.unread.text + outcome.trailer, () => {
    if (fs.existsSync(session.stateDir)) {
      if (outcome.unread.text) saveCursor(session, outcome.unread.endOffset);
      releaseWatcherLock(session);
    }
    process.exit(outcome.exitCode);
  });
}

function readUnreadEvents(session) {
  let content;
  try {
    content = fs.readFileSync(session.eventsFile);
  } catch (e) {
    if (e.code === 'ENOENT') return { text: '', endOffset: 0 };
    throw e;
  }
  let cursor = readCursor(session);
  // A shorter file means an agent on the pre-cursor contract truncated it.
  if (cursor > content.length) cursor = 0;
  const lastNewline = content.lastIndexOf(0x0a);
  if (lastNewline < cursor) return { text: '', endOffset: cursor };
  return { text: content.subarray(cursor, lastNewline + 1).toString('utf-8'), endOffset: lastNewline + 1 };
}

function readCursor(session) {
  try {
    // An unreadable cursor falls back to 0: re-delivering is safe, skipping is not.
    return Number(fs.readFileSync(session.cursorFile, 'utf-8').trim()) || 0;
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    throw e;
  }
}

function saveCursor(session, offset) {
  const tmpFile = session.cursorFile + '.tmp';
  // Owner-only, like every other file start-server.sh creates under the session.
  fs.writeFileSync(tmpFile, offset + '\n', { mode: 0o600 });
  fs.renameSync(tmpFile, session.cursorFile);
}

// The unread events up to and including the last submit/approve. Comments
// saved after it belong to the next batch, which the operator hasn't sent yet.
// Returns empty text when there is no trigger.
function throughLastTrigger(unread) {
  const lines = unread.text.split('\n').filter(Boolean).map(line => line + '\n');
  let lastTrigger = -1;
  lines.forEach((line, i) => {
    if (TRIGGER_EVENT_TYPES.includes(JSON.parse(line).type)) lastTrigger = i;
  });
  const text = lines.slice(0, lastTrigger + 1).join('');
  const startOffset = unread.endOffset - Buffer.byteLength(unread.text);
  return { text, endOffset: startOffset + Buffer.byteLength(text) };
}

// Returns null while the server is running. The server writes server-stopped
// in place, so a poll can see it half-written; that also reads as "not yet".
function readStopReason(session) {
  let marker;
  try {
    marker = fs.readFileSync(session.stoppedFile, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    return JSON.parse(marker).reason || 'unknown';
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

function stoppedLine(reason) {
  return JSON.stringify({ type: 'server-stopped', reason }) + '\n';
}

// Returns the pid that owns the session after the attempt: ours on success,
// the live owner's otherwise.
//
// The pid is written to a private temp file and hard-linked into place, so
// watcher.pid never exists without its pid — an empty or dead-pid file can
// only be left by a watcher that was killed, and is safe to replace.
// Not guarded: two watchers recovering the same stale lock at the same
// instant. The agent checks --status before arming, so it never starts two.
function acquireWatcherLock(session) {
  const ownerPid = readWatcherPid(session);
  if (ownerPid !== null && isProcessAlive(ownerPid)) return ownerPid;
  fs.rmSync(session.pidFile, { force: true });
  const tmpFile = session.pidFile + '.' + process.pid;
  fs.writeFileSync(tmpFile, String(process.pid), { mode: 0o600 });
  try {
    fs.linkSync(tmpFile, session.pidFile);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Another watcher published its lock between our check and our link.
    return readWatcherPid(session);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
  return process.pid;
}

function releaseWatcherLock(session) {
  if (readWatcherPid(session) === process.pid) fs.rmSync(session.pidFile, { force: true });
}

function readWatcherPid(session) {
  try {
    const pid = Number(fs.readFileSync(session.pidFile, 'utf-8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function emitThenExit(text, exitCode) {
  process.stdout.write(text, () => process.exit(exitCode));
}
