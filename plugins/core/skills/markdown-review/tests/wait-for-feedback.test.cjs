const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WATCHER = path.join(__dirname, '..', 'scripts', 'wait-for-feedback.cjs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeSession() {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-watch-'));
  const stateDir = path.join(sessionDir, 'state');
  fs.mkdirSync(stateDir);
  return { sessionDir, stateDir, eventsFile: path.join(stateDir, 'events') };
}

function eventLine(comment) {
  return JSON.stringify({ type: 'comment', doc: '/d/a.md', scope: 'doc', comment }) + '\n';
}

const SUBMIT = JSON.stringify({ type: 'submit', timestamp: 1 }) + '\n';
const APPROVE = JSON.stringify({ type: 'approve', doc: '/d/a.md', timestamp: 1 }) + '\n';

function startWatcher(args) {
  const startedAt = Date.now();
  const child = spawn('node', [WATCHER, ...args]);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr, elapsedMs: Date.now() - startedAt }));
  });
  return { child, exited, isRunning: () => child.exitCode === null && child.signalCode === null };
}

async function waitForPidFile(stateDir) {
  const pidFile = path.join(stateDir, 'watcher.pid');
  for (let i = 0; i < 40 && !fs.existsSync(pidFile); i++) await sleep(50);
  return Number(fs.readFileSync(pidFile, 'utf-8').trim());
}

test('Given no --session-dir, when run, then it exits 1 naming the missing flag', async () => {
  const run = await startWatcher([]).exited;
  assert.strictEqual(run.code, 1);
  assert.match(run.stderr, /--session-dir is required/);
});

test('Given a dir without state/, when run, then it exits 1 naming the dir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-notsession-'));
  const run = await startWatcher(['--session-dir', dir]).exited;
  assert.strictEqual(run.code, 1);
  assert.ok(run.stderr.includes('not an md-review session: ' + dir));
});

test('Given comments then a submit, when the watcher runs, then it delivers all and advances the cursor', async () => {
  const s = makeSession();
  fs.writeFileSync(s.eventsFile, eventLine('one') + eventLine('two') + SUBMIT);
  const run = await startWatcher(['--session-dir', s.sessionDir]).exited;
  assert.strictEqual(run.code, 0);
  assert.strictEqual(run.stdout, eventLine('one') + eventLine('two') + SUBMIT);
  assert.strictEqual(fs.readFileSync(s.eventsFile, 'utf-8'), eventLine('one') + eventLine('two') + SUBMIT);
  assert.strictEqual(fs.readFileSync(path.join(s.stateDir, 'events.cursor'), 'utf-8').trim(),
    String(fs.statSync(s.eventsFile).size));
});

test('Given a delivered batch, when more events arrive, then the next run delivers only the new ones', async () => {
  const s = makeSession();
  fs.writeFileSync(s.eventsFile, eventLine('old') + SUBMIT);
  await startWatcher(['--session-dir', s.sessionDir]).exited;
  fs.appendFileSync(s.eventsFile, eventLine('new') + APPROVE);
  const run = await startWatcher(['--session-dir', s.sessionDir]).exited;
  assert.strictEqual(run.stdout, eventLine('new') + APPROVE);
});

test('Given the cursor is at the end, when nothing new arrives, then the watcher keeps waiting', async () => {
  const s = makeSession();
  fs.writeFileSync(s.eventsFile, eventLine('old') + SUBMIT);
  await startWatcher(['--session-dir', s.sessionDir]).exited;
  const w = startWatcher(['--session-dir', s.sessionDir]);
  await sleep(1500);
  assert.ok(w.isRunning(), 'watcher re-delivered already-read events');
  w.child.kill('SIGTERM');
  await w.exited;
});

test('Given events shorter than the cursor, when the watcher runs, then it resets and delivers all lines', async () => {
  const s = makeSession();
  fs.writeFileSync(s.eventsFile, eventLine('after-truncate') + SUBMIT);
  fs.writeFileSync(path.join(s.stateDir, 'events.cursor'), '999999\n');
  const run = await startWatcher(['--session-dir', s.sessionDir]).exited;
  assert.strictEqual(run.stdout, eventLine('after-truncate') + SUBMIT);
});

test('Given only comments, when watching, then the watcher keeps waiting', async () => {
  const s = makeSession();
  fs.writeFileSync(s.eventsFile, eventLine('one') + eventLine('two'));
  const w = startWatcher(['--session-dir', s.sessionDir]);
  await sleep(2500); // past the old 2s quiet window, so a regression to it fails here
  assert.ok(w.isRunning(), 'comments alone woke the agent');
  w.child.kill('SIGTERM');
  await w.exited;
});

