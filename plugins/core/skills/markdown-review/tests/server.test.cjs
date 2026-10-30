const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const TOKEN = 'a'.repeat(64);
const { recordRevision } = require(path.join(SCRIPTS, 'revisions.cjs'));

let proc = null;
let base = null;
let cookie = null;
let sessionDir, docsDir, manifestFile, stateDir;

function waitForStart(p) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('server start timeout; output: ' + buf)), 5000);
    p.stdout.on('data', (d) => {
      buf += d.toString();
      const line = buf.split('\n').find(l => l.includes('"server-started"'));
      if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
    });
    p.stderr.on('data', (d) => { buf += d.toString(); });
    p.on('exit', (c) => { clearTimeout(timer); reject(new Error('server exited ' + c + '; output: ' + buf)); });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Running the suite inside cmux must never ring the operator's real surface,
// so CMUX_SURFACE_ID is dropped unless a test passes it explicitly.
function spawnServer(dir, token, extraEnv = {}) {
  const env = { ...process.env, MDREVIEW_DIR: dir, MDREVIEW_TOKEN: token, MDREVIEW_LIFECYCLE_CHECK_MS: '600000' };
  delete env.CMUX_SURFACE_ID;
  return spawn('node', [path.join(SCRIPTS, 'server.cjs')], { env: { ...env, ...extraEnv } });
}

function sendReviewEvent(port, token, event) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/?key=' + token);
    ws.onopen = () => { ws.send(JSON.stringify(event)); ws.close(); };
    ws.onclose = () => resolve();
    ws.onerror = (e) => reject(new Error('websocket error sending ' + event.type + ': ' + e.message));
  });
}

