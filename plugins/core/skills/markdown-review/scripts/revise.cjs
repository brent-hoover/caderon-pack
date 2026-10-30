#!/usr/bin/env node
// Record served docs' current content as revisions ready for review. The
// viewer only ever shows recorded revisions, so run this after each round of
// edits.
// Usage: revise.cjs [--session-dir <dir>] <path>...
const fs = require('fs');
const path = require('path');
const { recordRevision } = require('./revisions.cjs');

function fail(msg) {
  process.stderr.write('revise: ' + msg + '\n');
  process.exit(1);
}

const args = process.argv.slice(2);
let sessionDir = null;
const docPaths = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--session-dir') {
    sessionDir = args[++i];
    if (!sessionDir) fail('--session-dir requires a value');
  } else {
    docPaths.push(args[i]);
  }
}
if (docPaths.length === 0) fail('usage: revise.cjs [--session-dir <dir>] <path>...');

function isLive(dir) {
  return fs.existsSync(path.join(dir, 'state', 'server-info')) &&
    !fs.existsSync(path.join(dir, 'state', 'server-stopped'));
}

if (!sessionDir) {
  const root = path.join(process.cwd(), '.md-review');
  let candidates = [];
  try {
    candidates = fs.readdirSync(root)
      .map(name => path.join(root, name))
      .filter(p => { try { return fs.statSync(p).isDirectory() && isLive(p); } catch (e) { return false; } })
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch (e) { /* no .md-review dir */ }
  if (candidates.length === 0) {
    fail('no live md-review session under ' + root + ' — start one with start-server.sh, or pass --session-dir');
  }
  sessionDir = candidates[0];
} else if (!isLive(sessionDir)) {
  fail('no live md-review session at ' + sessionDir);
}

const manifestFile = path.join(sessionDir, 'manifest.json');
let manifest = [];
try {
  const raw = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
  if (Array.isArray(raw)) manifest = raw.filter(e => typeof e === 'string');
} catch (e) { /* missing or invalid: nothing is served */ }

const resolved = docPaths.map(p => path.resolve(p));
for (const abs of resolved) {
  if (!manifest.includes(abs)) fail(abs + ' is not served in ' + sessionDir + ' — add it with serve-doc.cjs first');
}

for (const abs of resolved) {
  let outcome;
  try {
    outcome = recordRevision(abs);
  } catch (e) {
    fail(e.message);
  }
  console.log(JSON.stringify({ type: outcome.status, doc: abs, revision: outcome.revision }));
}