test('Given a watcher waiting on comments, when a submit arrives, then all are delivered within 1s', async () => {
  const s = makeSession();
  fs.writeFileSync(s.eventsFile, eventLine('one'));
  const w = startWatcher(['--session-dir', s.sessionDir]);
  await waitForPidFile(s.stateDir);
  await sleep(300);
  const submittedAt = Date.now();
  fs.appendFileSync(s.eventsFile, eventLine('two') + SUBMIT);
  const run = await w.exited;
  assert.ok(Date.now() - submittedAt <= 1000, 'delivered ' + (Date.now() - submittedAt) + 'ms after submit');
  assert.strictEqual(run.code, 0);
  assert.strictEqual(run.stdout, eventLine('one') + eventLine('two') + SUBMIT);
});

test('Given an approve alone, when the watcher runs, then it is delivered', async () => {
  const s = makeSession();
  fs.writeFileSync(s.eventsFile, APPROVE);
  const run = await startWatcher(['--session-dir', s.sessionDir]).exited;
  assert.strictEqual(run.code, 0);
  assert.strictEqual(run.stdout, APPROVE);
});

test('Given --quiet-ms (removed), when run, then it exits 1 as an unknown argument', async () => {
  const s = makeSession();
  const run = await startWatcher(['--session-dir', s.sessionDir, '--quiet-ms', '500']).exited;
  assert.strictEqual(run.code, 1);
  assert.match(run.stderr, /unknown argument: --quiet-ms/);
});

test('Given no events, when watching for 3s, then it is still waiting', async () => {
  const s = makeSession();
  const w = startWatcher(['--session-dir', s.sessionDir]);
  await sleep(3000);
  assert.ok(w.isRunning());
  w.child.kill('SIGTERM');
  await w.exited;
});

test('Given the server stopped with unsubmitted comments, then they are delivered before exit 3', async () => {
  const s = makeSession();
  fs.writeFileSync(s.eventsFile, eventLine('last-words'));
  fs.writeFileSync(path.join(s.stateDir, 'server-stopped'), JSON.stringify({ reason: 'signal', timestamp: 1 }) + '\n');
  const run = await startWatcher(['--session-dir', s.sessionDir]).exited;
  assert.strictEqual(run.code, 3);
  assert.strictEqual(run.stdout, eventLine('last-words') + '{"type":"server-stopped","reason":"signal"}\n');
});

test('Given the server stopped with no events, then only the stopped line is printed', async () => {
  const s = makeSession();
  fs.writeFileSync(path.join(s.stateDir, 'server-stopped'), JSON.stringify({ reason: 'idle timeout', timestamp: 1 }) + '\n');
  const run = await startWatcher(['--session-dir', s.sessionDir]).exited;
  assert.strictEqual(run.code, 3);
  assert.strictEqual(run.stdout, '{"type":"server-stopped","reason":"idle timeout"}\n');
});

test('Given the session dir is deleted while waiting, then it exits 3 with session-removed', async () => {
  const s = makeSession();
  const w = startWatcher(['--session-dir', s.sessionDir]);
  await waitForPidFile(s.stateDir);
  fs.rmSync(s.sessionDir, { recursive: true, force: true });
  const run = await w.exited;
  assert.strictEqual(run.code, 3);
  assert.strictEqual(run.stdout, '{"type":"server-stopped","reason":"session-removed"}\n');
});

test('Given a live watcher, when a second starts, then it exits 4 and leaves the first one\'s pid file', async () => {
  const s = makeSession();
  const first = startWatcher(['--session-dir', s.sessionDir]);
  const firstPid = await waitForPidFile(s.stateDir);
  const second = await startWatcher(['--session-dir', s.sessionDir]).exited;
  assert.strictEqual(second.code, 4);
  assert.strictEqual(second.stdout, JSON.stringify({ type: 'already-watching', pid: firstPid }) + '\n');
  assert.strictEqual(fs.readFileSync(path.join(s.stateDir, 'watcher.pid'), 'utf-8').trim(), String(firstPid));
  first.child.kill('SIGTERM');
  await first.exited;
});

test('Given a pid file naming a dead process, when a watcher starts, then it takes over the lock', async () => {
  const s = makeSession();
  const deadPid = 2 ** 22 + 12345; // above macOS/Linux default pid_max, so never alive
  fs.writeFileSync(path.join(s.stateDir, 'watcher.pid'), String(deadPid));
  const w = startWatcher(['--session-dir', s.sessionDir]);
  await sleep(500);
  assert.ok(w.isRunning());
  assert.strictEqual(fs.readFileSync(path.join(s.stateDir, 'watcher.pid'), 'utf-8').trim(), String(w.child.pid));
  w.child.kill('SIGTERM');
  await w.exited;
});