before(async () => {
  sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-test-'));
  docsDir = path.join(sessionDir, 'docs');
  fs.mkdirSync(docsDir);
  fs.writeFileSync(path.join(docsDir, 'plan.md'), '# Test Plan\n\nHello **world**\n');
  fs.writeFileSync(path.join(docsDir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // outside the doc dir — must NOT be reachable even with an allowed extension
  fs.writeFileSync(path.join(sessionDir, 'secret.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  manifestFile = path.join(sessionDir, 'manifest.json');
  stateDir = path.join(sessionDir, 'state');
  fs.writeFileSync(manifestFile, JSON.stringify([path.join(docsDir, 'plan.md')]));
  recordRevision(path.join(docsDir, 'plan.md'));

  proc = spawnServer(sessionDir, TOKEN);
  const info = await waitForStart(proc);
  base = 'http://127.0.0.1:' + info.port;
  cookie = 'mdreview-key-' + info.port + '=' + TOKEN;
});

after(() => { if (proc) proc.kill(); });

const get = (p) => fetch(base + p, { headers: { cookie } });

test('rejects requests without the session key', async () => {
  const r = await fetch(base + '/docs');
  assert.strictEqual(r.status, 403);
});

test('keyed / returns bootstrap page that stores the key', async () => {
  const r = await fetch(base + '/?key=' + TOKEN);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.match(body, /mdreview-session-key/);
});

test('serves viewer with inlined marked and viewer scripts', async () => {
  const r = await get('/');
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.match(body, /id="doclist"/);
  assert.doesNotMatch(body, /<!-- MARKED_JS -->/);
  assert.doesNotMatch(body, /<!-- VIEWER_JS -->/);
  assert.doesNotMatch(body, /<!-- GHERKIN_JS -->/);
  assert.match(body, /function parseGherkinBlocks/);
  assert.match(body, /marked/);
  assert.match(body, /refreshDocs/);
});

test('/docs lists manifest entries with ids, mtimes and latest revisions', async () => {
  const docs = await (await get('/docs')).json();
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].id, 0);
  assert.ok(docs[0].path.endsWith('/plan.md'));
  assert.strictEqual(typeof docs[0].mtime, 'number');
  assert.strictEqual(docs[0].revision, 1);
});

test('/doc/<id> returns the latest revision\'s raw markdown', async () => {
  const r = await get('/doc/0');
  assert.strictEqual(r.status, 200);
  assert.match(await r.text(), /# Test Plan/);
});

test('/doc with out-of-range or garbage id is 404', async () => {
  assert.strictEqual((await get('/doc/99')).status, 404);
  assert.strictEqual((await get('/doc/zzz')).status, 404);
});

test('serves sibling image assets', async () => {
  const r = await get('/asset/0/pic.png');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/png');
});

test('rejects path-traversal asset requests', async () => {
  // %2F survives URL normalization; the server decodes it to '../'
  const r = await get('/asset/0/..%2Fsecret.png');
  assert.strictEqual(r.status, 404);
});

test('rejects assets with disallowed extensions', async () => {
  fs.writeFileSync(path.join(docsDir, 'notes.txt'), 'x');
  const r = await get('/asset/0/notes.txt');
  assert.strictEqual(r.status, 404);
});

test('manifest hot-add is picked up', async () => {
  fs.writeFileSync(path.join(docsDir, 'design.md'), '# Design\n');
  fs.writeFileSync(manifestFile, JSON.stringify([
    path.join(docsDir, 'plan.md'),
    path.join(docsDir, 'design.md')
  ]));
  await sleep(1500);
  const docs = await (await get('/docs')).json();
  assert.strictEqual(docs.length, 2);
  assert.ok(docs[1].path.endsWith('/design.md'));
});

test('resolveAsset unit: accepts inside, rejects outside and bad ext', () => {
  process.env.MDREVIEW_DIR = sessionDir; // set before require
  const { resolveAsset } = require(path.join(SCRIPTS, 'server.cjs'));
  const docPath = path.join(docsDir, 'plan.md');
  assert.strictEqual(resolveAsset(docPath, 'pic.png'), fs.realpathSync(path.join(docsDir, 'pic.png')));
  assert.strictEqual(resolveAsset(docPath, '../secret.png'), null);
  assert.strictEqual(resolveAsset(docPath, 'notes.txt'), null);
  assert.strictEqual(resolveAsset(docPath, 'missing.png'), null);
});

test('SIGTERM runs the shutdown handler: writes server-stopped, removes server-info', async () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-test2-'));
  const stateDir2 = path.join(dir2, 'state');
  const proc2 = spawnServer(dir2, 'b'.repeat(64));
  await waitForStart(proc2);

  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('process did not exit after SIGTERM')), 5000);
    proc2.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  proc2.kill('SIGTERM');
  await exited;

  assert.ok(fs.existsSync(path.join(stateDir2, 'server-stopped')));
  assert.ok(!fs.existsSync(path.join(stateDir2, 'server-info')));
});

test('WS upgrade without a key/cookie is rejected before the 101 response', async () => {
  const port = Number(base.split(':').pop());
  const chunks = [];
  const closed = new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        'GET / HTTP/1.1\r\n' +
        'Host: 127.0.0.1:' + port + '\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    socket.on('data', (d) => chunks.push(d));
    socket.on('close', () => resolve());
    socket.on('error', () => resolve());
  });
  await closed;
  const data = Buffer.concat(chunks).toString();
  assert.ok(!data.startsWith('HTTP/1.1 101'));
});

test('Given no key, when GET /events, then it is rejected', async () => {
  assert.strictEqual((await fetch(base + '/events')).status, 403);
});

test('Given no events yet, when GET /events, then it returns an empty list', async () => {
  assert.deepStrictEqual(await (await get('/events')).json(), []);
});

test('Given events were sent, when GET /events, then it returns them parsed and skips a partial line', async () => {
  const port = Number(base.split(':').pop());
  await sendReviewEvent(port, TOKEN, { type: 'comment', doc: '/x/plan.md', scope: 'doc', comment: 'first' });
  await sendReviewEvent(port, TOKEN, { type: 'submit' });
  await sleep(300);
  fs.appendFileSync(path.join(stateDir, 'events'), '{"type":"comm');
  const events = await (await get('/events')).json();
  assert.deepStrictEqual(events.map(e => e.type), ['comment', 'submit']);
  assert.strictEqual(events[0].comment, 'first');
});

