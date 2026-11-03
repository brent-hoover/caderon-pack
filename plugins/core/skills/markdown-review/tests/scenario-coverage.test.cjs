// Every scenario of the markdown-review-history feature is proven somewhere:
// by a node:test test of the same name, or by a browser check listed in
// browser/scenarios.txt. Reads the feature dir, or its archived copy.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TESTS_DIR = __dirname;
const REPO_ROOT = path.join(TESTS_DIR, '..', '..', '..', '..', '..');
const FEATURE_SLUG = 'markdown-review-history';
const SCENARIO_DIRS = [
  path.join(REPO_ROOT, 'feature-work', FEATURE_SLUG, 'scenarios'),
  path.join(REPO_ROOT, 'feature-work', 'archived', FEATURE_SLUG, 'scenarios')
];
const TEST_NAME_PATTERN = /\btest\('((?:[^'\\]|\\.)*)'/g;

function scenarioNames() {
  const dir = SCENARIO_DIRS.find(candidate => fs.existsSync(candidate));
  assert.ok(dir, 'no scenarios found in ' + SCENARIO_DIRS.join(' or '));
  return fs.readdirSync(dir).filter(name => name.endsWith('.feature')).flatMap(name =>
    fs.readFileSync(path.join(dir, name), 'utf-8').split('\n')
      .map(line => line.match(/^\s*Scenario:\s*(.+?)\s*$/))
      .filter(Boolean)
      .map(match => name + ': ' + match[1]));
}

function nodeTestNames() {
  return fs.readdirSync(TESTS_DIR).filter(name => name.endsWith('.test.cjs')).flatMap(name =>
    Array.from(fs.readFileSync(path.join(TESTS_DIR, name), 'utf-8').matchAll(TEST_NAME_PATTERN))
      .map(match => match[1].replace(/\\(.)/g, '$1')));
}

test('every scenario has a test', () => {
  const browserChecks = fs.readFileSync(path.join(TESTS_DIR, 'browser', 'scenarios.txt'), 'utf-8').split('\n');
  const proven = new Set(nodeTestNames().concat(browserChecks));

  const unproven = scenarioNames().filter(scenario => !proven.has(scenario.slice(scenario.indexOf(': ') + 2)));

  assert.deepStrictEqual(unproven, []);
});
