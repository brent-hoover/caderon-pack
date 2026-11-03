// Scenarios: feature-work/markdown-review-history/scenarios/revise-records-revisions.feature
// Each test is named exactly after its scenario.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const SERVE_DOC = path.join(SCRIPTS, 'serve-doc.cjs');
const REVISE = path.join(SCRIPTS, 'revise.cjs');
const FIRST_DRAFT = '# Plan\n\nFirst draft.\n';
const SECOND_DRAFT = '# Plan\n\nSecond draft.\n';

// A project with a live-looking session (state/server-info present) and
// feature-work/demo/plan.md holding the first draft.
function liveProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-revise-'));
  const session = path.join(root, 'session');
  fs.mkdirSync(path.join(session, 'state'), { recursive: true });
  fs.writeFileSync(path.join(session, 'state', 'server-info'), '{}\n');
  fs.writeFileSync(path.join(session, 'manifest.json'), '[]\n');
  const docDir = path.join(root, 'feature-work', 'demo');
  fs.mkdirSync(docDir, { recursive: true });
  const doc = path.join(docDir, 'plan.md');
  fs.writeFileSync(doc, FIRST_DRAFT);
  return { root, session, doc, history: path.join(docDir, '.revisions', 'plan.md') };
}

function run(script, project, docPath) {
  return spawnSync('node', [script, '--session-dir', project.session, docPath],
    { cwd: project.root, encoding: 'utf-8' });
}

function served(project) {
  const r = run(SERVE_DOC, project, project.doc);
  assert.strictEqual(r.status, 0, r.stderr);
  return r;
}

function resultLines(stdout) {
  return stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function indexLines(project) {
  return fs.readFileSync(path.join(project.history, 'index.jsonl'), 'utf-8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('Serving a doc for review records it as revision 1', () => {
  const project = liveProject();

  served(project);

  assert.strictEqual(fs.readFileSync(path.join(project.history, '0001.rev'), 'utf-8'), FIRST_DRAFT);
  const index = indexLines(project);
  assert.strictEqual(index.length, 1);
  assert.strictEqual(index[0].revision, 1);
  assert.strictEqual(index[0].sha256, crypto.createHash('sha256').update(FIRST_DRAFT).digest('hex'));
});

test('Revising changed content records the next revision', () => {
  const project = liveProject();
  served(project);
  fs.writeFileSync(project.doc, SECOND_DRAFT);

  const r = run(REVISE, project, project.doc);

  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(path.join(project.history, '0002.rev'), 'utf-8'), SECOND_DRAFT);
  assert.deepStrictEqual(resultLines(r.stdout), [{ type: 'revised', doc: project.doc, revision: 2 }]);
});

test('Revising unchanged content records nothing', () => {
  const project = liveProject();
  served(project);

  const r = run(REVISE, project, project.doc);

  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(indexLines(project).length, 1);
  assert.deepStrictEqual(resultLines(r.stdout), [{ type: 'unchanged', doc: project.doc, revision: 1 }]);
});

test('Serving an already-served doc again does not add a revision', () => {
  const project = liveProject();
  served(project);

  served(project);

  assert.strictEqual(indexLines(project).length, 1);
});

test('Revising a doc that was never served is rejected', () => {
  const project = liveProject();
  const other = path.join(path.dirname(project.doc), 'other.md');
  fs.writeFileSync(other, '# Other\n');

  const r = run(REVISE, project, other);

  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /other\.md/);
  assert.match(r.stderr, /serve-doc/);
  assert.ok(!fs.existsSync(path.join(path.dirname(project.doc), '.revisions', 'other.md')));
});

test('Revising a missing file is rejected', () => {
  const project = liveProject();
  served(project);
  fs.rmSync(project.doc);

  const r = run(REVISE, project, project.doc);

  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes(project.doc), r.stderr);
  assert.strictEqual(indexLines(project).length, 1);
});
