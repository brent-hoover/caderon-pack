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
  { name: 'A code fence change is marked per line', run: checkCodeLineChange },
  { name: 'a removed table column is marked', run: checkRemovedTableColumn },
  { name: 'a task item keeps its checkbox when its text changes', run: checkTaskCheckboxKept },
  { name: 'a heading level change is marked', run: checkHeadingLevelChange },
  { name: 'a Gherkin table keeps its cells when a step changes', run: checkGherkinTableKept },
  { name: 'A newly revised doc opens in diff view against the previous revision', run: checkOpensInDiffView },
  { name: 'The operator switches from the diff to the full revised doc', run: checkSwitchToFullDocument },
  { name: 'The operator switches from the full revised doc back to the diff', run: checkSwitchBackToDiff },
  { name: 'The operator compares any two revisions', run: checkCompareAnyTwo },
  { name: 'The operator views changes since their approval', run: checkChangesSinceApproval },
  { name: 'A doc with only one revision has no diff', run: checkSingleRevision },
  { name: 'Choosing a base revision newer than the target is rejected', run: checkInvertedRangeRejected },
  { name: 'A comment on changed text is shown as addressed', run: checkCommentAddressed },
  { name: 'A comment on unchanged text is shown as still open', run: checkCommentOpen },
  { name: 'A comment on removed text is shown as addressed by removal', run: checkCommentRemoved },
  { name: 'A comment from an older viewer without a revision is treated as revision 1', run: checkCommentWithoutRevision },
  { name: 'A comment whose anchor cannot be found in its own revision is shown at doc level', run: checkCommentUnanchored },
  { name: 'An approval records the revision it approves', run: checkApprovalRecordsRevision },
  { name: 'A comment records the revision it was made on', run: checkCommentRecordsRevision },
  { name: 'An approval of an older revision is marked stale after a revise', run: checkStaleApproval },
  { name: 'Approving while viewing an older revision is not allowed', run: checkApproveOlderRevisionDisabled }
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

