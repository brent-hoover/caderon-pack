// markdown-review server — forked from superpowers brainstorming visual
// companion (v6.1.1). Serves a manifest of markdown files from their real
// locations, renders client-side, records comment/approve events.
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ========== WebSocket Protocol (RFC 6455) — verbatim from fork ==========

const OPCODES = { TEXT: 0x01, CLOSE: 0x08, PING: 0x09, PONG: 0x0A };
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_PAYLOAD_BYTES = 10 * 1024 * 1024;

function computeAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_MAGIC).digest('base64');
}

function encodeFrame(opcode, payload) {
  const fin = 0x80;
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = fin | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = fin | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = fin | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const secondByte = buffer[1];
  const opcode = buffer[0] & 0x0F;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7F;
  let offset = 2;
  if (!masked) throw new Error('Client frames must be masked');
  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    const extendedLen = buffer.readBigUInt64BE(2);
    if (extendedLen > BigInt(MAX_FRAME_PAYLOAD_BYTES)) {
      throw new Error('WebSocket frame payload exceeds maximum allowed size');
    }
    payloadLen = Number(extendedLen);
    offset = 10;
  }
  if (payloadLen > MAX_FRAME_PAYLOAD_BYTES) {
    throw new Error('WebSocket frame payload exceeds maximum allowed size');
  }
  const maskOffset = offset;
  const dataOffset = offset + 4;
  const totalLen = dataOffset + payloadLen;
  if (buffer.length < totalLen) return null;
  const mask = buffer.slice(maskOffset, dataOffset);
  const data = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    data[i] = buffer[dataOffset + i] ^ mask[i % 4];
  }
  return { opcode, payload: data, bytesConsumed: totalLen };
}

// ========== Configuration ==========

const PORT_FILE = process.env.MDREVIEW_PORT_FILE || null;
const randomPort = () => 49152 + Math.floor(Math.random() * 16383);
function preferredPort() {
  if (process.env.MDREVIEW_PORT) return Number(process.env.MDREVIEW_PORT);
  if (PORT_FILE) {
    try {
      const p = Number(fs.readFileSync(PORT_FILE, 'utf-8').trim());
      if (Number.isInteger(p) && p > 1023 && p < 65536) return p;
    } catch (e) { /* no prior port recorded */ }
  }
  return randomPort();
}
let PORT = preferredPort();
const HOST = process.env.MDREVIEW_HOST || '127.0.0.1';
const URL_HOST = process.env.MDREVIEW_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);
const SESSION_DIR = process.env.MDREVIEW_DIR || '/tmp/md-review';
const MANIFEST_FILE = path.join(SESSION_DIR, 'manifest.json');
const STATE_DIR = path.join(SESSION_DIR, 'state');
let ownerPid = process.env.MDREVIEW_OWNER_PID ? Number(process.env.MDREVIEW_OWNER_PID) : null;

const TOKEN_FILE = process.env.MDREVIEW_TOKEN_FILE || null;
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}
function chmodOwnerOnly(file) {
  try { fs.chmodSync(file, 0o600); } catch (e) { /* best effort */ }
}
function initialToken() {
  if (process.env.MDREVIEW_TOKEN) {
    return { value: process.env.MDREVIEW_TOKEN, source: 'env' };
  }
  if (TOKEN_FILE) {
    try {
      const t = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
      if (/^[0-9a-f]{32,}$/i.test(t)) {
        chmodOwnerOnly(TOKEN_FILE);
        return { value: t, source: 'file' };
      }
    } catch (e) { /* no prior token recorded */ }
  }
  return { value: generateToken(), source: 'generated' };
}
const tokenInfo = initialToken();
let TOKEN = tokenInfo.value;
let tokenSource = tokenInfo.source;
let COOKIE_NAME = 'mdreview-key-' + PORT;

const ASSET_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp'
};

// ========== Static assets (read once at startup) ==========

const viewerHtml = fs.readFileSync(path.join(__dirname, 'viewer.html'), 'utf-8');
const viewerJs = fs.readFileSync(path.join(__dirname, 'viewer.js'), 'utf-8');
const markedJs = fs.readFileSync(path.join(__dirname, 'marked.min.js'), 'utf-8');

function viewerPage() {
  // split/join, not replace(): script bodies may contain '$' patterns
  return viewerHtml
    .split('<!-- MARKED_JS -->').join('<script>\n' + markedJs + '\n</script>')
    .split('<!-- VIEWER_JS -->').join('<script>\n' + viewerJs + '\n</script>');
}

