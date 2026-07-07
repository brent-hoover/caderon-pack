#!/usr/bin/env node
// Register markdown docs with a running md-review session.
// Usage: serve-doc.cjs [--session-dir <dir>] <path>...
const fs = require('fs');
const path = require('path');

function fail(msg) {
  process.stderr.write('serve-doc: ' + msg + '\n');
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
if (docPaths.length === 0) fail('usage: serve-doc.cjs [--session-dir <dir>] <path>...');

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

const resolved = [];
for (const p of docPaths) {
  const abs = path.resolve(p);
  let stat;
  try { stat = fs.statSync(abs); } catch (e) { fail('no such file: ' + abs); }
  if (!stat.isFile()) fail('not a file: ' + abs);
  resolved.push(abs);
}

const manifestFile = path.join(sessionDir, 'manifest.json');
let manifest = [];
try {
  const raw = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
  if (Array.isArray(raw)) manifest = raw.filter(e => typeof e === 'string');
} catch (e) { /* missing or invalid: start fresh */ }

let added = 0;
for (const p of resolved) {
  if (!manifest.includes(p)) { manifest.push(p); added++; }
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

console.log(JSON.stringify({
  type: 'docs-added', added, count: manifest.length,
  manifest: manifestFile, session_dir: sessionDir
}));