// Serves `name` with `base` and opens the viewer on it, then revises it to
// `target`: the viewer shows the 1→2 diff live. Hands the page to `inspect`.
function withDiff(name, base, target, inspect) {
  const review = startReview({ [name]: base });
  try {
    review.open();
    review.waitFor('document.querySelector("#revinfo").textContent === "Revision 1 of 1"');
    review.edit(name, target);
    review.revise(name);
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

function checkRemovedTableColumn() {
  withDiff('doc.md', '| k | v | note |\n|---|---|---|\n| a | 1 | old |\n', '| k | v |\n|---|---|\n| a | 2 |\n', () => {
    expectDeep(evaluate(TEXTS_OF('#doc th.d-removed, #doc td.d-removed')), ['note', 'old'], 'removed cells');
  });
}

function checkTaskCheckboxKept() {
  withDiff('doc.md', '- [x] Ship\n- [ ] Test\n', '- [x] Ship now\n- [ ] Test\n', () => {
    expectDeep(evaluate(TEXTS_OF('#doc ins.d-add')), ['now'], 'added words');
    expectEqual(evaluate('document.querySelectorAll("#doc li input[type=checkbox]").length'), 2, 'checkboxes');
    expectEqual(evaluate('document.querySelector("#doc li input[type=checkbox]").checked'), true, 'first checkbox checked');
  });
}

function checkHeadingLevelChange() {
  withDiff('doc.md', '# Cache\n\nText.\n', '## Cache\n\nText.\n', () => {
    expectEqual(evaluate('document.querySelectorAll("#doc .d-removed h1").length'), 1, 'removed h1');
    expectEqual(evaluate('document.querySelectorAll("#doc .d-added h2").length'), 1, 'added h2');
  });
}

function checkGherkinTableKept() {
  const feature = 'Feature: Login\n\n  Scenario: Users\n    Given these users\n      | name | role |\n      | ann  | admin |\n    Then they log in\n';
  withDiff('login.feature', feature, feature.replace('they log in', 'they all log in'), () => {
    expectEqual(evaluate('document.querySelectorAll("#doc .gherkin-table td").length'), 2, 'table body cells');
    expectDeep(evaluate(TEXTS_OF('#doc ins.d-add')), ['all'], 'added words');
  });
}

// ===== revision navigation =====

const PLAN_REVISIONS = ['# Plan\n\nFirst draft.\n', '# Plan\n\nSecond draft.\n', '# Plan\n\nThird draft.\n'];
const DIFF_INFO = 'document.querySelector("#diffinfo").textContent';
const CHANGE_MARKS = 'document.querySelectorAll("#doc .d-added, #doc .d-removed, #doc ins, #doc del").length';

// plan.md with revisions 1–3. The viewer was last open on revision 2, so it
// now opens on the 2→3 diff.
function withThreeRevisions(inspect) {
  const review = startReview({ 'plan.md': PLAN_REVISIONS[0] });
  try {
    review.edit('plan.md', PLAN_REVISIONS[1]);
    review.revise('plan.md');
    review.open();
    review.waitFor('document.querySelector("#revinfo").textContent === "Revision 2 of 2"');
    review.leave();
    review.edit('plan.md', PLAN_REVISIONS[2]);
    review.revise('plan.md');
    review.open();
    review.waitFor(DIFF_INFO + ' === "Changes between revision 2 and revision 3"');
    inspect(review);
  } finally {
    review.stop();
  }
}

function chooseRevision(selectId, revision) {
  evaluate('(() => { const s = document.querySelector("#' + selectId + '"); s.value = "' + revision + '"; ' +
    's.dispatchEvent(new Event("change")); return true; })()');
}

function checkOpensInDiffView() {
  withThreeRevisions(() => {
    expectEqual(evaluate('document.querySelector("#revinfo").textContent'), 'Revision 3 of 3', 'revision header');
    expectDeep(evaluate(TEXTS_OF('#doc ins.d-add')), ['Third'], 'added words');
  });
}

function checkSwitchToFullDocument() {
  withThreeRevisions(review => {
    browser(['click', '#diff-toggle']);
    review.waitFor(DIFF_INFO + ' === ""');
    expectEqual(evaluate(CHANGE_MARKS), 0, 'change marks');
    expectEqual(evaluate('document.querySelector("#doc").textContent.includes("Third draft.")'), true, 'revision 3 text');
  });
}

function checkSwitchBackToDiff() {
  withThreeRevisions(review => {
    browser(['click', '#diff-toggle']);
    review.waitFor(DIFF_INFO + ' === ""');
    browser(['click', '#diff-toggle']);
    review.waitFor(DIFF_INFO + ' === "Changes between revision 2 and revision 3"');
  });
}

function checkCompareAnyTwo() {
  withThreeRevisions(review => {
    chooseRevision('base-revision', 1);
    review.waitFor(DIFF_INFO + ' === "Changes between revision 1 and revision 3"');
    expectDeep(evaluate(TEXTS_OF('#doc del.d-del')), ['First'], 'removed words');
  });
}

function checkChangesSinceApproval() {
  const review = startReview({ 'plan.md': PLAN_REVISIONS[0] });
  try {
    review.appendEvent({ type: 'approve', doc: review.docPath('plan.md'), revision: 1,
      sha256: review.indexEntries('plan.md')[0].sha256, timestamp: Date.now() });
    review.edit('plan.md', PLAN_REVISIONS[1]);
    review.revise('plan.md');
    review.edit('plan.md', PLAN_REVISIONS[2]);
    review.revise('plan.md');
    review.open();
    review.waitFor('document.querySelector("#since-approved").textContent === "Changes since approved (rev 1)"');
    browser(['click', '#since-approved']);
    review.waitFor(DIFF_INFO + ' === "Changes between revision 1 and revision 3"');
  } finally {
    review.stop();
  }
}

function checkSingleRevision() {
  const review = startReview({ 'intro.md': '# Intro\n\nOnly draft.\n' });
  try {
    review.open();
    review.waitFor('document.querySelector("#revinfo").textContent === "Revision 1 of 1"');
    expectEqual(evaluate('document.querySelector("#diff-toggle").disabled'), true, 'Show changes disabled');
    expectEqual(evaluate(CHANGE_MARKS), 0, 'change marks');
  } finally {
    review.stop();
  }
}

function checkInvertedRangeRejected() {
  withThreeRevisions(review => {
    chooseRevision('base-revision', 1);
    review.waitFor(DIFF_INFO + ' === "Changes between revision 1 and revision 3"');
    chooseRevision('target-revision', 1);
    review.waitFor('document.querySelector("#toast").textContent === "Base revision must be older than the target"');
    expectEqual(evaluate(DIFF_INFO), 'Changes between revision 1 and revision 3', 'comparison kept');
    expectEqual(evaluate('document.querySelector("#target-revision").value'), '3', 'target select restored');
  });
}

// ===== comments carried forward =====

const COMMENTED = 'The cache expires after 30 seconds.';
const CACHE_REVISION_1 = '# Cache\n\n' + COMMENTED + '\n\nEntries are evicted LRU.\n';
const COMMENT_CARDS = 'Array.from(document.querySelectorAll("#doc .comment-cards")).map(cards => ({ ' +
  'block: cards.previousElementSibling.textContent.trim(), ' +
  'statuses: Array.from(cards.querySelectorAll(".status-badge")).map(badge => badge.textContent) }))';

// The operator commented "too short" on the 30-seconds paragraph of revision
// 1 and submitted it; the agent then revised the doc to `revision2`.
function withCarriedComment(revision2, commentFields, inspect) {
  const review = startReview({ 'cache.md': CACHE_REVISION_1 });
  try {
    const doc = review.docPath('cache.md');
    review.appendEvent(Object.assign({ type: 'comment', doc: doc, view: 'rendered', revision: 1, blockIndex: 1,
      quote: COMMENTED, selection: null, comment: 'too short', timestamp: Date.now() }, commentFields));
    review.appendEvent({ type: 'submit', doc: doc, timestamp: Date.now() });
    review.edit('cache.md', revision2);
    review.revise('cache.md');
    review.open();
    review.waitFor('document.querySelector("#revinfo").textContent === "Revision 2 of 2"');
    inspect(review);
  } finally {
    review.stop();
  }
}

function checkCommentAddressed() {
  withCarriedComment(CACHE_REVISION_1.replace('30 seconds', '60 seconds'), {}, () => {
    expectDeep(evaluate(COMMENT_CARDS), [{ block: 'The cache expires after 60 seconds.', statuses: ['addressed in revision 2'] }], 'comment cards');
  });
}

function checkCommentOpen() {
  withCarriedComment(CACHE_REVISION_1.replace('evicted LRU', 'evicted FIFO'), {}, () => {
    expectDeep(evaluate(COMMENT_CARDS), [{ block: COMMENTED, statuses: ['open'] }], 'comment cards');
  });
}

function checkCommentRemoved() {
  withCarriedComment(CACHE_REVISION_1.replace(COMMENTED + '\n\n', ''), {}, () => {
    expectDeep(evaluate(COMMENT_CARDS), [{ block: 'Cache', statuses: ['addressed in revision 2 (text removed)'] }], 'comment cards');
  });
}

function checkCommentWithoutRevision() {
  withCarriedComment(CACHE_REVISION_1.replace('30 seconds', '60 seconds'), { revision: undefined }, () => {
    expectDeep(evaluate(COMMENT_CARDS), [{ block: 'The cache expires after 60 seconds.', statuses: ['addressed in revision 2'] }], 'comment cards');
  });
}

function checkCommentUnanchored() {
  withCarriedComment(CACHE_REVISION_1.replace('30 seconds', '60 seconds'), { quote: 'Text that was never in revision 1.' }, () => {
    expectDeep(evaluate(COMMENT_CARDS), [], 'inline comment cards');
    expectEqual(evaluate('document.querySelector("#doc-comments").textContent.includes("Anchor not found")'), true, 'doc-level note');
  });
}

// ===== feedback carries the revision =====

// plan.md with revisions 1 and 2, opened on revision 2.
function withTwoRevisions(inspect) {
  const review = startReview({ 'plan.md': PLAN_REVISIONS[0] });
  try {
    review.edit('plan.md', PLAN_REVISIONS[1]);
    review.revise('plan.md');
    review.open();
    review.waitFor('document.querySelector("#revinfo").textContent === "Revision 2 of 2"');
    inspect(review);
  } finally {
    review.stop();
  }
}

function checkApprovalRecordsRevision() {
  withTwoRevisions(review => {
    browser(['click', '#approve']);
    review.waitForEvent(e => e.type === 'approve');
    const delivered = review.collectFeedback();
    expectEqual(delivered.status, 0, 'watcher exit code');
    const approval = delivered.events.find(e => e.type === 'approve');
    expectEqual(approval && approval.revision, 2, 'approved revision');
  });
}

function checkCommentRecordsRevision() {
  withTwoRevisions(review => {
    browser(['click', '#doc .block:nth-child(2)']);
    browser(['fill', '.popover textarea', 'clarify']);
    browser(['click', '.popover .save']);
    browser(['click', '#submit-comments']);
    review.waitForEvent(e => e.type === 'submit');
    const delivered = review.collectFeedback();
    expectEqual(delivered.status, 0, 'watcher exit code');
    const comment = delivered.events.find(e => e.type === 'comment');
    expectEqual(comment && comment.revision, 2, 'comment revision');
    expectDeep(['view', 'blockIndex', 'quote', 'selection'].filter(key => !(key in comment)), [], 'missing fields');
  });
}

function checkStaleApproval() {
  withTwoRevisions(review => {
    browser(['click', '#approve']);
    review.waitFor('document.querySelectorAll("#doclist .check").length === 1');
    review.edit('plan.md', PLAN_REVISIONS[2]);
    review.revise('plan.md');
    review.waitFor('document.querySelector("#revinfo").textContent === "Revision 3 of 3"');
    expectEqual(evaluate('document.querySelectorAll("#doclist .check").length'), 0, 'sidebar approval marks');
    expectEqual(evaluate('document.querySelector("#since-approved").textContent'), 'Changes since approved (rev 2)', 'since-approved control');
  });
}

function checkApproveOlderRevisionDisabled() {
  withTwoRevisions(review => {
    chooseRevision('target-revision', 1);
    review.waitFor('document.querySelector("#revinfo").textContent === "Revision 1 of 2"');
    expectEqual(evaluate('document.querySelector("#approve").disabled'), true, 'Approve disabled');
    expectEqual(evaluate('document.querySelector("#approve").title'), 'Approve the latest revision', 'Approve hint');
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
    // Navigate away so the next open() is a fresh page load on the same origin.
    leave: () => browser(['open', 'about:blank']),
    docPath: docPath,
    indexEntries: (name) => fs.readFileSync(path.join(root, '.revisions', name, 'index.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line)),
    appendEvent: (event) => fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n'),
    // What the agent's watcher delivers: it exits as soon as there is a
    // submitted batch or an approval it hasn't delivered yet.
    collectFeedback: () => {
      const result = spawnSync('node', [path.join(SCRIPTS, 'wait-for-feedback.cjs'), '--session-dir', info.session_dir],
        { encoding: 'utf-8', timeout: WAIT_TIMEOUT_MS });
      return { status: result.status, events: result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)) };
    },
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