const FORBIDDEN_PAGE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Session key required</title>
<style>body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
h1 { color: #333; } p { color: #666; } code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 4px; }</style>
</head>
<body><h1>Session key required</h1>
<p>This page needs the full URL your coding agent gave you, including the
<code>?key=&hellip;</code> part. Copy the complete URL and open it again.</p></body></html>`;

function bootstrapPage(key) {
  const jsonKey = JSON.stringify(String(key));
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Opening Markdown Review</title></head>
<body>
<script>
try { sessionStorage.setItem('mdreview-session-key', ${jsonKey}); } catch (e) {}
location.replace('/');
</script>
</body>
</html>`;
}

// ========== Manifest ==========

let manifest = [];              // absolute, deduped doc paths
const docWatchers = new Set();  // paths currently under fs.watchFile

function loadManifest() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  } catch (e) {
    return manifest; // missing or mid-write: keep last good manifest
  }
  if (!Array.isArray(raw)) return manifest;
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const abs = path.resolve(entry);
    if (!seen.has(abs)) { seen.add(abs); out.push(abs); }
  }
  return out;
}

function syncDocWatchers() {
  const current = new Set(manifest);
  for (const p of docWatchers) {
    if (!current.has(p)) { fs.unwatchFile(p); docWatchers.delete(p); }
  }
  for (const p of manifest) {
    if (docWatchers.has(p)) continue;
    docWatchers.add(p);
    fs.watchFile(p, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
      touchActivity();
      const id = manifest.indexOf(p);
      if (id < 0) return;
      console.log(JSON.stringify({ type: 'doc-updated', file: p }));
      broadcast({ type: 'reload', id });
    });
  }
}

function refreshManifest() {
  const next = loadManifest();
  const changed = next.length !== manifest.length || next.some((p, i) => manifest[i] !== p);
  manifest = next;
  if (!changed) return;
  touchActivity();
  syncDocWatchers();
  console.log(JSON.stringify({ type: 'manifest-updated', count: manifest.length }));
  broadcast({ type: 'manifest' });
  maybeOpenBrowser();
}

function docsPayload() {
  return manifest.map((p, id) => {
    let mtime = null;
    try { mtime = fs.statSync(p).mtimeMs; } catch (e) { /* stale entry */ }
    return { id, path: p, mtime };
  });
}

function docById(idStr) {
  if (!/^\d+$/.test(idStr)) return null;
  const id = Number(idStr);
  return id < manifest.length ? manifest[id] : null;
}

// Resolve an asset referenced by a doc. Servable iff its realpath stays
// inside the doc's directory tree, it's a regular file, and its extension
// is in the image allowlist. Returns the real path or null.
function resolveAsset(docPath, relPath) {
  if (!relPath || relPath.includes('\0')) return null;
  const ext = path.extname(relPath).toLowerCase();
  if (!ASSET_MIME[ext]) return null;
  const docDir = path.dirname(docPath);
  const target = path.resolve(docDir, relPath);
  let realDir, realTarget, stat;
  try {
    realDir = fs.realpathSync(docDir);
    realTarget = fs.realpathSync(target);
    stat = fs.lstatSync(target);
  } catch (e) {
    return null;
  }
  if (!stat.isFile()) return null; // lstat: symlink final component fails this
  if (!realTarget.startsWith(realDir + path.sep)) return null;
  return realTarget;
}

// ========== Authentication — verbatim from fork ==========

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function isAuthorized(req) {
  const q = req.url.indexOf('?');
  if (q >= 0) {
    const params = new URLSearchParams(req.url.slice(q + 1));
    if (params.has('key')) {
      const key = params.get('key');
      return Boolean(key && timingSafeEqualStr(key, TOKEN));
    }
  }
  const cookie = parseCookies(req.headers['cookie'])[COOKIE_NAME];
  if (cookie && timingSafeEqualStr(cookie, TOKEN)) return true;
  return false;
}

function pathnameOf(url) {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

function queryKey(url) {
  const q = url.indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(url.slice(q + 1)).get('key');
}

function securityHeaders(headers = {}) {
  return {
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...headers
  };
}

function isAllowedWebSocketOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  return origin === 'http://' + host;
}

// ========== HTTP Request Handler ==========

