const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const TOKEN = 'a'.repeat(64);

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
  assert.match(body, /marked/);
  assert.match(body, /refreshDocs/);
});

test('/docs lists manifest entries with ids and mtimes', async () => {
  const docs = await (await get('/docs')).json();
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].id, 0);
  assert.ok(docs[0].path.endsWith('/plan.md'));
  assert.strictEqual(typeof docs[0].mtime, 'number');
});

test('/doc/<id> returns raw markdown', async () => {
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

const RING_SETTLE_MAX_MS = 3000;

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

test('Given cmux, when a burst of 3 comments and 1 approve arrives, then one ring summarises it', async () => {
  const ring = startRingServer({ CMUX_SURFACE_ID: 'test-surface' });
  try {
    const info = await waitForStart(ring.p);
    const send = (e) => sendReviewEvent(info.port, ring.token, e);
    await send({ type: 'comment', doc: '/d/a.md', blockIndex: 1, quote: 'q', comment: 'one' });
    await send({ type: 'comment', doc: '/d/a.md', blockIndex: 2, quote: 'q', comment: 'two' });
    await send({ type: 'comment', doc: '/d/a.md', scope: 'doc', comment: 'three' });
    await send({ type: 'approve', doc: '/d/b.md' });
    const lastSent = Date.now();
    await sleep(1700);
    assert.deepStrictEqual(readCalls(ring.callsFile), [], 'rang before the quiet window ended');
    while (readCalls(ring.callsFile).length === 0 && Date.now() - lastSent < RING_SETTLE_MAX_MS) await sleep(50);
    assert.ok(Date.now() - lastSent < RING_SETTLE_MAX_MS, 'no ring within 3s of the last event');
    await sleep(500);
    assert.deepStrictEqual(readCalls(ring.callsFile), [
      'notify --surface test-surface --title Review feedback --body 3 comments, 1 approval on a.md, b.md --desktop false'
    ]);
  } finally { ring.p.kill(); }
});

test('Given no CMUX_SURFACE_ID, when a comment arrives, then cmux is never called', async () => {
  const ring = startRingServer({});
  try {
    const info = await waitForStart(ring.p);
    await sendReviewEvent(info.port, ring.token, { type: 'comment', doc: '/d/a.md', scope: 'doc', comment: 'x' });
    await sleep(RING_SETTLE_MAX_MS);
    assert.deepStrictEqual(readCalls(ring.callsFile), []);
  } finally { ring.p.kill(); }
});

test('Given the cmux call fails, when a comment arrives, then the failure is logged and the event kept', async () => {
  const ring = startRingServer({ CMUX_SURFACE_ID: 'test-surface', STUB_EXIT: '1' });
  try {
    const info = await waitForStart(ring.p);
    await sendReviewEvent(info.port, ring.token, { type: 'comment', doc: '/d/a.md', scope: 'doc', comment: 'kept' });
    await sleep(RING_SETTLE_MAX_MS);
    assert.match(ring.stdout(), /"type":"cmux-notify-failed"/);
    assert.match(fs.readFileSync(path.join(ring.stateDir, 'events'), 'utf-8'), /kept/);
  } finally { ring.p.kill(); }
});