const RING_WAIT_MS = 1000;
const NO_RING_WAIT_MS = 3000;

function startRingServer(extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-ring-'));
  const callsFile = path.join(dir, 'cmux-calls');
  const stub = path.join(dir, 'cmux-stub.sh');
  const exitCode = extraEnv.STUB_EXIT || '0';
  fs.writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$*" >> "' + callsFile + '"\nexit ' + exitCode + '\n', { mode: 0o755 });
  const token = 'c'.repeat(64);
  const p = spawnServer(dir, token, { MDREVIEW_CMUX_BIN: stub, ...extraEnv });
  let stdout = '';
  p.stdout.on('data', (d) => { stdout += d.toString(); });
  return { p, token, callsFile, stateDir: path.join(dir, 'state'), stdout: () => stdout };
}

function readCalls(callsFile) {
  return fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf-8').trim().split('\n').filter(Boolean) : [];
}

async function waitForCall(callsFile, sinceMs) {
  while (readCalls(callsFile).length === 0 && Date.now() - sinceMs < RING_WAIT_MS) await sleep(25);
  return readCalls(callsFile);
}

test('Given comments on two docs, when one doc is submitted, then its ring counts only that doc', async () => {
  const ring = startRingServer({ CMUX_SURFACE_ID: 'test-surface' });
  try {
    const info = await waitForStart(ring.p);
    const send = (e) => sendReviewEvent(info.port, ring.token, e);
    await send({ type: 'comment', doc: '/d/a.md', blockIndex: 1, quote: 'q', comment: 'one' });
    await send({ type: 'comment', doc: '/d/b.md', scope: 'doc', comment: 'two' });
    await send({ type: 'comment', doc: '/d/a.md', blockIndex: 2, quote: 'q', comment: 'three' });
    await sleep(2500);
    assert.deepStrictEqual(readCalls(ring.callsFile), [], 'rang before submit');
    const submittedAt = Date.now();
    await send({ type: 'submit', doc: '/d/a.md' });
    assert.deepStrictEqual(await waitForCall(ring.callsFile, submittedAt), [
      'notify --surface test-surface --title Review feedback --body 2 comments on a.md --desktop false'
    ]);
    await send({ type: 'submit', doc: '/d/b.md' });
    await sleep(500);
    assert.strictEqual(readCalls(ring.callsFile)[1],
      'notify --surface test-surface --title Review feedback --body 1 comment on b.md --desktop false');
  } finally { ring.p.kill(); }
});

test('Given cmux, when a doc is approved, then one ring names the approval', async () => {
  const ring = startRingServer({ CMUX_SURFACE_ID: 'test-surface' });
  try {
    const info = await waitForStart(ring.p);
    const approvedAt = Date.now();
    await sendReviewEvent(info.port, ring.token, { type: 'approve', doc: '/d/b.md' });
    assert.deepStrictEqual(await waitForCall(ring.callsFile, approvedAt), [
      'notify --surface test-surface --title Review feedback --body 1 approval on b.md --desktop false'
    ]);
  } finally { ring.p.kill(); }
});

test('Given no CMUX_SURFACE_ID, when comments are submitted, then cmux is never called', async () => {
  const ring = startRingServer({});
  try {
    const info = await waitForStart(ring.p);
    await sendReviewEvent(info.port, ring.token, { type: 'comment', doc: '/d/a.md', scope: 'doc', comment: 'x' });
    await sendReviewEvent(info.port, ring.token, { type: 'submit', doc: '/d/a.md' });
    await sleep(NO_RING_WAIT_MS);
    assert.deepStrictEqual(readCalls(ring.callsFile), []);
  } finally { ring.p.kill(); }
});

