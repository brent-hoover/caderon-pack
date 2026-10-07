#!/usr/bin/env node
// Deliver a session's unread review events to the agent once they settle.
//
// Run by the agent with Bash run_in_background: the script exits when there is
// feedback to act on, and that exit gives the idle agent a new turn.
//
// Usage: wait-for-feedback.cjs --session-dir <dir> [--quiet-ms <n>] [--status]
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

// A review burst (several comments, then approve) lands within a couple of
// seconds; 2s of quiet groups it into one agent turn. Raising it past 2000ms
// breaks the "agent acts within 3s" budget (design.md, timing budget).
const DEFAULT_QUIET_MS = 2000;
const POLL_INTERVAL_MS = 250;

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
  watch(session, options.quietMs);
}

function parseArgs(args) {
  const options = { sessionDir: null, quietMs: DEFAULT_QUIET_MS, isStatusQuery: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session-dir') options.sessionDir = args[++i];
    else if (args[i] === '--quiet-ms') options.quietMs = Number(args[++i]);
    else if (args[i] === '--status') options.isStatusQuery = true;
    else failUsage('unknown argument: ' + args[i]);
  }
  if (!options.sessionDir) failUsage('--session-dir is required (the session_dir printed by start-server.sh)');
  if (!Number.isInteger(options.quietMs) || options.quietMs < 0) {
    failUsage('--quiet-ms must be a non-negative integer, got: ' + options.quietMs);
  }
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

function watch(session, quietMs) {
  const timer = setInterval(() => {
    if (!fs.existsSync(session.stateDir)) {
      clearInterval(timer);
      emitThenExit(stoppedLine('session-removed'), EXIT_SERVER_STOPPED);
      return;
    }
    const unread = readUnreadEvents(session);
    if (unread.text && msSinceEventsModified(session) >= quietMs) {
      clearInterval(timer);
      deliver(session, unread, '', EXIT_DELIVERED);
      return;
    }
    if (fs.existsSync(session.stoppedFile)) {
      clearInterval(timer);
      deliver(session, unread, stoppedLine(readStopReason(session)), EXIT_SERVER_STOPPED);
    }
  }, POLL_INTERVAL_MS);
}

// Print before saving the cursor: a crash in between re-delivers the batch on
// the next run (at-least-once) instead of losing it.
function deliver(session, unread, trailer, exitCode) {
  const output = unread.text + trailer;
  process.stdout.write(output, () => {
    if (unread.text) saveCursor(session, unread.endOffset);
    releaseWatcherLock(session);
    process.exit(exitCode);
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
  fs.writeFileSync(tmpFile, offset + '\n');
  fs.renameSync(tmpFile, session.cursorFile);
}

function msSinceEventsModified(session) {
  return Date.now() - fs.statSync(session.eventsFile).mtimeMs;
}

function readStopReason(session) {
  return JSON.parse(fs.readFileSync(session.stoppedFile, 'utf-8')).reason || 'unknown';
}

function stoppedLine(reason) {
  return JSON.stringify({ type: 'server-stopped', reason }) + '\n';
}

// Returns the pid that owns the session after the attempt: ours on success,
// the live owner's otherwise.
function acquireWatcherLock(session) {
  const ownerPid = readWatcherPid(session);
  if (ownerPid !== null && isProcessAlive(ownerPid)) return ownerPid;
  if (ownerPid !== null) fs.rmSync(session.pidFile, { force: true }); // stale: owner died without cleanup
  let fd;
  try {
    fd = fs.openSync(session.pidFile, 'wx');
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Another watcher created the file between our check and our create.
    return readWatcherPid(session);
  }
  fs.writeSync(fd, String(process.pid));
  fs.closeSync(fd);
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