function handleRequest(req, res) {
  if (!isAuthorized(req)) {
    res.writeHead(403, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
    res.end(FORBIDDEN_PAGE);
    return;
  }
  touchActivity();

  res.setHeader('Set-Cookie',
    COOKIE_NAME + '=' + TOKEN + '; HttpOnly; SameSite=Strict; Path=/');

  const pathname = pathnameOf(req.url);
  const keyFromQuery = queryKey(req.url);

  if (req.method !== 'GET') {
    res.writeHead(404, securityHeaders());
    res.end('Not found');
    return;
  }

  if (pathname === '/' && keyFromQuery && timingSafeEqualStr(keyFromQuery, TOKEN)) {
    res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
    res.end(bootstrapPage(keyFromQuery));
  } else if (pathname === '/') {
    res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
    res.end(viewerPage());
  } else if (pathname === '/docs') {
    res.writeHead(200, securityHeaders({ 'Content-Type': 'application/json' }));
    res.end(JSON.stringify(docsPayload()));
  } else if (pathname.startsWith('/doc/')) {
    const docPath = docById(pathname.slice(5));
    let body = null;
    if (docPath) {
      try { body = fs.readFileSync(docPath, 'utf-8'); } catch (e) { /* stale entry */ }
    }
    if (body === null) {
      res.writeHead(404, securityHeaders());
      res.end('Not found');
      return;
    }
    res.writeHead(200, securityHeaders({ 'Content-Type': 'text/markdown; charset=utf-8' }));
    res.end(body);
  } else if (pathname.startsWith('/asset/')) {
    const rest = pathname.slice(7);
    const slash = rest.indexOf('/');
    const docPath = slash > 0 ? docById(rest.slice(0, slash)) : null;
    let relPath = null;
    if (docPath) {
      try { relPath = decodeURIComponent(rest.slice(slash + 1)); } catch (e) { /* bad escape */ }
    }
    const assetPath = relPath ? resolveAsset(docPath, relPath) : null;
    if (!assetPath) {
      res.writeHead(404, securityHeaders());
      res.end('Not found');
      return;
    }
    const ext = path.extname(assetPath).toLowerCase();
    res.writeHead(200, securityHeaders({ 'Content-Type': ASSET_MIME[ext] }));
    res.end(fs.readFileSync(assetPath));
  } else {
    res.writeHead(404, securityHeaders());
    res.end('Not found');
  }
}

// ========== WebSocket Connection Handling — verbatim from fork except handleMessage ==========

const clients = new Set();

function handleUpgrade(req, socket) {
  if (!isAuthorized(req) || !isAllowedWebSocketOrigin(req)) { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = computeAcceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  let buffer = Buffer.alloc(0);
  clients.add(socket);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      let result;
      try {
        result = decodeFrame(buffer);
      } catch (e) {
        socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
        clients.delete(socket);
        return;
      }
      if (!result) break;
      buffer = buffer.slice(result.bytesConsumed);
      switch (result.opcode) {
        case OPCODES.TEXT:
          handleMessage(result.payload.toString());
          break;
        case OPCODES.CLOSE:
          socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
          clients.delete(socket);
          return;
        case OPCODES.PING:
          socket.write(encodeFrame(OPCODES.PONG, result.payload));
          break;
        case OPCODES.PONG:
          break;
        default: {
          const closeBuf = Buffer.alloc(2);
          closeBuf.writeUInt16BE(1003);
          socket.end(encodeFrame(OPCODES.CLOSE, closeBuf));
          clients.delete(socket);
          return;
        }
      }
    }
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

function handleMessage(text) {
  let event;
  try {
    event = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse WebSocket message:', e.message);
    return;
  }
  touchActivity();
  console.log(JSON.stringify({ source: 'user-event', ...event }));
  // Persist review events. Unlike the fork, the events file is NEVER cleared
  // by the server — the agent truncates it after reading.
  if (event && (event.type === 'comment' || event.type === 'approve')) {
    fs.appendFileSync(path.join(STATE_DIR, 'events'), JSON.stringify(event) + '\n');
  }
}

function broadcast(msg) {
  const frame = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify(msg)));
  for (const socket of clients) {
    try { socket.write(frame); } catch (e) { clients.delete(socket); }
  }
}

// ========== Browser opening ==========