test('Given the cmux call fails, when comments are submitted, then the failure is logged and events kept', async () => {
  const ring = startRingServer({ CMUX_SURFACE_ID: 'test-surface', STUB_EXIT: '1' });
  try {
    const info = await waitForStart(ring.p);
    await sendReviewEvent(info.port, ring.token, { type: 'comment', doc: '/d/a.md', scope: 'doc', comment: 'kept' });
    await sendReviewEvent(info.port, ring.token, { type: 'submit', doc: '/d/a.md' });
    await sleep(RING_WAIT_MS);
    assert.match(ring.stdout(), /"type":"cmux-notify-failed"/);
    assert.match(fs.readFileSync(path.join(ring.stateDir, 'events'), 'utf-8'), /kept/);
  } finally { ring.p.kill(); }
});

// ===== revisions =====
// Scenarios: feature-work/markdown-review-history/scenarios/viewer-shows-revisions.feature

const FIRST_DRAFT = '# Plan\n\nFirst draft.\n';
const SECOND_DRAFT = '# Plan\n\nSecond draft.\n';
const NOTICE_TIMEOUT_MS = 2000;
// Longer than the 1s index poll plus slack, so a missed notice would have arrived.
const QUIET_PERIOD_MS = 3000;

function runScript(name, args) {
  return require('node:child_process').spawnSync('node', [path.join(SCRIPTS, name), ...args], { encoding: 'utf-8' });
}

// Serves a fresh doc through serve-doc.cjs and waits until the server lists it.
async function servedDoc(name, content) {
  const doc = path.join(docsDir, name);
  fs.writeFileSync(doc, content);
  const r = runScript('serve-doc.cjs', ['--session-dir', sessionDir, doc]);
  assert.strictEqual(r.status, 0, r.stderr);
  for (let waited = 0; waited < 3000; waited += 100) {
    const docs = await (await get('/docs')).json();
    const entry = docs.find(d => d.path === doc);
    if (entry) return { doc, id: entry.id };
    await sleep(100);
  }
  throw new Error('server never listed ' + doc);
}

// Collects every server→client message until close() is called.
function listen() {
  const port = Number(base.split(':').pop());
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/?key=' + TOKEN);
  const messages = [];
  ws.onmessage = (m) => messages.push(JSON.parse(m.data));
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { opened, messages, close: () => ws.close() };
}

async function waitForMessage(messages, matches, timeoutMs) {
  for (let waited = 0; waited < timeoutMs; waited += 50) {
    const found = messages.find(matches);
    if (found) return found;
    await sleep(50);
  }
  return null;
}

test('A revise pushes the new revision to the browser', async () => {
  const { doc, id } = await servedDoc('pushes.md', FIRST_DRAFT);
  const browser = listen();
  await browser.opened;
  fs.writeFileSync(doc, SECOND_DRAFT);

  const r = runScript('revise.cjs', ['--session-dir', sessionDir, doc]);

  assert.strictEqual(r.status, 0, r.stderr);
  const notice = await waitForMessage(browser.messages, m => m.type === 'revision' && m.id === id, NOTICE_TIMEOUT_MS);
  browser.close();
  assert.deepStrictEqual(notice, { type: 'revision', id, revision: 2 });
  assert.strictEqual(await (await get('/doc/' + id)).text(), SECOND_DRAFT);
});

test('Editing the file without revising changes nothing the operator sees', async () => {
  const { doc, id } = await servedDoc('unrevised.md', FIRST_DRAFT);
  const browser = listen();
  await browser.opened;

  fs.writeFileSync(doc, '# Plan\n\nHalf-done edit');

  const notice = await waitForMessage(browser.messages, m => m.id === id, QUIET_PERIOD_MS);
  browser.close();
  assert.strictEqual(notice, null);
  assert.strictEqual(await (await get('/doc/' + id)).text(), FIRST_DRAFT);
});

