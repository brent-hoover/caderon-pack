// Scenarios: feature-work/markdown-review-history/scenarios/rich-diff.feature
// (diff-tree seam). Each scenario test is named exactly after its scenario.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const { diffMarkdown, diffGherkin, diffLines, carryForward } = require(path.join(SCRIPTS, 'revision-diff.cjs'));
const { parseGherkinBlocks } = require(path.join(SCRIPTS, 'gherkin.cjs'));

// A plain require() of marked.min.js returns nothing under the repo's
// "type": "module", so it runs in a context the way the browser runs it.
const marked = (() => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'marked.min.js'), 'utf-8'), context);
  return context.marked;
})();

const render = {
  blocks: (tokens) => marked.parser(tokens),
  inline: (tokens) => marked.Parser.parseInline(tokens)
};

function blocksOf(source) {
  return marked.lexer(source).filter(token => token.type !== 'space');
}

function diff(baseSource, targetSource) {
  return diffMarkdown(blocksOf(baseSource), blocksOf(targetSource), render);
}

function changedRuns(words) {
  return words.filter(run => run.op !== 'equal').map(run => ({ op: run.op, text: run.text }));
}

test('A changed word inside a paragraph is marked inline', () => {
  const tree = diff('The cache expires after 30 seconds.\n', 'The cache expires after 60 seconds.\n');

  assert.strictEqual(tree.nodes.length, 1);
  assert.strictEqual(tree.nodes[0].op, 'changed');
  assert.deepStrictEqual(changedRuns(tree.nodes[0].words),
    [{ op: 'removed', text: '30' }, { op: 'added', text: '60' }]);
});

test('A new section is shown as added', () => {
  const base = '# Plan\n\nIntro.\n\n## Scope\n\nThings.\n';
  const target = base + '\n## Risks\n\nPolling may miss writes.\n';

  const tree = diff(base, target);

  assert.deepStrictEqual(tree.nodes.map(n => n.op), ['equal', 'equal', 'equal', 'equal', 'added', 'added']);
  assert.deepStrictEqual(tree.nodes.slice(4).map(n => n.targetIndex), [4, 5]);
});

test('A removed paragraph is still shown, marked as removed', () => {
  const tree = diff('# Modes\n\nLegacy mode is supported.\n\nNew mode is default.\n',
    '# Modes\n\nNew mode is default.\n');

  assert.deepStrictEqual(tree.nodes.map(n => n.op), ['equal', 'removed', 'equal']);
  assert.strictEqual(tree.nodes[1].baseIndex, 1);
  assert.match(tree.nodes[1].base.raw, /Legacy mode is supported\./);
});

test('One changed list item is marked without marking its siblings', () => {
  const tree = diff('- alpha\n- beta\n- gamma\n', '- alpha\n- beta two\n- gamma\n');

  const list = tree.nodes[0];
  assert.strictEqual(list.op, 'changed');
  assert.deepStrictEqual(list.items.map(item => item.op), ['equal', 'changed', 'equal']);
  assert.deepStrictEqual(changedRuns(list.items[1].words), [{ op: 'added', text: ' two' }]);
});

test('One changed table cell is marked without marking the rest of the table', () => {
  const header = '| setting | value |\n|---|---|\n';
  const tree = diff(header + '| timeout | 30 |\n| retries | 3 |\n', header + '| timeout | 30 |\n| retries | 5 |\n');

  const table = tree.nodes[0];
  assert.strictEqual(table.op, 'changed');
  assert.deepStrictEqual(table.header.map(cell => cell.op), ['equal', 'equal']);
  assert.deepStrictEqual(table.rows.map(row => row.op), ['equal', 'changed']);
  assert.deepStrictEqual(table.rows[1].cells.map(cell => cell.op), ['equal', 'changed']);
  assert.deepStrictEqual(changedRuns(table.rows[1].cells[1].words),
    [{ op: 'removed', text: '3' }, { op: 'added', text: '5' }]);
});

test('Identical revisions show no change marking', () => {
  const source = '# Plan\n\n- a\n- b\n\n| k | v |\n|---|---|\n| x | 1 |\n';

  const tree = diff(source, source);

  assert.strictEqual(tree.isIdentical, true);
  assert.ok(tree.nodes.every(n => n.op === 'equal'));
});