function browserLauncherForPlatform(url, {
  platform = process.platform,
  osRelease = require('os').release(),
  env = process.env
} = {}) {
  const isWSL = platform === 'linux' && /microsoft/i.test(osRelease);
  if (platform === 'darwin') return { bin: 'open', args: [url] };
  if (platform === 'win32' || isWSL) {
    return { bin: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return { bin: 'xdg-open', args: [url] };
  return null;
}

function urlHostForHttp(host) {
  const h = String(host);
  if (h.startsWith('[') && h.endsWith(']')) return h;
  return h.includes(':') ? '[' + h + ']' : h;
}

function serverUrl() {
  return 'http://' + urlHostForHttp(URL_HOST) + ':' + PORT + '/?key=' + TOKEN;
}

// Open the user's browser the first time the manifest becomes non-empty.
let browserOpened = false;
function maybeOpenBrowser() {
  if (browserOpened || manifest.length === 0) return;
  browserOpened = true;
  if (!process.env.MDREVIEW_OPEN) return;
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') return;
  if (clients.size > 0) return;
  const url = serverUrl();
  const cp = require('child_process');
  if (process.env.MDREVIEW_OPEN_CMD) {
    try { cp.exec(process.env.MDREVIEW_OPEN_CMD + ' ' + JSON.stringify(url), () => {}); } catch (e) { /* best effort */ }
    return;
  }
  const launcher = browserLauncherForPlatform(url);
  if (!launcher) return;
  try { cp.execFile(launcher.bin, launcher.args, () => {}); } catch (e) { /* best effort */ }
}

// ========== Activity Tracking — verbatim from fork ==========

const IDLE_TIMEOUT_MS = (() => {
  const ms = Number(process.env.MDREVIEW_IDLE_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 4 * 60 * 60 * 1000;
})();
const LIFECYCLE_CHECK_MS = (() => {
  const ms = Number(process.env.MDREVIEW_LIFECYCLE_CHECK_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 60 * 1000;
})();
let lastActivity = Date.now();
function touchActivity() {
  lastActivity = Date.now();
}

// ========== Server Startup ==========

function startServer() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!fs.existsSync(MANIFEST_FILE)) fs.writeFileSync(MANIFEST_FILE, '[]\n');

  manifest = loadManifest();
  syncDocWatchers();

  const server = http.createServer(handleRequest);
  server.on('upgrade', handleUpgrade);

  fs.watchFile(MANIFEST_FILE, { interval: 500 }, refreshManifest);

  function shutdown(reason) {
    console.log(JSON.stringify({ type: 'server-stopped', reason }));
    const infoFile = path.join(STATE_DIR, 'server-info');
    if (fs.existsSync(infoFile)) fs.unlinkSync(infoFile);
    fs.writeFileSync(
      path.join(STATE_DIR, 'server-stopped'),
      JSON.stringify({ reason, timestamp: Date.now() }) + '\n'
    );
    fs.unwatchFile(MANIFEST_FILE);
    for (const p of docWatchers) fs.unwatchFile(p);
    clearInterval(lifecycleCheck);
    for (const socket of clients) {
      try { socket.destroy(); } catch (e) { /* already gone */ }
    }
    server.close(() => process.exit(0));
  }

  process.on('SIGTERM', () => shutdown('signal'));
  process.on('SIGINT', () => shutdown('signal'));

  function ownerAlive() {
    if (!ownerPid) return true;
    try { process.kill(ownerPid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  }

  const lifecycleCheck = setInterval(() => {
    if (!ownerAlive()) shutdown('owner process exited');
    else if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) shutdown('idle timeout');
  }, LIFECYCLE_CHECK_MS);
  lifecycleCheck.unref();

  if (ownerPid) {
    try { process.kill(ownerPid, 0); }
    catch (e) {
      if (e.code !== 'EPERM') {
        console.log(JSON.stringify({ type: 'owner-pid-invalid', pid: ownerPid, reason: 'dead at startup' }));
        ownerPid = null;
      }
    }
  }

  let triedFallback = false;

  function onListen() {
    COOKIE_NAME = 'mdreview-key-' + PORT;
    if (PORT_FILE && !triedFallback) {
      try { fs.writeFileSync(PORT_FILE, String(PORT)); } catch (e) { /* best effort */ }
      if (TOKEN_FILE) {
        try {
          fs.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
          chmodOwnerOnly(TOKEN_FILE);
        } catch (e) { /* best effort */ }
      }
    }
    const info = JSON.stringify({
      type: 'server-started', port: Number(PORT), host: HOST,
      url_host: URL_HOST, url: serverUrl(),
      session_dir: SESSION_DIR, manifest: MANIFEST_FILE, state_dir: STATE_DIR,
      idle_timeout_ms: IDLE_TIMEOUT_MS
    });
    console.log(info);
    fs.writeFileSync(path.join(STATE_DIR, 'server-info'), info + '\n', { mode: 0o600 });
    maybeOpenBrowser(); // manifest may already be non-empty on restart
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !triedFallback) {
      if (tokenSource === 'env') {
        console.error('Server failed to bind: preferred port is in use and MDREVIEW_TOKEN is set; refusing fallback with explicit token');
        process.exit(1);
      }
      triedFallback = true;
      PORT = randomPort();
      if (tokenSource === 'file') {
        TOKEN = generateToken();
        tokenSource = 'generated-fallback';
      }
      server.listen(PORT, HOST, onListen);
    } else {
      console.error('Server failed to bind:', err.message);
      process.exit(1);
    }
  });
  server.listen(PORT, HOST, onListen);
}

if (require.main === module) {
  startServer();
}

module.exports = {
  computeAcceptKey,
  encodeFrame,
  decodeFrame,
  resolveAsset,
  browserLauncherForPlatform,
  OPCODES,
  MAX_FRAME_PAYLOAD_BYTES
};
