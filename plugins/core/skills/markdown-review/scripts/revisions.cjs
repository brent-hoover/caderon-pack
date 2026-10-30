// Revision history of a reviewed doc, stored beside it as plain files:
//
//   <doc dir>/.revisions/<doc file name>/
//     index.jsonl   one {"revision","timestamp","sha256"} line per revision; authoritative
//     0001.rev      full content of revision 1
//     lock          present only while a revision is being recorded
//
// Files use .rev, not the doc's extension, so BDD runners, markdown linters
// and doc reviewers that glob *.md / *.feature never pick up old copies.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REVISIONS_DIR_NAME = '.revisions';
const INDEX_FILE_NAME = 'index.jsonl';
const LOCK_FILE_NAME = 'lock';
const REVISION_EXTENSION = '.rev';
const TEMP_SUFFIX = '.tmp';
const REVISION_NUMBER_WIDTH = 4;
// A revise holds the lock for one file read, one hash and one small write, so
// 5s of 50ms retries outlasts any live holder; a longer wait means it is stuck.
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5000;

function revisionDir(docPath) {
  return path.join(path.dirname(docPath), REVISIONS_DIR_NAME, path.basename(docPath));
}

// Only complete lines: the last line may be an append in flight, or one a
// dead writer left half-written (the next recordRevision truncates it).
function readIndex(docPath) {
  let content;
  try {
    content = fs.readFileSync(indexFile(docPath), 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const completeLines = content.slice(0, content.lastIndexOf('\n') + 1).split('\n').filter(Boolean);
  return completeLines.map(line => JSON.parse(line));
}

function readRevision(docPath, revision) {
  return fs.readFileSync(revisionFile(docPath, revision), 'utf-8');
}

// Records the doc's current content as the next revision, unless it matches
// the latest one. Returns {status: 'revised'|'unchanged', revision}.
function recordRevision(docPath) {
  const dir = revisionDir(docPath);
  fs.mkdirSync(dir, { recursive: true });
  acquireLock(dir);
  try {
    repairIndexTail(docPath);
    removeLeftoverTemps(dir);
    return recordUnderLock(docPath);
  } finally {
    fs.rmSync(path.join(dir, LOCK_FILE_NAME), { force: true });
  }
}

function recordUnderLock(docPath) {
  let content;
  try {
    content = fs.readFileSync(docPath, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('no such file: ' + docPath);
    throw e;
  }
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const index = readIndex(docPath);
  const latest = index[index.length - 1];
  if (latest && latest.sha256 === sha256) return { status: 'unchanged', revision: latest.revision };

  const revision = latest ? latest.revision + 1 : 1;
  writeRevisionFile(docPath, revision, content);
  const entry = { revision, timestamp: Date.now(), sha256 };
  fs.appendFileSync(indexFile(docPath), JSON.stringify(entry) + '\n');
  return { status: 'revised', revision };
}

// Temp file, fsync, rename: a reader never sees a partly written revision.
function writeRevisionFile(docPath, revision, content) {
  const finalPath = revisionFile(docPath, revision);
  const tempPath = finalPath + TEMP_SUFFIX;
  const fd = fs.openSync(tempPath, 'w');
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tempPath, finalPath);
}

// A lock left by a dead process is reported, never taken over: two writers
// recovering the same stale lock could each delete the other's fresh one.
function acquireLock(dir) {
  const lockPath = path.join(dir, LOCK_FILE_NAME);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const holder = readLockHolder(lockPath);
    if (holder !== null && !isProcessAlive(holder)) {
      throw new Error('stale revision lock ' + lockPath + ' from dead pid ' + holder +
        ' — check no revise is running, delete the lock file, and retry');
    }
    if (Date.now() >= deadline) {
      throw new Error('revision lock ' + lockPath + ' held by pid ' + holder + ' for over ' +
        LOCK_TIMEOUT_MS + 'ms');
    }
    sleepSync(LOCK_RETRY_MS);
  }
}

// null while the holder is between creating the lock and writing its pid.
function readLockHolder(lockPath) {
  let text;
  try {
    text = fs.readFileSync(lockPath, 'utf-8').trim();
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const pid = Number(text);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// The CLIs are synchronous scripts; Atomics.wait blocks without spinning.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Under the lock, a missing final newline can only be a dead writer's partial
// append; truncating it keeps the next append on a line of its own.
function repairIndexTail(docPath) {
  const file = indexFile(docPath);
  let content;
  try {
    content = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  if (content === '' || content.endsWith('\n')) return;
  fs.truncateSync(file, Buffer.byteLength(content.slice(0, content.lastIndexOf('\n') + 1)));
}

function removeLeftoverTemps(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(TEMP_SUFFIX)) fs.rmSync(path.join(dir, name), { force: true });
  }
}

function indexFile(docPath) {
  return path.join(revisionDir(docPath), INDEX_FILE_NAME);
}

function revisionFile(docPath, revision) {
  const name = String(revision).padStart(REVISION_NUMBER_WIDTH, '0') + REVISION_EXTENSION;
  return path.join(revisionDir(docPath), name);
}

module.exports = { recordRevision, readIndex, readRevision, revisionDir };
