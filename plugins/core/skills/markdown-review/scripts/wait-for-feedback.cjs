#!/usr/bin/env node
// Deliver a session's review comments to the agent once the operator
// submits them.
//
// Run by the agent with Bash run_in_background: the script exits when the
// operator clicks Submit comments or Approve on a doc in the browser, and that
// exit gives the idle agent a new turn. Comments alone never wake the agent —
// a review produces one every 10-30s, and the operator decides when a doc's
// batch is finished. Submit and Approve are per doc: they deliver only that
// doc's comments.
//
// Usage: wait-for-feedback.cjs --session-dir <dir> [--status]
//
// Exit codes:
//   0  submitted comments and their submit/approve events as JSONL
//      (or, with --status, {"watching":bool})
//   3  server stopped or session dir removed: every undelivered comment, then a
//      server-stopped line
//   4  another live watcher owns this session
//   1  usage error
//
// state/events is append-only; this script never moves or truncates it.
// state/events.cursor is the byte offset just past the last submit/approve
// delivered. What has been delivered follows from the file and the cursor: a
// comment was delivered iff a trigger on its doc lies between it and the
// cursor. Only complete lines are read, so a half-written event is picked up
// on the next run instead of lost.
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
    const lines = readEventLines(session);
    const cursor = effectiveCursor(session, lines);
    if (stopReason !== null) {
      const batch = selectUndelivered(lines, cursor);
      return { batch, trailer: stoppedLine(stopReason), exitCode: EXIT_SERVER_STOPPED };
    }
    const batch = selectSubmitted(lines, cursor);
    if (batch.lines.length === 0) return null;
    return { batch, trailer: '', exitCode: EXIT_DELIVERED };
  } catch (e) {
    // stop-server.sh deletes /tmp sessions; that can land between any two
    // file operations above.
    if (e.code === 'ENOENT' && !fs.existsSync(session.stateDir)) return sessionRemovedOutcome();
    throw e;
  }
}

function sessionRemovedOutcome() {
  return { batch: { lines: [], cursor: null }, trailer: stoppedLine('session-removed'), exitCode: EXIT_SERVER_STOPPED };
}

// Print before saving the cursor: a crash in between re-delivers the batch on
// the next run (at-least-once) instead of losing it.
function deliver(session, outcome) {
  const text = outcome.batch.lines.map(line => line.text).join('');
  process.stdout.write(text + outcome.trailer, () => {
    if (fs.existsSync(session.stateDir)) {
      if (outcome.batch.cursor !== null) saveCursor(session, outcome.batch.cursor);
      releaseWatcherLock(session);
    }
    process.exit(outcome.exitCode);
  });
}

// New triggers (past the cursor) plus, for each, the comments on its doc that
// precede it and no earlier trigger covered. Comments on docs without a new
// trigger keep waiting.
function selectSubmitted(lines, cursor) {
  const newTriggers = lines.filter(line => isTrigger(line) && line.endOffset > cursor);
  if (newTriggers.length === 0) return { lines: [], cursor: null };
  const selected = lines.filter(line => {
    if (isTrigger(line)) return line.endOffset > cursor;
    if (wasDelivered(lines, line, cursor)) return false;
    return newTriggers.some(trigger => trigger.endOffset > line.endOffset && covers(trigger, line));
  });
  return { lines: selected, cursor: newTriggers[newTriggers.length - 1].endOffset };
}

// On shutdown nothing will trigger again, so every comment not yet delivered
// goes out, submitted or not.
function selectUndelivered(lines, cursor) {
  const selected = lines.filter(line => {
    if (isTrigger(line)) return line.endOffset > cursor;
    return !wasDelivered(lines, line, cursor);
  });
  const lastLine = lines[lines.length - 1];
  return { lines: selected, cursor: lastLine ? lastLine.endOffset : null };
}

function wasDelivered(lines, comment, cursor) {
  return lines.some(line => isTrigger(line) && line.endOffset > comment.endOffset &&
    line.endOffset <= cursor && covers(line, comment));
}

function isTrigger(line) {
  return TRIGGER_EVENT_TYPES.includes(line.event.type);
}

// A trigger without a doc (written by earlier viewers) covers every doc.
function covers(trigger, comment) {
  return !trigger.event.doc || trigger.event.doc === comment.event.doc;
}

// Complete lines of state/events with the byte offset where each ends.
function readEventLines(session) {
  let content;
  try {
    content = fs.readFileSync(session.eventsFile);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const lines = [];
  let start = 0;
  let newline = content.indexOf(0x0a, start);
  while (newline !== -1) {
    const text = content.subarray(start, newline + 1).toString('utf-8');
    lines.push({ text, event: JSON.parse(text), endOffset: newline + 1 });
    start = newline + 1;
    newline = content.indexOf(0x0a, start);
  }
  return lines;
}

// A cursor past the end means an agent on the pre-cursor contract truncated
// the file; start over rather than skip what is there now.
function effectiveCursor(session, lines) {
  const cursor = readCursor(session);
  const fileEnd = lines.length > 0 ? lines[lines.length - 1].endOffset : 0;
  return cursor > fileEnd ? 0 : cursor;
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
