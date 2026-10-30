const { test } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REVISIONS = path.join(__dirname, '..', 'scripts', 'revisions.cjs');
const { recordRevision, readIndex, readRevision, revisionDir } = require(REVISIONS);

const CONCURRENT_WRITERS = 5;

function tempDoc(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-rev-'));
  const doc = path.join(dir, 'plan.md');
  fs.writeFileSync(doc, content);
  return doc;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// A pid that is guaranteed dead: the child has already exited when spawnSync returns.
function deadPid() {
  return spawnSync('node', ['-e', '']).pid;
}

function recordInChildProcess(doc) {
  const script = `process.stdout.write(JSON.stringify(require(${JSON.stringify(REVISIONS)}).recordRevision(${JSON.stringify(doc)})))`;
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['-e', script]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))));
  });
}

test('concurrent revises record exactly one new revision', async () => {
  const doc = tempDoc('# Plan\n\nFirst draft.\n');

  const outcomes = await Promise.all(
    Array.from({ length: CONCURRENT_WRITERS }, () => recordInChildProcess(doc)));

  const revised = outcomes.filter(o => o.status === 'revised');
  const unchanged = outcomes.filter(o => o.status === 'unchanged');
  assert.strictEqual(revised.length, 1);
  assert.strictEqual(unchanged.length, CONCURRENT_WRITERS - 1);
  assert.ok(outcomes.every(o => o.revision === 1));
  const index = readIndex(doc);
  assert.deepStrictEqual(index.map(e => e.revision), [1]);
  assert.strictEqual(index[0].sha256, sha256(readRevision(doc, 1)));
});

test('a lock held by a dead pid fails with its path', () => {
  const doc = tempDoc('# Plan\n');
  recordRevision(doc);
  fs.writeFileSync(doc, '# Plan\n\nChanged.\n');
  const lockFile = path.join(revisionDir(doc), 'lock');
  const stalePid = deadPid();
  fs.writeFileSync(lockFile, String(stalePid));

  assert.throws(() => recordRevision(doc), (err) => {
    assert.match(err.message, new RegExp(escapeRegExp(lockFile)));
    assert.match(err.message, new RegExp('pid ' + stalePid));
    return true;
  });
  assert.deepStrictEqual(readIndex(doc).map(e => e.revision), [1]);
  assert.ok(!fs.existsSync(path.join(revisionDir(doc), '0002.rev')));
});

test('an interrupted index append is repaired', () => {
  const doc = tempDoc('# Plan\n');
  recordRevision(doc);
  const indexFile = path.join(revisionDir(doc), 'index.jsonl');
  fs.appendFileSync(indexFile, '{"revision":2,"timest');
  fs.writeFileSync(doc, '# Plan\n\nChanged.\n');

  const outcome = recordRevision(doc);

  assert.deepStrictEqual(outcome, { status: 'revised', revision: 2 });
  assert.deepStrictEqual(readIndex(doc).map(e => e.revision), [1, 2]);
  assert.ok(fs.readFileSync(indexFile, 'utf-8').split('\n').filter(Boolean).every(line => JSON.parse(line)));
});

test('a revision file only appears complete', () => {
  const doc = tempDoc('# Plan\n');
  recordRevision(doc);
  const leftover = path.join(revisionDir(doc), '0002.rev.tmp');
  fs.writeFileSync(leftover, '# Pla');
  fs.writeFileSync(doc, '# Plan\n\nSecond draft.\n');

  recordRevision(doc);

  assert.strictEqual(readRevision(doc, 2), '# Plan\n\nSecond draft.\n');
  assert.deepStrictEqual(fs.readdirSync(revisionDir(doc)).filter(name => name.endsWith('.tmp')), []);
});

test('unchanged content returns the latest revision', () => {
  const doc = tempDoc('# Plan\n');
  recordRevision(doc);

  const outcome = recordRevision(doc);

  assert.deepStrictEqual(outcome, { status: 'unchanged', revision: 1 });
  assert.strictEqual(readIndex(doc).length, 1);
});

test('recording a missing doc throws with its path', () => {
  const doc = tempDoc('# Plan\n');
  fs.rmSync(doc);

  assert.throws(() => recordRevision(doc), new RegExp('no such file: ' + escapeRegExp(doc)));
});
