#!/usr/bin/env node
// agent-bus: message bus for independent Claude Code sessions on one machine.
// Durable per-recipient JSONL inboxes + a cmux-injected doorbell prompt that
// gives the recipient a turn. See DESIGN.md.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUS_DIR = process.env.AGENT_BUS_DIR || path.join(os.homedir(), '.claude', 'bus');
const REGISTRY_FILE = path.join(BUS_DIR, 'registry.json');
const INBOX_DIR = path.join(BUS_DIR, 'inbox');
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

function fail(msg) {
  process.stderr.write('bus: ' + msg + '\n');
  process.exit(1);
}

function ensureDirs() {
  fs.mkdirSync(INBOX_DIR, { recursive: true });
}

function loadRegistry() {
  try {
    const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

function saveRegistry(reg) {
  ensureDirs();
  const tmp = REGISTRY_FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n');
  fs.renameSync(tmp, REGISTRY_FILE);
}

function callerSurface() {
  return process.env.CMUX_SURFACE_ID || null;
}

function requireCmuxIdentity() {
  const surface = process.env.CMUX_SURFACE_ID;
  const workspace = process.env.CMUX_WORKSPACE_ID;
  if (!surface || !workspace) {
    fail('not running inside cmux (CMUX_SURFACE_ID / CMUX_WORKSPACE_ID unset) — the bus needs a cmux surface to deliver to');
  }
  return { surface, workspace };
}

function inboxFile(name) {
  return path.join(INBOX_DIR, name + '.jsonl');
}

function readInbox(name) {
  let raw;
  try { raw = fs.readFileSync(inboxFile(name), 'utf-8'); } catch (e) { return []; }
  return raw.split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

// ===== commands =====

function cmdRegister(name, flags) {
  if (!name) fail('usage: bus.cjs register <name> [--force]');
  if (!NAME_RE.test(name)) fail('invalid name (letters/digits/dash/underscore, max 32 chars): ' + name);
  const { surface, workspace } = requireCmuxIdentity();
  const reg = loadRegistry();
  const existing = reg[name];
  if (existing && existing.surface !== surface && !flags.force) {
    fail("name '" + name + "' is taken by another session (surface " + existing.surface + ') — pick another name or use --force');
  }
  reg[name] = { surface, workspace, cwd: process.cwd(), registered_at: Date.now() };
  saveRegistry(reg);
  console.log(JSON.stringify({ type: 'registered', name, ...reg[name] }));
}

function cmdUnregister(name) {
  if (!name) fail('usage: bus.cjs unregister <name>');
  const reg = loadRegistry();
  if (!reg[name]) fail("name '" + name + "' is not registered");
  delete reg[name];
  saveRegistry(reg);
  console.log(JSON.stringify({ type: 'unregistered', name }));
}

function cmdList(flags) {
  const reg = loadRegistry();
  if (flags.json) {
    console.log(JSON.stringify(reg, null, 2));
    return;
  }
  const names = Object.keys(reg);
  if (names.length === 0) {
    console.log('no agents registered');
    return;
  }
  for (const name of names) {
    const e = reg[name];
    console.log(name + '\t' + e.surface + '\t' + e.cwd + '\t' + new Date(e.registered_at).toISOString());
  }
}

function resolveSender(reg, flags) {
  if (flags.from) return flags.from;
  const surface = callerSurface();
  if (surface) {
    for (const [name, entry] of Object.entries(reg)) {
      if (entry.surface === surface) return name;
    }
  }
  fail('cannot determine sender: this session is not registered — run `bus.cjs register <name>` first (or pass --from)');
}

function cmdSend(to, messageArgs, flags) {
  if (!to || messageArgs.length === 0) fail('usage: bus.cjs send <to> <message...|-> [--from <name>]');
  const reg = loadRegistry();
  const recipient = reg[to];
  if (!recipient) fail("recipient '" + to + "' is not registered (bus.cjs list to see who is)");
  const from = resolveSender(reg, flags);
  const body = (messageArgs.length === 1 && messageArgs[0] === '-')
    ? fs.readFileSync(0, 'utf-8')
    : messageArgs.join(' ');

  ensureDirs();
  fs.appendFileSync(inboxFile(to), JSON.stringify({ from, to, ts: Date.now(), body }) + '\n');

  // One line, no newlines: embedded newlines would submit a partial prompt.
  const doorbell = "[agent-bus] New message from '" + from + "'. Read it with: node " +
    __filename + ' read ' + to + ' - then use the agent-bus skill to reply if needed.';
  const target = ['--workspace', recipient.workspace, '--surface', recipient.surface];
  try {
    execFileSync('cmux', ['send', ...target, '--', doorbell], { stdio: 'pipe' });
    execFileSync('cmux', ['send-key', ...target, '--', 'enter'], { stdio: 'pipe' });
  } catch (e) {
    fail("doorbell failed (recipient surface may be gone — ask them to re-register): " + e.message +
      '\nThe message IS saved in their inbox and will be seen on their next read.');
  }
  console.log(JSON.stringify({ type: 'sent', from, to }));
}

function cmdRead(name, flags) {
  if (!name) fail('usage: bus.cjs read <name> [--peek] [--json]');
  const messages = readInbox(name);
  if (flags.json) {
    console.log(JSON.stringify(messages, null, 2));
  } else if (messages.length === 0) {
    console.log('no messages');
  } else {
    for (const m of messages) {
      console.log('--- from ' + m.from + ' @ ' + new Date(m.ts).toISOString() + ' ---');
      console.log(m.body);
    }
  }
  if (!flags.peek && messages.length > 0) {
    fs.writeFileSync(inboxFile(name), '');
  }
}

// ===== arg parsing =====

const argv = process.argv.slice(2);
const flags = { force: false, json: false, peek: false, from: null };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--force') flags.force = true;
  else if (a === '--json') flags.json = true;
  else if (a === '--peek') flags.peek = true;
  else if (a === '--from') { flags.from = argv[++i] || null; if (!flags.from) fail('--from requires a value'); }
  else positional.push(a);
}
const [command, ...rest] = positional;

switch (command) {
  case 'register': cmdRegister(rest[0], flags); break;
  case 'unregister': cmdUnregister(rest[0]); break;
  case 'list': cmdList(flags); break;
  case 'send': cmdSend(rest[0], rest.slice(1), flags); break;
  case 'read': cmdRead(rest[0], flags); break;
  default:
    fail('usage: bus.cjs <register|unregister|list|send|read> ... (see the agent-bus skill)');
}
