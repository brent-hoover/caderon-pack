const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVE_DOC = path.join(__dirname, '..', 'scripts', 'serve-doc.cjs');

function run(args, cwd) {
  return spawnSync('node', [SERVE_DOC, ...args], { cwd, encoding: 'utf-8' });
}

test('appends resolved paths to the manifest, deduped, preserving order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-sd-'));
  const session = path.join(dir, 'session');
  fs.mkdirSync(path.join(session, 'state'), { recursive: true });
  fs.writeFileSync(path.join(session, 'state', 'server-info'), '{}\n');
  fs.writeFileSync(path.join(session, 'manifest.json'), '[]\n');
  const a = path.join(dir, 'a.md');
  const b = path.join(dir, 'b.md');
  fs.writeFileSync(a, '# A\n');
  fs.writeFileSync(b, '# B\n');

  let r = run(['--session-dir', session, a], dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /"docs-added"/);
  r = run(['--session-dir', session, b, a], dir); // a is a duplicate
  assert.strictEqual(r.status, 0, r.stderr);

  const manifest = JSON.parse(fs.readFileSync(path.join(session, 'manifest.json'), 'utf-8'));
  assert.deepStrictEqual(manifest, [a, b]);
});

test('errors on a missing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-sd-'));
  const session = path.join(dir, 'session');
  fs.mkdirSync(path.join(session, 'state'), { recursive: true });
  fs.writeFileSync(path.join(session, 'state', 'server-info'), '{}\n');
  const r = run(['--session-dir', session, path.join(dir, 'nope.md')], dir);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /no such file|not a file/i);
});

test('errors when no live session exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-sd-'));
  const doc = path.join(dir, 'a.md');
  fs.writeFileSync(doc, '# A\n');
  const r = run([doc], dir); // no --session-dir, no .md-review/ in cwd
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /no live md-review session/i);
});

test('finds the newest live session under cwd/.md-review', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-sd-'));
  const old = path.join(dir, '.md-review', '100-1000');
  const fresh = path.join(dir, '.md-review', '200-2000');
  for (const s of [old, fresh]) {
    fs.mkdirSync(path.join(s, 'state'), { recursive: true });
    fs.writeFileSync(path.join(s, 'state', 'server-info'), '{}\n');
  }
  // stopped sessions are skipped even if newer-looking
  fs.writeFileSync(path.join(fresh, 'state', 'server-stopped'), '{}\n');
  const doc = path.join(dir, 'a.md');
  fs.writeFileSync(doc, '# A\n');
  const r = run([doc], dir);
  assert.strictEqual(r.status, 0, r.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(old, 'manifest.json'), 'utf-8'));
  assert.deepStrictEqual(manifest, [doc]);
});