test('History survives a server restart', async () => {
  const { doc } = await servedDoc('restart.md', FIRST_DRAFT);
  fs.writeFileSync(doc, SECOND_DRAFT);
  assert.strictEqual(runScript('revise.cjs', ['--session-dir', sessionDir, doc]).status, 0);
  const newSession = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-restart-'));
  fs.writeFileSync(path.join(newSession, 'manifest.json'), '[]\n');
  const newToken = 'c'.repeat(64);
  const restarted = spawnServer(newSession, newToken);
  try {
    const info = await waitForStart(restarted);
    const r = runScript('serve-doc.cjs', ['--session-dir', newSession, doc]);
    assert.strictEqual(r.status, 0, r.stderr);
    await sleep(1000);

    const revisions = await (await fetch('http://127.0.0.1:' + info.port + '/revisions/0',
      { headers: { cookie: 'mdreview-key-' + info.port + '=' + newToken } })).json();

    assert.deepStrictEqual(revisions.map(e => e.revision), [1, 2]);
  } finally {
    restarted.kill();
  }
});

test('A doc whose history directory was deleted is reported, not silently re-created', async () => {
  const { doc, id } = await servedDoc('deleted-history.md', FIRST_DRAFT);
  fs.rmSync(path.join(docsDir, '.revisions', 'deleted-history.md'), { recursive: true });

  const r = await get('/doc/' + id);

  assert.strictEqual(r.status, 404);
  const body = await r.text();
  assert.ok(body.includes(doc), body);
  assert.match(body, /has no revisions/);
  assert.ok(!fs.existsSync(path.join(docsDir, '.revisions', 'deleted-history.md')));
});

test('deleting a revision index does not broadcast or crash', async () => {
  const { id } = await servedDoc('deleted-index.md', FIRST_DRAFT);
  const browser = listen();
  await browser.opened;

  fs.rmSync(path.join(docsDir, '.revisions', 'deleted-index.md', 'index.jsonl'));

  const notice = await waitForMessage(browser.messages, m => m.id === id, QUIET_PERIOD_MS);
  browser.close();
  assert.strictEqual(notice, null);
  assert.strictEqual((await get('/docs')).status, 200);
});

test('/doc/<id>/rev/<n> returns that revision and 404s a bad number', async () => {
  const { doc, id } = await servedDoc('by-number.md', FIRST_DRAFT);
  fs.writeFileSync(doc, SECOND_DRAFT);
  assert.strictEqual(runScript('revise.cjs', ['--session-dir', sessionDir, doc]).status, 0);

  assert.strictEqual(await (await get('/doc/' + id + '/rev/1')).text(), FIRST_DRAFT);
  assert.strictEqual(await (await get('/doc/' + id + '/rev/2')).text(), SECOND_DRAFT);
  assert.strictEqual((await get('/doc/' + id + '/rev/3')).status, 404);
  assert.strictEqual((await get('/doc/' + id + '/rev/0')).status, 404);
  assert.strictEqual((await get('/doc/' + id + '/rev/x')).status, 404);
});


test('recreated history after a deletion is announced', async () => {
  const { doc, id } = await servedDoc('recreated.md', FIRST_DRAFT);
  fs.writeFileSync(doc, SECOND_DRAFT);
  assert.strictEqual(runScript('revise.cjs', ['--session-dir', sessionDir, doc]).status, 0);
  await sleep(1500);
  fs.rmSync(path.join(docsDir, '.revisions', 'recreated.md'), { recursive: true });
  await sleep(1500);
  const browser = listen();
  await browser.opened;

  assert.strictEqual(runScript('revise.cjs', ['--session-dir', sessionDir, doc]).status, 0);

  const notice = await waitForMessage(browser.messages, m => m.type === 'revision' && m.id === id, NOTICE_TIMEOUT_MS);
  browser.close();
  assert.deepStrictEqual(notice, { type: 'revision', id, revision: 1 });
});

test('a revision file missing from the index is not served', async () => {
  const { id } = await servedDoc('unindexed.md', FIRST_DRAFT);
  fs.writeFileSync(path.join(docsDir, '.revisions', 'unindexed.md', '0002.rev'), 'crashed before indexing\n');

  assert.strictEqual((await get('/doc/' + id + '/rev/2')).status, 404);
});
