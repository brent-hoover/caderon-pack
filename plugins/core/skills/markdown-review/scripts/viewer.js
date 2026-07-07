(function () {
  'use strict';
  const MIN_RECONNECT_MS = 500;
  const MAX_RECONNECT_MS = 30000;
  const TOMBSTONE_AFTER_MS = 15000;

  let ws = null;
  let eventQueue = [];
  let reconnectDelay = MIN_RECONNECT_MS;
  let reconnectTimer = null;
  let disconnectedSince = null;
  let everConnected = false;
  let tombstoneShown = false;

  let docs = [];                  // [{id, path, mtime}] from GET /docs
  let currentId = null;
  let currentPath = null;         // path of the doc currentId refers to
  const textCache = new Map();    // path -> markdown source
  const commented = new Map();    // path -> Set(blockIndex)
  const approved = new Map();     // path -> mtime at approval time
  const updated = new Set();      // paths changed since last viewed
  let popover = null;

  const $ = (sel) => document.querySelector(sel);

  // ===== connection (adapted from superpowers helper.js) =====

  function sessionKey() {
    try { return sessionStorage.getItem('mdreview-session-key'); } catch (e) { return null; }
  }

  function wsUrl() {
    const key = sessionKey();
    return 'ws://' + location.host + (key ? '/?key=' + encodeURIComponent(key) : '');
  }

  function setStatus(state) {
    const el = $('.status');
    const map = {
      connecting:   ['Connecting…',   'var(--fg2)'],
      connected:    ['Connected',     'var(--ok)'],
      reconnecting: ['Reconnecting…', 'var(--warn)'],
      disconnected: ['Disconnected',  'var(--err)']
    };
    const [text, color] = map[state] || map.disconnected;
    el.textContent = text;
    el.style.setProperty('--status-color', color);
  }

  function showTombstone() {
    if (tombstoneShown) return;
    tombstoneShown = true;
    const el = document.createElement('div');
    el.id = 'tombstone';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;' +
      'align-items:center;justify-content:center;padding:2rem;text-align:center;' +
      'background:rgba(20,20,22,0.92);color:#f5f5f7;font-family:system-ui,sans-serif';
    el.innerHTML = '<div style="max-width:480px">' +
      '<h2 style="margin:0 0 .5rem;font-weight:600">Review server paused</h2>' +
      '<p style="margin:0;opacity:.85">Ask your coding agent to bring it back — ' +
      'this page reconnects automatically.</p></div>';
    document.body.appendChild(el);
  }

  function reloadAfterRecovery() {
    const key = sessionKey();
    if (key) location.replace('/?key=' + encodeURIComponent(key));
    else location.reload();
  }

  function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    setStatus(everConnected ? 'reconnecting' : 'connecting');
    ws = new WebSocket(wsUrl());

    ws.onopen = () => {
      const recovered = tombstoneShown;
      everConnected = true;
      disconnectedSince = null;
      reconnectDelay = MIN_RECONNECT_MS;
      tombstoneShown = false;
      setStatus('connected');
      eventQueue.forEach(e => ws.send(JSON.stringify(e)));
      eventQueue = [];
      if (recovered) reloadAfterRecovery();
    };

    ws.onmessage = (msg) => {
      let data;
      try { data = JSON.parse(msg.data); } catch (e) { return; }
      if (data.type === 'manifest') refreshDocs();
      else if (data.type === 'reload') onDocChanged(data.id);
    };

    ws.onclose = () => {
      ws = null;
      if (disconnectedSince === null) disconnectedSince = Date.now();
      if (Date.now() - disconnectedSince >= TOMBSTONE_AFTER_MS) {
        setStatus('disconnected');
        showTombstone();
      } else {
        setStatus('reconnecting');
      }
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
    };

    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function sendEvent(event) {
    event.timestamp = Date.now();
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
    else eventQueue.push(event);
  }

  // ===== docs =====

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' -> ' + r.status);
    return r.json();
  }

  async function docText(doc) {
    if (!textCache.has(doc.path)) {
      const r = await fetch('/doc/' + doc.id);
      textCache.set(doc.path, r.ok ? await r.text() : '*Failed to load ' + doc.path + '*');
    }
    return textCache.get(doc.path);
  }

  function titleFor(doc) {
    const text = textCache.get(doc.path);
    if (text) {
      const m = text.match(/^#\s+(.+)$/m);
      if (m) return m[1].trim();
    }
    return doc.path.split('/').pop();
  }

  // Recompute currentId from currentPath against the current `docs` array.
  // Manifest indices shift when docs are added/removed, so currentId alone
  // can go stale; currentPath is the stable identity.
  function remapCurrentId() {
    if (currentPath === null) return;
    const idx = docs.findIndex(d => d.path === currentPath);
    currentId = idx >= 0 ? idx : null;
  }

  async function refreshDocs() {
    docs = await fetchJson('/docs');
    await Promise.all(docs.map(d => docText(d)));
    if (docs.length === 0) {
      currentId = null;
      currentPath = null;
      $('#doc').innerHTML = '<p class="empty">No documents yet — the agent will add some.</p>';
      $('#docheader').textContent = 'Markdown Review';
      renderSidebar();
      return;
    }
    if (currentPath !== null) {
      const idx = docs.findIndex(d => d.path === currentPath);
      if (idx === -1) {
        // current doc was removed from the manifest — fall back to newest
        await selectDoc(docs.length - 1);
        return;
      }
      if (idx !== currentId) {
        currentId = idx;
        await renderDoc(currentId, { preserveScroll: true });
      }
      renderSidebar();
      return;
    }
    if (currentId === null || currentId >= docs.length) await selectDoc(docs.length - 1);
    else renderSidebar();
  }

  async function onDocChanged(id) {
    docs = await fetchJson('/docs');
    const doc = docs[id];
    if (!doc) return;
    textCache.delete(doc.path);
    await docText(doc);
    if (approved.has(doc.path) && doc.mtime > approved.get(doc.path)) approved.delete(doc.path);
    remapCurrentId();
    if (id === currentId) await renderDoc(id, { preserveScroll: true });
    else updated.add(doc.path);
    renderSidebar();
  }

  function renderSidebar() {
    const list = $('#doclist');
    list.innerHTML = '';
    docs.forEach(doc => {
      const li = document.createElement('li');
      if (doc.id === currentId) li.className = 'active';
      if (updated.has(doc.path)) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        li.appendChild(dot);
      }
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = titleFor(doc);
      li.appendChild(title);
      if (approved.has(doc.path)) {
        const check = document.createElement('span');
        check.className = 'check';
        check.textContent = '✓';
        li.appendChild(check);
      }
      li.onclick = () => selectDoc(doc.id);
      list.appendChild(li);
    });
  }

  async function selectDoc(id) {
    currentId = id;
    currentPath = docs[id].path;
    updated.delete(docs[id].path);
    await renderDoc(id, { preserveScroll: false });
    renderSidebar();
  }

  async function renderDoc(id, opts) {
    const doc = docs[id];
    if (!doc) return;
    const pane = $('#doc');
    const scrollTop = opts.preserveScroll ? pane.scrollTop : 0;
    closePopover();
    pane.innerHTML = marked.parse(await docText(doc));

    pane.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      // leave absolute URLs (scheme:), root paths, and data: alone
      if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(src)) return;
      img.src = '/asset/' + id + '/' + src.split('/').map(encodeURIComponent).join('/');
    });

    const marks = commented.get(doc.path) || new Set();
    Array.from(pane.children).forEach((el, i) => {
      el.classList.add('block');
      el.dataset.block = i;
      if (marks.has(i)) el.classList.add('commented');
      el.addEventListener('click', (e) => {
        if (e.target.closest('a') || e.target.closest('.popover')) return;
        openPopover(el, i);
      });
    });

    const isApproved = approved.has(doc.path);
    $('#docheader').textContent = titleFor(doc) + (isApproved ? '  ✓ approved' : '');
    const btn = $('#approve');
    btn.textContent = isApproved ? 'Approved ✓' : 'Approve';
    btn.classList.toggle('approved', isApproved);
    pane.scrollTop = scrollTop;
  }

  // ===== comments =====

  function blockQuote(el) {
    return el.textContent.trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function selectionWithin(el) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    return el.contains(sel.anchorNode) ? sel.toString() : null;
  }

  function closePopover() {
    if (popover) { popover.remove(); popover = null; }
  }

  function openPopover(el, index) {
    closePopover();
    const selection = selectionWithin(el);
    popover = document.createElement('div');
    popover.className = 'popover';
    if (selection) {
      const q = document.createElement('blockquote');
      q.className = 'sel';
      q.textContent = selection;
      popover.appendChild(q);
    }
    const ta = document.createElement('textarea');
    ta.placeholder = 'Comment on this block…';
    popover.appendChild(ta);
    const row = document.createElement('div');
    row.className = 'row';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.onclick = closePopover;
    const save = document.createElement('button');
    save.className = 'save';
    save.textContent = 'Save';
    save.onclick = () => {
      const comment = ta.value.trim();
      if (!comment) return;
      const doc = docs[currentId];
      sendEvent({ type: 'comment', doc: doc.path, blockIndex: index, quote: blockQuote(el), selection: selection, comment: comment });
      if (!commented.has(doc.path)) commented.set(doc.path, new Set());
      commented.get(doc.path).add(index);
      el.classList.add('commented');
      closePopover();
      flash('Comment saved');
    };
    row.appendChild(save);
    row.appendChild(cancel);
    popover.appendChild(row);
    el.insertAdjacentElement('afterend', popover);
    ta.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });

  let toastTimer = null;
  function flash(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ===== doc-level controls =====

  $('#send-doc-comment').onclick = () => {
    const ta = $('#doc-comment');
    const comment = ta.value.trim();
    if (!comment || currentId === null) return;
    sendEvent({ type: 'comment', doc: docs[currentId].path, scope: 'doc', comment: comment });
    ta.value = '';
    flash('Comment sent');
  };

  $('#approve').onclick = () => {
    if (currentId === null) return;
    const doc = docs[currentId];
    sendEvent({ type: 'approve', doc: doc.path });
    approved.set(doc.path, doc.mtime);
    renderSidebar();
    renderDoc(currentId, { preserveScroll: true });
    flash('Approved');
  };

  connect();
  refreshDocs();
})();