test('Given --status, then it reports watcher liveness immediately', async () => {
  const s = makeSession();
  const idle = await startWatcher(['--session-dir', s.sessionDir, '--status']).exited;
  assert.strictEqual(idle.code, 0);
  assert.strictEqual(idle.stdout, '{"watching":false}\n');

  const w = startWatcher(['--session-dir', s.sessionDir]);
  await waitForPidFile(s.stateDir);
  const busy = await startWatcher(['--session-dir', s.sessionDir, '--status']).exited;
  assert.strictEqual(busy.stdout, '{"watching":true}\n');
  w.child.kill('SIGTERM');
  await w.exited;
});

test('Given a watcher, when it exits 0, exits 3 or gets SIGTERM, then its pid file is removed', async () => {
  const pidFileGone = (s) => !fs.existsSync(path.join(s.stateDir, 'watcher.pid'));

  const delivered = makeSession();
  fs.writeFileSync(delivered.eventsFile, eventLine('x') + SUBMIT);
  assert.strictEqual((await startWatcher(['--session-dir', delivered.sessionDir]).exited).code, 0);
  assert.ok(pidFileGone(delivered), 'pid file left after exit 0');

  const stopped = makeSession();
  fs.writeFileSync(path.join(stopped.stateDir, 'server-stopped'), '{"reason":"signal"}\n');
  assert.strictEqual((await startWatcher(['--session-dir', stopped.sessionDir]).exited).code, 3);
  assert.ok(pidFileGone(stopped), 'pid file left after exit 3');

  const killed = makeSession();
  const w = startWatcher(['--session-dir', killed.sessionDir]);
  await waitForPidFile(killed.stateDir);
  w.child.kill('SIGTERM');
  await w.exited;
  assert.ok(pidFileGone(killed), 'pid file left after SIGTERM');
});

test('Given a half-written line, when the watcher runs, then it delivers only complete lines and the rest later', async () => {
  const s = makeSession();
  const partial = eventLine('partial');
  const half = Math.floor(partial.length / 2);
  fs.writeFileSync(s.eventsFile, eventLine('complete') + SUBMIT + partial.slice(0, half));
  const first = await startWatcher(['--session-dir', s.sessionDir]).exited;
  assert.strictEqual(first.stdout, eventLine('complete') + SUBMIT);

  fs.appendFileSync(s.eventsFile, partial.slice(half) + SUBMIT);
  const second = await startWatcher(['--session-dir', s.sessionDir]).exited;
  assert.strictEqual(second.stdout, partial + SUBMIT);
});

test('Given an empty pid file left by a killed watcher, when a watcher starts, then it takes over the lock', async () => {
  const s = makeSession();
  fs.writeFileSync(path.join(s.stateDir, 'watcher.pid'), '');
  const w = startWatcher(['--session-dir', s.sessionDir]);
  await sleep(500);
  assert.ok(w.isRunning(), 'watcher refused an abandoned empty lock');
  assert.strictEqual(fs.readFileSync(path.join(s.stateDir, 'watcher.pid'), 'utf-8').trim(), String(w.child.pid));
  w.child.kill('SIGTERM');
  await w.exited;
});

test('Given a half-written server-stopped marker, when watching, then it waits for the complete marker', async () => {
  const s = makeSession();
  const stoppedFile = path.join(s.stateDir, 'server-stopped');
  fs.writeFileSync(stoppedFile, '{"reas');
  const w = startWatcher(['--session-dir', s.sessionDir]);
  await sleep(700);
  assert.ok(w.isRunning(), 'watcher gave up on an incomplete marker');
  fs.writeFileSync(stoppedFile, JSON.stringify({ reason: 'signal', timestamp: 1 }) + '\n');
  const run = await w.exited;
  assert.strictEqual(run.code, 3);
  assert.strictEqual(run.stdout, '{"type":"server-stopped","reason":"signal"}\n');
});

test('Given comment A, approve, comment B, when delivered, then B waits for the next trigger', async () => {
  const s = makeSession();
  fs.writeFileSync(s.eventsFile, eventLine('A') + APPROVE + eventLine('B'));
  const first = await startWatcher(['--session-dir', s.sessionDir]).exited;
  assert.strictEqual(first.stdout, eventLine('A') + APPROVE);

  const second = startWatcher(['--session-dir', s.sessionDir]);
  await sleep(1000);
  assert.ok(second.isRunning(), 'unsubmitted comment B was delivered');
  fs.appendFileSync(s.eventsFile, SUBMIT);
  const run = await second.exited;
  assert.strictEqual(run.stdout, eventLine('B') + SUBMIT);
});
