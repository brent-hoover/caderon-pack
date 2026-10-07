const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseGherkinBlocks } = require('../scripts/gherkin.cjs');

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.feature'), 'utf-8');
const blocks = parseGherkinBlocks(SAMPLE);

function lineKind(text) {
  for (const block of blocks) {
    const line = block.lines.find(l => l.text.trim() === text);
    if (line) return line.kind;
  }
  throw new Error('fixture has no line ' + JSON.stringify(text));
}

function blockContaining(text) {
  return blocks.find(b => b.lines.some(l => l.text.trim() === text));
}

test('Given the sample, when parsed, then blocks come in document order with header start lines', () => {
  assert.deepStrictEqual(
    blocks.map(b => [b.kind, b.startLine]),
    [['preamble', 1], ['feature', 5], ['background', 9], ['rule', 12], ['scenario', 16], ['scenario', 27]]
  );
});

test('Given scenarios, when parsed, then their titles are the text after the keyword', () => {
  const scenarios = blocks.filter(b => b.kind === 'scenario');
  assert.deepStrictEqual(scenarios.map(b => b.title), ['Each record carries its own reason', 'Splits name the split']);
  assert.strictEqual(blocks[1].title, 'Every debit can be traced');
});

test('Given an outline, when parsed, then Examples and its table stay inside the outline block', () => {
  assert.strictEqual(blockContaining('Examples:'), blocks[5]);
  assert.strictEqual(blockContaining('| DENIED, DETECTED | split  |'), blocks[5]);
});

test('Given tags and comments right before a header, when parsed, then they belong to that block', () => {
  assert.strictEqual(blockContaining('@smoke'), blocks[4]);
  assert.strictEqual(blockContaining('# stage numbering is 1-based'), blocks[4]);
  assert.strictEqual(blockContaining('@attribution'), blocks[1]);
  assert.strictEqual(blockContaining('# sample.feature'), blocks[0]);
});

test('Given each kind of line, when parsed, then it gets the matching line kind', () => {
  assert.strictEqual(lineKind('Scenario: Each record carries its own reason'), 'keyword');
  assert.strictEqual(lineKind('Examples:'), 'keyword');
  assert.strictEqual(lineKind('Given a node (crescendo, plain, 6)'), 'step');
  assert.strictEqual(lineKind('When the node\'s loss is debited'), 'step');
  assert.strictEqual(lineKind('Then each record reads:'), 'step');
  assert.strictEqual(lineKind('And the debit names the routing table row'), 'step');
  assert.strictEqual(lineKind('* it lists the blamed axes'), 'step');
  assert.strictEqual(lineKind('| reasons          | target |'), 'table');
  assert.strictEqual(lineKind('@smoke'), 'tag');
  assert.strictEqual(lineKind('# stage numbering is 1-based'), 'comment');
  assert.strictEqual(lineKind('# not a comment, a doc string line'), 'docstring');
  assert.strictEqual(lineKind('"""'), 'docstring');
  assert.strictEqual(lineKind('As the operator'), 'text');
  assert.strictEqual(lineKind('this line matches no Gherkin keyword'), 'text');
  assert.ok(blocks.some(b => b.lines.some(l => l.kind === 'blank')));
});

test('Given any source, when parsed, then joining every line reproduces it exactly', () => {
  const rejoined = blocks.flatMap(b => b.lines.map(l => l.text)).join('\n');
  assert.strictEqual(rejoined, SAMPLE);
  const lineNos = blocks.flatMap(b => b.lines.map(l => l.lineNo));
  assert.deepStrictEqual(lineNos, lineNos.map((_, i) => i + 1));
});

test('Given a doc string containing the other fence, when parsed, then it closes only on its own fence', () => {
  const source = 'Feature: F\n  Scenario: S\n    Given text:\n      """\n      ```\n      # still doc string\n      """\n    # a real comment\n';
  const kinds = parseGherkinBlocks(source).flatMap(b => b.lines.map(l => l.kind));
  assert.deepStrictEqual(kinds, ['keyword', 'keyword', 'step', 'docstring', 'docstring', 'docstring', 'docstring', 'comment', 'blank']);
});