test('A code fence change is marked per line', () => {
  const tree = diff('```\na = 1\nb = 2\n```\n', '```\na = 1\nb = 3\n```\n');

  const code = tree.nodes[0];
  assert.strictEqual(code.op, 'changed');
  assert.deepStrictEqual(code.lines.map(line => line.op), ['equal', 'changed']);
  assert.deepStrictEqual(changedRuns(code.lines[1].words),
    [{ op: 'removed', text: '2' }, { op: 'added', text: '3' }]);
});

test('emphasis is diffed as one word', () => {
  const tree = diff('Expires after **30 seconds** always.\n', 'Expires after **60 seconds** always.\n');

  assert.deepStrictEqual(changedRuns(tree.nodes[0].words),
    [{ op: 'removed', text: '**30 seconds**' }, { op: 'added', text: '**60 seconds**' }]);
});

test('a link is diffed as one word', () => {
  const tree = diff('Read [the old guide](https://a.example) first.\n', 'Read [the new guide](https://a.example) first.\n');

  assert.deepStrictEqual(changedRuns(tree.nodes[0].words), [
    { op: 'removed', text: '[the old guide](https://a.example)' },
    { op: 'added', text: '[the new guide](https://a.example)' }
  ]);
});

test('an inserted table row does not mark later rows', () => {
  const header = '| k | v |\n|---|---|\n';
  const tree = diff(header + '| a | 1 |\n| c | 3 |\n', header + '| a | 1 |\n| b | 2 |\n| c | 3 |\n');

  assert.deepStrictEqual(tree.nodes[0].rows.map(row => row.op), ['equal', 'added', 'equal']);
});

test('a changed reference-link definition marks the paragraph', () => {
  const tree = diff('See [docs][d].\n\n[d]: https://old.example\n', 'See [docs][d].\n\n[d]: https://new.example\n');

  assert.strictEqual(tree.isIdentical, false);
  assert.strictEqual(tree.nodes[0].op, 'changed');
  assert.deepStrictEqual(changedRuns(tree.nodes[0].words),
    [{ op: 'removed', text: '[docs][d]' }, { op: 'added', text: '[docs][d]' }]);
});

test('a blockquote edit is diffed inside the quote', () => {
  const tree = diff('> First point.\n>\n> Second point.\n', '> First point.\n>\n> Second point, revised.\n');

  const quote = tree.nodes[0];
  assert.strictEqual(quote.op, 'changed');
  assert.deepStrictEqual(quote.children.map(n => n.op), ['equal', 'changed']);
  assert.deepStrictEqual(changedRuns(quote.children[1].words),
    [{ op: 'removed', text: 'point.' }, { op: 'added', text: 'point, revised.' }]);
});

test('a checked task item is a changed item', () => {
  const tree = diff('- [ ] Ship\n- [ ] Test\n', '- [x] Ship\n- [ ] Test\n');

  assert.strictEqual(tree.isIdentical, false);
  assert.deepStrictEqual(tree.nodes[0].items.map(item => item.op), ['changed', 'equal']);
  assert.strictEqual(tree.nodes[0].items[0].replaced, true);
});

test('moving an escaped pipe between cells is a changed row', () => {
  const header = '| a | b |\n|---|---|\n';
  const tree = diff(header + '| x\\|y | z |\n', header + '| x | y\\|z |\n');

  assert.deepStrictEqual(tree.nodes[0].rows.map(row => row.op), ['changed']);
  assert.deepStrictEqual(tree.nodes[0].rows[0].cells.map(cell => cell.op), ['changed', 'changed']);
});

const LOGIN_FEATURE = 'Feature: Login\n\n' +
  '  Scenario: Good password\n    Given a user\n    Then the user sees the dashboard\n\n' +
  '  Scenario: Bad password\n    Then an error shows\n';

function gherkinDiff(baseSource, targetSource) {
  return diffGherkin(parseGherkinBlocks(baseSource), parseGherkinBlocks(targetSource));
}

