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
  const textCache = new Map();    // path -> doc source
  // Every comment saved this session, in order: [{event, isSent}]. Rebuilt from
  // GET /events on load; a comment is sent once a submit or approve on its own
  // doc follows it.
  let savedComments = [];
  let currentOrphans = [];        // comments of the current doc/view whose text is gone
  const viewChoice = new Map();   // path -> view the operator toggled to (in-memory; resets on reload)
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

  // Markdown: first '# ' heading. Gherkin: the Feature name ('#' lines there
  // are comments, not headings). Anything else, or no match: the file name.
  function titleFor(doc) {
    const text = textCache.get(doc.path) || '';
    const extension = extensionOf(doc.path);
    let match = null;
    if (MARKDOWN_EXTENSIONS.includes(extension)) match = text.match(/^#\s+(.+)$/m);
    else if (extension === GHERKIN_EXTENSION) match = text.match(/^[ \t]*Feature:[ \t]*(\S.*)$/m);
    return match && match[1].trim() ? match[1].trim() : doc.path.split('/').pop();
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
      li.title = doc.path;
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

  // Views: 'rendered' (markdown via marked), 'gherkin' (.feature blocks) and
  // 'source' (numbered lines).
  const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];
  const GHERKIN_EXTENSION = '.feature';
  const TOGGLEABLE_EXTENSIONS = MARKDOWN_EXTENSIONS.concat([GHERKIN_EXTENSION]);
  const STEP_KEYWORD_PATTERN = /^(Given|When|Then|And|But|\*)(\s.*)$/;

  function extensionOf(docPath) {
    const name = docPath.split('/').pop();
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot).toLowerCase() : '';
  }

  function defaultViewFor(docPath) {
    const extension = extensionOf(docPath);
    if (MARKDOWN_EXTENSIONS.includes(extension)) return 'rendered';
    if (extension === GHERKIN_EXTENSION) return 'gherkin';
    return 'source';
  }

  function currentViewFor(docPath) {
    return viewChoice.get(docPath) || defaultViewFor(docPath);
  }

  // ===== saved comments =====

  const TRIGGER_EVENT_TYPES = ['submit', 'approve'];

  async function loadSavedComments() {
    const events = await fetchJson('/events');
    savedComments = [];
    events.forEach(event => {
      if (event.type === 'comment') savedComments.push({ event: event, isSent: false });
      else if (TRIGGER_EVENT_TYPES.includes(event.type)) markDocSent(event.doc);
    });
    renderSubmitButton();
  }

  // A trigger without a doc (written by earlier viewers) covered every doc.
  function markDocSent(docPath) {
    savedComments = savedComments.map(saved => {
      const isCovered = !docPath || saved.event.doc === docPath;
      return { event: saved.event, isSent: saved.isSent || isCovered };
    });
  }

  // Doc-level comments have scope 'doc'; events from pre-view viewers are 'rendered'.
  function commentView(event) {
    if (event.scope === 'doc') return 'doc';
    return event.view || 'rendered';
  }

  function commentsIn(docPath, view) {
    return savedComments.filter(saved => saved.event.doc === docPath && commentView(saved.event) === view);
  }

  function anchorIndexOf(event) {
    return commentView(event) === 'source' ? event.line : event.blockIndex;
  }

  // anchors: [{el, index, quote}] for the elements just rendered. A comment
  // attaches to the element whose text still matches its quote (preferring its
  // original position), so cards follow their text when the agent edits the
  // doc. Comments whose text is gone are returned as orphans.
  function attachCommentCards(docPath, view, anchors) {
    const cardsByAnchor = new Map();
    const orphans = [];
    commentsIn(docPath, view).forEach(saved => {
      const matches = anchors.filter(a => a.quote === saved.event.quote);
      const anchor = matches.find(a => a.index === anchorIndexOf(saved.event)) || matches[0];
      if (!anchor) { orphans.push(saved); return; }
      if (!cardsByAnchor.has(anchor)) cardsByAnchor.set(anchor, []);
      cardsByAnchor.get(anchor).push(saved);
    });
    cardsByAnchor.forEach((comments, anchor) => attachComments(anchor.el, comments));
    return orphans;
  }

  // Submit is per doc: it counts and sends only the current doc's comments.
  function renderSubmitButton() {
    const docPath = currentId === null ? null : docs[currentId].path;
    const pendingCount = savedComments.filter(saved => !saved.isSent && saved.event.doc === docPath).length;
    const btn = $('#submit-comments');
    btn.textContent = 'Submit comments (' + pendingCount + ')';
    btn.disabled = pendingCount === 0;
  }

  function commentCard(saved) {
    const card = document.createElement('div');
    card.className = 'comment-card';
    const badge = document.createElement('span');
    badge.className = 'badge ' + (saved.isSent ? 'sent' : 'pending');
    badge.textContent = saved.isSent ? 'sent' : 'pending';
    card.appendChild(badge);
    if (saved.event.selection) {
      const quote = document.createElement('blockquote');
      quote.className = 'sel';
      quote.textContent = saved.event.selection;
      card.appendChild(quote);
    }
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = saved.event.comment;
    card.appendChild(text);
    return card;
  }

  // Marks el as commented and shows its comments right after it.
  function attachComments(el, comments) {
    el.classList.add('commented');
    const cards = document.createElement('div');
    cards.className = 'comment-cards';
    comments.forEach(saved => cards.appendChild(commentCard(saved)));
    insertAfter(el, cards);
  }

  function renderDocComments(doc, orphans) {
    const list = $('#doc-comments');
    list.innerHTML = '';
    commentsIn(doc.path, 'doc').forEach(saved => list.appendChild(commentCard(saved)));
    orphans.forEach(saved => {
      const card = commentCard(saved);
      const note = document.createElement('div');
      note.className = 'orphan';
      note.textContent = 'Commented text has changed: “' + saved.event.quote + '”';
      card.insertBefore(note, card.querySelector('.text'));
      list.appendChild(card);
    });
  }

  // A <div> can't sit between table rows, so after a <tr> the node gets its own
  // full-width row. Returns the element actually inserted.
  function insertAfter(el, node) {
    if (el.tagName !== 'TR') {
      el.insertAdjacentElement('afterend', node);
      return node;
    }
    const holder = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.appendChild(node);
    holder.appendChild(cell);
    el.insertAdjacentElement('afterend', holder);
    return holder;
  }

  async function renderDoc(id, opts) {
    const doc = docs[id];
    if (!doc) return;
    const pane = $('#doc');
    const scrollTop = opts.preserveScroll ? pane.scrollTop : 0;
    closePopover();
    const source = await docText(doc);
    const view = currentViewFor(doc.path);
    let anchors;
    if (view === 'source') anchors = renderSource(pane, source);
    else if (view === 'gherkin') anchors = renderGherkin(pane, source);
    else anchors = renderRendered(pane, id, source);
    currentOrphans = attachCommentCards(doc.path, view, anchors);
    renderHeader(doc, view);
    renderDocComments(doc, currentOrphans);
    pane.scrollTop = scrollTop;
  }

  // Each renderer fills the pane and returns its commentable anchors.
  function renderRendered(pane, id, source) {
    pane.innerHTML = marked.parse(source);
    pane.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      // leave absolute URLs (scheme:), root paths, and data: alone
      if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(src)) return;
      img.src = '/asset/' + id + '/' + src.split('/').map(encodeURIComponent).join('/');
    });
    return Array.from(pane.children).map((el, i) => {
      const quote = blockQuote(el);
      el.classList.add('block');
      el.addEventListener('click', (e) => {
        if (e.target.closest('a') || e.target.closest('.popover')) return;
        openPopover(el, { view: 'rendered', blockIndex: i, quote: quote });
      });
      return { el: el, index: i, quote: quote };
    });
  }

  function renderSource(pane, source) {
    const table = document.createElement('table');
    table.className = 'source';
    const anchors = source.split('\n').map((text, index) => {
      const line = index + 1;
      const quote = text.trim().slice(0, QUOTE_MAX_CHARS);
      const row = document.createElement('tr');
      row.className = 'block';
      const number = document.createElement('td');
      number.className = 'ln';
      number.textContent = String(line);
      const code = document.createElement('td');
      code.className = 'code';
      code.textContent = text;
      row.appendChild(number);
      row.appendChild(code);
      row.addEventListener('click', (e) => {
        if (e.target.closest('.popover')) return;
        openPopover(row, { view: 'source', line: line, quote: quote });
      });
      table.appendChild(row);
      return { el: row, index: line, quote: quote };
    });
    pane.innerHTML = '';
    pane.appendChild(table);
    return anchors;
  }

  function renderGherkin(pane, source) {
    pane.innerHTML = '';
    return parseGherkinBlocks(source).map((block, i) => {
      const anchor = gherkinAnchor(block, i);
      const el = document.createElement('div');
      el.className = 'block gherkin-block';
      el.dataset.kind = block.kind;
      appendGherkinLines(el, block.lines);
      const header = el.querySelector('.gl-keyword');
      if (header) header.classList.add('gl-header');
      el.addEventListener('click', (e) => {
        if (e.target.closest('.popover')) return;
        openPopover(el, anchor);
      });
      pane.appendChild(el);
      return { el: el, index: i, quote: anchor.quote };
    });
  }

  function gherkinAnchor(block, blockIndex) {
    const header = block.lines.find(l => l.kind === 'keyword') || block.lines[0];
    const anchor = { view: 'gherkin', blockIndex: blockIndex, line: block.startLine, quote: header.text.trim().slice(0, QUOTE_MAX_CHARS) };
    if (block.kind === 'scenario') anchor.scenario = block.title;
    return anchor;
  }

  // Consecutive table lines become one <table>; every other line is one row div.
  function appendGherkinLines(container, lines) {
    let tableLines = [];
    const flushTable = () => {
      if (tableLines.length > 0) container.appendChild(gherkinTable(tableLines));
      tableLines = [];
    };
    lines.forEach(line => {
      if (line.kind === 'table') { tableLines.push(line); return; }
      flushTable();
      container.appendChild(gherkinLine(line));
    });
    flushTable();
  }

  function gherkinLine(line) {
    const el = document.createElement('div');
    el.className = 'gl gl-' + line.kind;
    const text = line.kind === 'docstring' ? line.text : line.text.trim();
    const step = line.kind === 'step' ? text.match(STEP_KEYWORD_PATTERN) : null;
    if (step) {
      const keyword = document.createElement('span');
      keyword.className = 'kw';
      keyword.textContent = step[1];
      el.appendChild(keyword);
      el.appendChild(document.createTextNode(step[2]));
    } else if (line.kind === 'tag') {
      text.split(/\s+/).forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = tag;
        el.appendChild(chip);
      });
    } else {
      el.textContent = text;
    }
    return el;
  }

  // First row is the header row — true for Examples tables, and the common
  // convention for data tables.
  function gherkinTable(lines) {
    const table = document.createElement('table');
    table.className = 'gherkin-table';
    lines.forEach((line, rowIndex) => {
      const row = document.createElement('tr');
      splitTableRow(line.text).forEach(cellText => {
        const cell = document.createElement(rowIndex === 0 ? 'th' : 'td');
        cell.textContent = cellText;
        row.appendChild(cell);
      });
      table.appendChild(row);
    });
    return table;
  }

  function renderHeader(doc, view) {
    const isApproved = approved.has(doc.path);
    $('#docheader').textContent = titleFor(doc) + (isApproved ? '  ✓ approved' : '');
    $('#docheader').title = doc.path;
    const btn = $('#approve');
    btn.textContent = isApproved ? 'Approved ✓' : 'Approve';
    btn.classList.toggle('approved', isApproved);
    renderSubmitButton();
    const toggle = $('#view-toggle');
    toggle.hidden = !TOGGLEABLE_EXTENSIONS.includes(extensionOf(doc.path));
    toggle.textContent = view === 'source' ? 'Rendered' : 'Source';
  }

  // ===== comments =====

  const QUOTE_MAX_CHARS = 120;

  function blockQuote(el) {
    return el.textContent.trim().replace(/\s+/g, ' ').slice(0, QUOTE_MAX_CHARS);
  }

  function selectionWithin(el) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    return el.contains(sel.anchorNode) ? sel.toString() : null;
  }

  function closePopover() {
    if (!popover) return;
    popover.inserted.remove();
    popover = null;
  }

  // anchor: { view, quote, blockIndex? , line? } — copied onto the comment event.
  function openPopover(el, anchor) {
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
      saveInlineComment(Object.assign({ type: 'comment', doc: docs[currentId].path }, anchor,
        { selection: selection, comment: comment }));
    };
    row.appendChild(save);
    row.appendChild(cancel);
    popover.appendChild(row);
    popover.inserted = insertAfter(el, popover);
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

  // ===== resizable sidebar =====

  const SIDEBAR_MIN_PX = 180;
  const SIDEBAR_MAX_VIEWPORT_FRACTION = 0.5;
  const SIDEBAR_WIDTH_KEY = 'mdreview-sidebar-width';

  function applySidebarWidth(px) {
    const max = Math.floor(window.innerWidth * SIDEBAR_MAX_VIEWPORT_FRACTION);
    const width = Math.round(Math.min(Math.max(px, SIDEBAR_MIN_PX), max));
    document.documentElement.style.setProperty('--sidebar-w', width + 'px');
    return width;
  }

  // Storage can be unavailable (blocked site data, some private modes);
  // the sidebar then just uses the default width.
  function restoreSidebarWidth() {
    let saved = null;
    try { saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)); } catch (e) { return; }
    if (saved) applySidebarWidth(saved);
  }

  function saveSidebarWidth(width) {
    try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width)); } catch (e) { /* storage unavailable */ }
  }

  const handle = $('#sidebar-handle');
  let draggedWidth = null;
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    draggedWidth = applySidebarWidth(e.clientX);
  });
  handle.addEventListener('pointermove', (e) => {
    if (draggedWidth !== null) draggedWidth = applySidebarWidth(e.clientX);
  });
  // pointercancel/lostpointercapture end a drag the OS interrupted; keep the
  // width reached so far, as a normal release would.
  function endSidebarDrag() {
    handle.classList.remove('dragging');
    if (draggedWidth !== null) saveSidebarWidth(draggedWidth);
    draggedWidth = null;
  }
  handle.addEventListener('pointerup', endSidebarDrag);
  handle.addEventListener('pointercancel', endSidebarDrag);
  handle.addEventListener('lostpointercapture', endSidebarDrag);
  // Re-clamp when the window shrinks so the sidebar never covers the doc.
  window.addEventListener('resize', () => {
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'));
    if (current) applySidebarWidth(current);
  });
  restoreSidebarWidth();

  // ===== doc-level controls =====

  // Saved comments wait in the browser's view and the events file until
  // Submit or Approve; only those wake the agent.
  const SAVED_TOAST = 'Comment saved — Submit to send it to the agent';

  function recordComment(event) {
    sendEvent(event);
    savedComments.push({ event: event, isSent: false });
    renderSubmitButton();
  }

  // The popover being saved is the only open draft, so a full re-render is safe.
  function saveInlineComment(event) {
    recordComment(event);
    closePopover();
    renderDoc(currentId, { preserveScroll: true });
    flash(SAVED_TOAST);
  }

  // Doc-level comments, Submit and Approve update the page in place: an inline
  // comment draft may be open, and re-rendering the doc would destroy it.
  function saveDocComment(event) {
    recordComment(event);
    renderDocComments(docs[currentId], currentOrphans);
    flash(SAVED_TOAST);
  }

  // Only the current doc's cards are on the page, so Submit/Approve on it can
  // flip every pending badge shown.
  function showAllCardsSent() {
    document.querySelectorAll('.comment-card .badge.pending').forEach(badge => {
      badge.className = 'badge sent';
      badge.textContent = 'sent';
    });
  }

  $('#send-doc-comment').onclick = () => {
    const ta = $('#doc-comment');
    const comment = ta.value.trim();
    if (!comment || currentId === null) return;
    ta.value = '';
    saveDocComment({ type: 'comment', doc: docs[currentId].path, scope: 'doc', comment: comment });
  };

  $('#submit-comments').onclick = () => {
    if (currentId === null) return;
    const docPath = docs[currentId].path;
    sendEvent({ type: 'submit', doc: docPath });
    markDocSent(docPath);
    renderSubmitButton();
    showAllCardsSent();
    flash('Comments sent to the agent');
  };

  $('#view-toggle').onclick = () => {
    if (currentId === null) return;
    const doc = docs[currentId];
    const next = currentViewFor(doc.path) === 'source' ? defaultViewFor(doc.path) : 'source';
    viewChoice.set(doc.path, next);
    renderDoc(currentId, { preserveScroll: false });
  };

  $('#approve').onclick = () => {
    if (currentId === null) return;
    const doc = docs[currentId];
    sendEvent({ type: 'approve', doc: doc.path });
    markDocSent(doc.path);
    renderSubmitButton();
    showAllCardsSent();
    approved.set(doc.path, doc.mtime);
    renderSidebar();
    renderHeader(doc, currentViewFor(doc.path));
    flash('Approved');
  };

  connect();
  loadSavedComments().then(refreshDocs);
})();
