const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUS_CJS = path.join(__dirname, '..', 'scripts', 'bus.cjs');

let busDir, fakeBin, cmuxLog;

function makeFakeCmux(exitCode = 0) {
  fs.writeFileSync(
    path.join(fakeBin, 'cmux'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CMUX_LOG"\nexit ' + exitCode + '\n',
    { mode: 0o755 }
  );
}

function run(args, opts = {}) {
  return spawnSync('node', [BUS_CJS, ...args], {
    encoding: 'utf-8',
    input: opts.input,
    env: {
      ...process.env,
      PATH: fakeBin + path.delimiter + process.env.PATH,
      AGENT_BUS_DIR: busDir,
      CMUX_LOG: cmuxLog,
      CMUX_SURFACE_ID: opts.surface ?? 'SURF-A',
      CMUX_WORKSPACE_ID: opts.workspace ?? 'WS-A',
      ...(opts.noCmuxEnv ? { CMUX_SURFACE_ID: '', CMUX_WORKSPACE_ID: '' } : {})
    }
  });
}

function registry() {
  return JSON.parse(fs.readFileSync(path.join(busDir, 'registry.json'), 'utf-8'));
}

function cmuxCalls() {
  try { return fs.readFileSync(cmuxLog, 'utf-8').trim().split('\n').filter(Boolean); }
  catch (e) { return []; }
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bus-test-'));
  busDir = path.join(root, 'bus');
  fakeBin = path.join(root, 'bin');
  cmuxLog = path.join(root, 'cmux.log');
  fs.mkdirSync(fakeBin, { recursive: true });
  makeFakeCmux(0);
});

test('register writes a registry entry and prints it', () => {
  const r = run(['register', 'alpha']);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.type, 'registered');
  assert.strictEqual(registry().alpha.surface, 'SURF-A');
  assert.strictEqual(registry().alpha.workspace, 'WS-A');
  assert.strictEqual(typeof registry().alpha.registered_at, 'number');
});

test('register fails outside cmux', () => {
  const r = run(['register', 'alpha'], { noCmuxEnv: true });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not running inside cmux/i);
});

test('register rejects invalid names', () => {
  const r = run(['register', 'bad name!']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /invalid name/i);
});

test('duplicate name from another surface fails without --force', () => {
  assert.strictEqual(run(['register', 'alpha']).status, 0);
  const r = run(['register', 'alpha'], { surface: 'SURF-B' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /taken/i);
  assert.strictEqual(run(['register', 'alpha', '--force'], { surface: 'SURF-B' }).status, 0);
  assert.strictEqual(registry().alpha.surface, 'SURF-B');
});

test('same surface may re-register its own name', () => {
  assert.strictEqual(run(['register', 'alpha']).status, 0);
  assert.strictEqual(run(['register', 'alpha']).status, 0);
});

test('unregister removes the entry', () => {
  run(['register', 'alpha']);
  const r = run(['unregister', 'alpha']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(registry(), {});
});

test('list --json prints the registry', () => {
  run(['register', 'alpha']);
  const r = run(['list', '--json']);
  assert.strictEqual(r.status, 0);
  assert.ok(JSON.parse(r.stdout).alpha);
});

test('send appends to inbox and doorbells via cmux send + send-key enter', () => {
  run(['register', 'alpha']);
  run(['register', 'beta'], { surface: 'SURF-B', workspace: 'WS-B' });
  const r = run(['send', 'beta', 'hello', 'there']); // sender resolved as alpha via SURF-A
  assert.strictEqual(r.status, 0, r.stderr);
  const lines = fs.readFileSync(path.join(busDir, 'inbox', 'beta.jsonl'), 'utf-8').trim().split('\n');
  const msg = JSON.parse(lines[0]);
  assert.strictEqual(msg.from, 'alpha');
  assert.strictEqual(msg.to, 'beta');
  assert.strictEqual(msg.body, 'hello there');
  const calls = cmuxCalls();
  assert.strictEqual(calls.length, 2);
  assert.match(calls[0], /^send --workspace WS-B --surface SURF-B -- \[agent-bus\] New message from 'alpha'/);
  assert.match(calls[0], new RegExp('Read it with: node .*bus\\.cjs read beta'));
  assert.match(calls[1], /^send-key --workspace WS-B --surface SURF-B -- enter$/);
});

test('send with unregistered recipient fails', () => {
  run(['register', 'alpha']);
  const r = run(['send', 'ghost', 'hi']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not registered/i);
});

test('send from unregistered sender fails with a hint', () => {
  run(['register', 'beta'], { surface: 'SURF-B' });
  const r = run(['send', 'beta', 'hi']); // SURF-A never registered
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /register/i);
});

test('cmux failure keeps the message in the inbox and exits 1', () => {
  run(['register', 'alpha']);
  run(['register', 'beta'], { surface: 'SURF-B' });
  makeFakeCmux(1);
  const r = run(['send', 'beta', 'hi']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /doorbell failed/i);
  const lines = fs.readFileSync(path.join(busDir, 'inbox', 'beta.jsonl'), 'utf-8').trim().split('\n');
  assert.strictEqual(JSON.parse(lines[0]).body, 'hi');
});

test('multiline body via stdin round-trips and read truncates', () => {
  run(['register', 'alpha']);
  run(['register', 'beta'], { surface: 'SURF-B' });
  const body = 'line one\nline two\n```code```';
  assert.strictEqual(run(['send', 'beta', '-'], { input: body }).status, 0);
  const r = run(['read', 'beta', '--json'], { surface: 'SURF-B' });
  assert.strictEqual(r.status, 0);
  const msgs = JSON.parse(r.stdout);
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].body, body);
  assert.strictEqual(fs.readFileSync(path.join(busDir, 'inbox', 'beta.jsonl'), 'utf-8'), '');
});

test('read --peek does not consume; empty inbox reports none', () => {
  run(['register', 'alpha']);
  run(['register', 'beta'], { surface: 'SURF-B' });
  run(['send', 'beta', 'hi']);
  const peek = run(['read', 'beta', '--peek'], { surface: 'SURF-B' });
  assert.match(peek.stdout, /hi/);
  assert.notStrictEqual(fs.readFileSync(path.join(busDir, 'inbox', 'beta.jsonl'), 'utf-8').trim(), '');
  run(['read', 'beta'], { surface: 'SURF-B' });
  const empty = run(['read', 'beta'], { surface: 'SURF-B' });
  assert.match(empty.stdout, /no messages/i);
});