test('A Gherkin step change is marked inside its scenario', () => {
  const tree = gherkinDiff(LOGIN_FEATURE, LOGIN_FEATURE.replace('the dashboard', 'the welcome page'));

  assert.deepStrictEqual(tree.nodes.map(n => n.op), ['equal', 'changed', 'equal']);
  const changedLines = tree.nodes[1].lines.filter(line => line.op === 'changed');
  assert.strictEqual(changedLines.length, 1);
  assert.deepStrictEqual(changedRuns(changedLines[0].words),
    [{ op: 'removed', text: 'dashboard' }, { op: 'added', text: 'welcome page' }]);
});

test('A plain-text doc shows changed lines', () => {
  const lines = diffLines('host = local\nport = 8080\n', 'host = local\nport = 9090\n');

  assert.deepStrictEqual(lines.map(line => line.op), ['equal', 'changed', 'equal']);
  assert.deepStrictEqual(changedRuns(lines[1].words),
    [{ op: 'removed', text: '8080' }, { op: 'added', text: '9090' }]);
});

test('a renamed scenario pairs as changed', () => {
  const tree = gherkinDiff(LOGIN_FEATURE, LOGIN_FEATURE.replace('Scenario: Bad password', 'Scenario: Wrong password'));

  assert.deepStrictEqual(tree.nodes.map(n => n.op), ['equal', 'equal', 'changed']);
});

// ===== comment carry-forward =====
// Scenarios: feature-work/markdown-review-history/scenarios/comments-carry-forward.feature
// (logic seam). Anchors stand in for what the viewer reads off a rendered revision.

const COMMENTED = 'The cache expires after 30 seconds.';
const REVISION_1 = '# Cache\n\n' + COMMENTED + '\n\nEntries are evicted LRU.\n';
const REVISION_1_ANCHORS = [
  { index: 0, quote: 'Cache' },
  { index: 1, quote: COMMENTED },
  { index: 2, quote: 'Entries are evicted LRU.' }
];
const COMMENT_ON_REVISION_1 = { type: 'comment', view: 'rendered', revision: 1, blockIndex: 1, quote: COMMENTED, comment: 'too short' };

// Revision 1 and one later revision; the diff chain is the single step 1→2.
function carriedTo(revision2, event) {
  const chain = [diff(REVISION_1, revision2).nodes];
  const requestedRevisions = [];
  const outcome = carryForward(event,
    (revision) => { requestedRevisions.push(revision); return REVISION_1_ANCHORS; },
    () => chain);
  return { outcome, requestedRevisions };
}

test('A comment on changed text is shown as addressed', () => {
  const { outcome } = carriedTo(REVISION_1.replace('30 seconds', '60 seconds'), COMMENT_ON_REVISION_1);

  assert.deepStrictEqual(outcome, { state: 'addressed', revision: 2, index: 1 });
});

test('A comment on unchanged text is shown as still open', () => {
  const { outcome } = carriedTo(REVISION_1.replace('evicted LRU', 'evicted FIFO'), COMMENT_ON_REVISION_1);

  assert.deepStrictEqual(outcome, { state: 'open', index: 1 });
});

test('A comment on removed text is shown as addressed by removal', () => {
  const { outcome } = carriedTo(REVISION_1.replace(COMMENTED + '\n\n', ''), COMMENT_ON_REVISION_1);

  assert.deepStrictEqual(outcome, { state: 'removed', revision: 2, afterIndex: 0 });
});

test('A comment from an older viewer without a revision is treated as revision 1', () => {
  const event = Object.assign({}, COMMENT_ON_REVISION_1);
  delete event.revision;

  const { outcome, requestedRevisions } = carriedTo(REVISION_1.replace('30 seconds', '60 seconds'), event);

  assert.deepStrictEqual(requestedRevisions, [1]);
  assert.deepStrictEqual(outcome, { state: 'addressed', revision: 2, index: 1 });
});

test('A comment whose anchor cannot be found in its own revision is shown at doc level', () => {
  const event = Object.assign({}, COMMENT_ON_REVISION_1, { quote: 'Text that was never in revision 1.' });

  const { outcome } = carriedTo(REVISION_1, event);

  assert.deepStrictEqual(outcome, { state: 'unanchored' });
});

