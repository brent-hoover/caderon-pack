#!/usr/bin/env node
// Browser checks for the viewer, driven through agent-browser against a real
// server. node --test can't drive the DOM, so the viewer-side scenarios run
// here; scenarios.txt lists which scenario names this runner covers.
// Usage: node tests/browser/run.cjs [--only <check name>]
// Prints "ok <name>" / "not ok <name>: <reason>" per check; exits 1 if any fail.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
// A dedicated agent-browser session, so the operator's own browser session is
// never driven or closed by the tests.
const BROWSER_SESSION = 'mdreview-browser-tests';
// The server polls revision indexes every 1s; 5s covers a poll plus a fetch.
const WAIT_TIMEOUT_MS = 5000;
const WAIT_STEP_MS = 100;

const CHECKS = [
  { name: 'smoke', run: checkSmoke }
];

function main() {
  const onlyIndex = process.argv.indexOf('--only');
  const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
  const selected = CHECKS.filter(check => only === null || check.name === only);
  if (selected.length === 0) fail('no check named ' + JSON.stringify(only));
  let failures = 0;
  try {
    for (const check of selected) {
      try {
        check.run();
        console.log('ok ' + check.name);
      } catch (e) {
        failures++;
        console.log('not ok ' + check.name + ': ' + e.message);
      }
    }
  } finally {
    browser(['close']);
  }
  process.exit(failures === 0 ? 0 : 1);
}

function fail(message) {
  process.stderr.write('browser checks: ' + message + '\n');
  process.exit(1);
}

// ===== checks =====

function checkSmoke() {
  const review = startReview({ 'doc.md': '# Smoke\n\nFirst draft.\n\nSecond paragraph.\n' });
  try {
    review.open();
    review.waitFor('document.querySelectorAll("#doc .block").length === 3');
    browser(['click', '#doc .block:nth-child(2)']);
    browser(['fill', '.popover textarea', 'needs work']);
    browser(['click', '.popover .save']);
    browser(['click', '#submit-comments']);
    const comment = review.waitForEvent(e => e.type === 'comment' && e.comment === 'needs work');
    expectEqual(comment.quote, 'First draft.', 'comment quote');
    expectEqual(comment.blockIndex, 1, 'comment blockIndex');

    review.edit('doc.md', '# Smoke\n\nRevised draft.\n\nSecond paragraph.\n');
    review.revise('doc.md');
    review.waitFor('document.querySelector("#doc").textContent.includes("Revised draft.")');
  } finally {
    review.stop();
  }
}

// ===== review session =====

// A temp project with the given docs, a running server, and every doc served.
function startReview(docs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-browser-'));
  for (const [name, content] of Object.entries(docs)) fs.writeFileSync(path.join(root, name), content);
  const started = run(path.join(SCRIPTS, 'start-server.sh'), ['--project-dir', root]);
  const info = JSON.parse(started.stdout.trim().split('\n').pop());
  const docPath = name => path.join(root, name);
  for (const name of Object.keys(docs)) node('serve-doc.cjs', ['--session-dir', info.session_dir, docPath(name)]);
  const eventsFile = path.join(info.state_dir, 'events');
  return {
    open: () => browser(['open', info.url]),
    edit: (name, content) => fs.writeFileSync(docPath(name), content),
    revise: (name) => node('revise.cjs', ['--session-dir', info.session_dir, docPath(name)]),
    waitFor: (expression) => waitUntil(() => evaluate(expression) === true, expression),
    waitForEvent: (matches) => waitUntil(() => readEvents(eventsFile).find(matches), 'a matching event in ' + eventsFile),
    stop: () => run(path.join(SCRIPTS, 'stop-server.sh'), [info.session_dir])
  };
}

function readEvents(eventsFile) {
  if (!fs.existsSync(eventsFile)) return [];
  return fs.readFileSync(eventsFile, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// ===== plumbing =====

function waitUntil(probe, description) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const found = probe();
    if (found) return found;
    if (Date.now() >= deadline) throw new Error('timed out waiting for ' + description);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WAIT_STEP_MS);
  }
}

function evaluate(expression) {
  const output = browser(['eval', expression]).trim().split('\n').pop();
  return JSON.parse(output);
}

function browser(args) {
  return run('agent-browser', ['--session', BROWSER_SESSION].concat(args)).stdout;
}

function node(script, args) {
  return run('node', [path.join(SCRIPTS, script)].concat(args));
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(command + ' ' + args.join(' ') + ' exited ' + result.status + ': ' + result.stderr.trim());
  }
  return result;
}

function expectEqual(actual, expected, what) {
  if (actual !== expected) throw new Error(what + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

main();
