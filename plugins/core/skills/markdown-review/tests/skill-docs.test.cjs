// Scenarios: feature-work/markdown-review-history/scenarios/skill-instructions.feature
// SKILL.md is the agent's only instructions, so what it must say is checked here.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_DIR = path.join(__dirname, '..');
const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf-8');
const design = fs.readFileSync(path.join(SKILL_DIR, 'DESIGN.md'), 'utf-8');
// Prose wraps at any word, so phrases are matched with whitespace collapsed.
const skillProse = skill.replace(/\s+/g, ' ');

// The text of one "## " section, up to the next "## " heading.
function section(markdown, heading) {
  const start = markdown.indexOf('\n## ' + heading);
  assert.ok(start >= 0, 'missing section: ## ' + heading);
  const end = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, end < 0 ? undefined : end);
}

test('SKILL.md documents the revise command in the review loop', () => {
  const loop = section(skill, 'The review loop');

  assert.match(loop, /revise\.cjs --session-dir <session_dir>/);
  assert.ok(loop.indexOf('revise.cjs') < loop.indexOf('wait-for-feedback.cjs'),
    'revise must come before arming the watcher');
});

test('SKILL.md states that unrevised edits are not shown', () => {
  assert.match(skillProse, /not visible to the user until you run `?revise/i);
  assert.doesNotMatch(skill, /live-reload/i);
});

test('SKILL.md documents the revision field on events', () => {
  const events = section(skill, 'The review loop');
  const exampleLines = events.split('\n').filter(line => line.startsWith('{"type":'));
  for (const type of ['comment', 'approve']) {
    assert.ok(exampleLines.some(line => line.includes('"type":"' + type + '"') && line.includes('"revision":')),
      type + ' example lacks "revision"');
  }
  assert.match(skillProse, /approval is current only if its `revision` is the doc's latest revision, its `sha256` matches/i);
});

test('DESIGN.md covers revisions, history storage and the rich diff', () => {
  assert.match(design, /^## Revisions$/m);
  assert.match(design, /^## History storage$/m);
  assert.match(design, /^## Rich diff$/m);
  assert.match(design, /\.revisions\/<doc file name>\//);
});
