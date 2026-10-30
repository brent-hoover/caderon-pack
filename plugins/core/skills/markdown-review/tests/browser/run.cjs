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

// Check names match scenario names in
// feature-work/markdown-review-history/scenarios/*.feature.
const CHECKS = [
  { name: 'smoke', run: checkSmoke },
  { name: 'a details block keeps its markdown inside', run: checkDetailsBlock },
  { name: 'A changed word inside a paragraph is marked inline', run: checkInlineWordChange },
  { name: 'A new section is shown as added', run: checkAddedSection },
  { name: 'A removed paragraph is still shown, marked as removed', run: checkRemovedParagraph },
  { name: 'One changed list item is marked without marking its siblings', run: checkListItemChange },
  { name: 'One changed table cell is marked without marking the rest of the table', run: checkTableCellChange },
  { name: 'A Gherkin step change is marked inside its scenario', run: checkGherkinStepChange },
  { name: 'A plain-text doc shows changed lines', run: checkPlainTextChange },
  { name: 'Identical revisions show no change marking', run: checkIdenticalRevisions },
  { name: 'A code fence change is marked per line', run: checkCodeLineChange }
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

function checkDetailsBlock() {
  const review = startReview({ 'doc.md': '# Notes\n\n<details><summary>More</summary>\n\n- hidden item\n\n</details>\n\nAfter.\n' });
  try {
    review.open();
    review.waitFor('document.querySelectorAll("#doc .block").length === 3');
    expectEqual(evaluate('document.querySelectorAll("#doc details li").length'), 1, 'list items inside details');
    expectEqual(evaluate('document.querySelectorAll("#doc li").length'), 1, 'list items on the page');
  } finally {
    review.stop();
  }
}

// ===== rich diff =====

// Serves `name` with `base`, revises it to `target`, opens the viewer and
// waits for the 1→2 diff, then hands the page to `inspect`.
function withDiff(name, base, target, inspect) {
  const review = startReview({ [name]: base });
  try {
    review.edit(name, target);
    review.revise(name);
    review.open();
    review.waitFor('document.querySelector("#diffinfo").textContent.endsWith("revision 1 and revision 2")');
    inspect(review);
  } finally {
    review.stop();
  }
}

const TEXTS_OF = selector => 'Array.from(document.querySelectorAll(' + JSON.stringify(selector) + ')).map(el => el.textContent.trim())';

function checkInlineWordChange() {
  withDiff('doc.md', '# Cache\n\nThe cache expires after 30 seconds.\n', '# Cache\n\nThe cache expires after 60 seconds.\n', () => {
    expectDeep(evaluate(TEXTS_OF('#doc del.d-del')), ['30'], 'removed words');
    expectDeep(evaluate(TEXTS_OF('#doc ins.d-add')), ['60'], 'added words');
    expectEqual(evaluate('Array.from(document.querySelectorAll("#doc p")).filter(p => p.textContent.includes("The cache expires")).length'), 1, 'paragraphs shown');
  });
}

function checkAddedSection() {
  withDiff('doc.md', '# Plan\n\nIntro.\n', '# Plan\n\nIntro.\n\n## Risks\n\nPolling may miss writes.\n', () => {
    expectDeep(evaluate(TEXTS_OF('#doc .d-added')), ['Risks', 'Polling may miss writes.'], 'added blocks');
    expectEqual(evaluate('document.querySelectorAll("#doc .d-removed, #doc ins, #doc del").length'), 0, 'other change marks');
  });
}

function checkRemovedParagraph() {
  withDiff('doc.md', '# Modes\n\nLegacy mode is supported.\n\nNew mode is default.\n', '# Modes\n\nNew mode is default.\n', () => {
    expectDeep(evaluate(TEXTS_OF('#doc .d-removed')), ['Legacy mode is supported.'], 'removed blocks');
  });
}

function checkListItemChange() {
  withDiff('doc.md', '- alpha\n- beta\n- gamma\n', '- alpha\n- beta two\n- gamma\n', () => {
    expectEqual(evaluate('document.querySelectorAll("#doc li").length'), 3, 'list items');
    expectDeep(evaluate(TEXTS_OF('#doc ins.d-add')), ['two'], 'added words');
    expectEqual(evaluate('document.querySelectorAll("#doc li.d-added, #doc li.d-removed, #doc del").length'), 0, 'other change marks');
  });
}

function checkTableCellChange() {
  const header = '| setting | value |\n|---|---|\n';
  withDiff('doc.md', header + '| timeout | 30 |\n| retries | 3 |\n', header + '| timeout | 30 |\n| retries | 5 |\n', () => {
    expectDeep(evaluate(TEXTS_OF('#doc td del.d-del')), ['3'], 'removed words');
    expectDeep(evaluate(TEXTS_OF('#doc td ins.d-add')), ['5'], 'added words');
    expectEqual(evaluate('Array.from(document.querySelectorAll("#doc td")).filter(td => td.querySelector("ins, del")).length'), 1, 'changed cells');
  });
}

function checkGherkinStepChange() {
  const feature = 'Feature: Login\n\n  Scenario: Good password\n    Then the user sees the dashboard\n\n  Scenario: Bad password\n    Then an error shows\n';
  withDiff('login.feature', feature, feature.replace('the dashboard', 'the welcome page'), () => {
    expectDeep(evaluate(TEXTS_OF('#doc del.d-del')), ['dashboard'], 'removed words');
    expectDeep(evaluate(TEXTS_OF('#doc ins.d-add')), ['welcome page'], 'added words');
    expectEqual(evaluate('Array.from(document.querySelectorAll("#doc .gherkin-block")).filter(b => b.querySelector("ins, del")).length'), 1, 'changed blocks');
  });
}

function checkPlainTextChange() {
  withDiff('notes.txt', 'host = local\nport = 8080\n', 'host = local\nport = 9090\n', () => {
    expectDeep(evaluate(TEXTS_OF('#doc del.d-del')), ['8080'], 'removed words');
    expectDeep(evaluate(TEXTS_OF('#doc ins.d-add')), ['9090'], 'added words');
  });
}

// A trailing blank line changes the bytes (so revise records revision 2) but
// not the rendered doc.
function checkIdenticalRevisions() {
  withDiff('doc.md', '# Plan\n\nText.\n', '# Plan\n\nText.\n\n', () => {
    expectEqual(evaluate('document.querySelector("#diffinfo").textContent'), 'No changes between revision 1 and revision 2', 'header');
    expectEqual(evaluate('document.querySelectorAll("#doc .d-added, #doc .d-removed, #doc ins, #doc del").length'), 0, 'change marks');
  });
}

function checkCodeLineChange() {
  withDiff('doc.md', '```\na = 1\nb = 2\n```\n', '```\na = 1\nb = 3\n```\n', () => {
    expectDeep(evaluate(TEXTS_OF('#doc pre del.d-del')), ['2'], 'removed words');
    expectDeep(evaluate(TEXTS_OF('#doc pre ins.d-add')), ['3'], 'added words');
  });
}

// ===== review session =====

// A temp project with the given docs, a running server, and every doc served.
function startReview(docs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-browser-'));
  for (const [name, content] of Object.entries(docs)) fs.writeFileSync(path.join(root, name), content);
  // --background: under CODEX_CI the launcher otherwise runs in the
  // foreground and never returns.
  const started = run(path.join(SCRIPTS, 'start-server.sh'), ['--project-dir', root, '--background']);
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

// agent-browser prints an eval result as pretty JSON over several lines;
// stringifying in the page makes it one JSON string literal on one line.
function evaluate(expression) {
  const output = browser(['eval', 'JSON.stringify(' + expression + ')']).trim().split('\n').pop();
  return JSON.parse(JSON.parse(output));
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

function expectDeep(actual, expected, what) {
  expectEqual(JSON.stringify(actual), JSON.stringify(expected), what);
}

function expectEqual(actual, expected, what) {
  if (actual !== expected) throw new Error(what + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

main();
