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
  const textCache = new Map();    // revisionKey(doc) -> that revision's source
  const shownRevisions = new Map(); // path -> revisionKey of the revision on screen
  // Every comment saved this session, in order: [{event, isSent}]. Rebuilt from
  // GET /events on load; a comment is sent once a submit or approve on its own
  // doc follows it.
  let savedComments = [];
  let currentOrphans = [];        // comment events of the current doc/view whose text is gone
  let renderedAnchors = [];       // [{el, index, quote}] of the doc on screen
  const viewChoice = new Map();   // path -> view the operator toggled to (in-memory; resets on reload)
  const approved = new Map();     // path -> revisionKey approved
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
      else if (data.type === 'revision') onDocChanged(data.id);
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

  // A revision is identified by number and hash: deleted and recreated history
  // reuses revision numbers for different content.
  function revisionKey(doc) {
    return doc.path + '#' + doc.revision + ':' + doc.sha256;
  }

  // Fetched by revision number and hash, so the text always is the revision
  // /docs reported; the server answers 409 if history changed in between.
  // Only successful loads are cached, so a failed one retries on the next
  // revision notice.
  async function docText(doc) {
    const key = revisionKey(doc);
    if (textCache.has(key)) return textCache.get(key);
    if (doc.revision === null) {
      return '*' + doc.path + ' has no revisions yet — the agent needs to run serve-doc or revise.*';
    }
    const r = await fetch('/doc/' + doc.id + '/rev/' + doc.revision + '?sha256=' + doc.sha256);
    if (!r.ok) return '*Failed to load revision ' + doc.revision + ' of ' + doc.path + ' (' + r.status + ')*';
    const text = await r.text();
    textCache.set(key, text);
    return text;
  }

  // Markdown: first '# ' heading. Gherkin: the Feature name ('#' lines there
  // are comments, not headings). Anything else, or no match: the file name.
  function titleFor(doc) {
    const text = textCache.get(revisionKey(doc)) || '';
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
    await docText(doc);
    if (approved.has(doc.path) && approved.get(doc.path) !== revisionKey(doc)) approved.delete(doc.path);
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

  // commentView, anchorIndexOf and resolveAnchor come from revision-diff.cjs,
  // shared with the carry-forward logic so both anchor comments the same way.

  function commentsIn(docPath, view) {
    return savedComments.filter(saved => saved.event.doc === docPath && commentView(saved.event) === view);
  }

  // anchors: [{el, index, quote}] for the elements just rendered. A comment
  // attaches to the element whose text still matches its quote, so cards
  // follow their text when the agent edits the doc. Quotes can repeat (two
  // identical headings): the event's `occurrence` says which one, falling back
  // to the match nearest the original position. Returns the events of
  // comments whose text is gone.
  function attachCommentCards(docPath, view, anchors) {
    const cardsByAnchor = new Map();
    const orphans = [];
    commentsIn(docPath, view).forEach(saved => {
      const anchor = resolveAnchor(saved.event, anchors);
      if (!anchor) { orphans.push(saved.event); return; }
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

  // How many earlier anchors share this anchor's quote — stored on the comment
  // so a repeated quote can be told apart after edits.
  function occurrenceOf(anchors, anchor) {
    return anchors.filter(a => a.quote === anchor.quote && a.index < anchor.index).length;
  }

  // Marks el as commented and shows its comments right after it.
  function attachComments(el, comments) {
    el.classList.add('commented');
    const cards = document.createElement('div');
    cards.className = 'comment-cards';
    comments.forEach(saved => cards.appendChild(commentCard(saved)));
    insertAfter(el, cards);
  }

  // Orphans are kept as events and looked up here, so their sent status is
  // current even after a Submit replaced the savedComments entries.
  function renderDocComments(doc, orphanEvents) {
    const list = $('#doc-comments');
    list.innerHTML = '';
    commentsIn(doc.path, 'doc').forEach(saved => list.appendChild(commentCard(saved)));
    const orphans = savedComments.filter(saved => orphanEvents.includes(saved.event));
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
    // A failed load shows an error, not the revision, so it can't be approved.
    if (textCache.has(revisionKey(doc))) shownRevisions.set(doc.path, revisionKey(doc));
    else shownRevisions.delete(doc.path);
    const view = currentViewFor(doc.path);
    // Markdown and Gherkin source views show the revision itself, never a diff.
    const isDiffable = !(view === 'source' && TOGGLEABLE_EXTENSIONS.includes(extensionOf(doc.path)));
    const base = isDiffable ? await baseRevisionFor(doc) : null;
    let anchors;
    let comparison = null;
    if (base) {
      const shown = renderDiff(pane, id, view, base.source, source);
      anchors = shown.anchors;
      comparison = { from: base.revision, to: doc.revision, isIdentical: shown.isIdentical };
    } else if (view === 'source') anchors = renderSource(pane, source);
    else if (view === 'gherkin') anchors = renderGherkin(pane, source);
    else anchors = renderRendered(pane, id, source);
    renderedAnchors = anchors;
    currentOrphans = attachCommentCards(doc.path, view, anchors);
    renderHeader(doc, view, comparison);
    renderDocComments(doc, currentOrphans);
    pane.scrollTop = scrollTop;
  }

  // Each renderer fills the pane and returns its commentable anchors.
  // One wrapper per non-space top-level token: wrapper i is block i, the same
  // index the diff and comment carry-forward use, even for a token that
  // renders nothing (an HTML comment) or several elements.
  function renderRendered(pane, id, source) {
    pane.innerHTML = '';
    marked.lexer(source).filter(token => token.type !== 'space').forEach(token => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = marked.parser([token]);
      pane.appendChild(wrapper);
    });
    rewriteImages(pane, id);
    return Array.from(pane.children).map((el, i) => {
      const payload = { view: 'rendered', blockIndex: i, quote: blockQuote(el) };
      makeCommentable(el, payload);
      return { el: el, index: i, quote: payload.quote, payload: payload };
    });
  }

  function rewriteImages(container, id) {
    container.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      // leave absolute URLs (scheme:), root paths, and data: alone
      if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(src)) return;
      img.src = '/asset/' + id + '/' + src.split('/').map(encodeURIComponent).join('/');
    });
  }

  // payload: the anchor fields a comment on el records (view, quote, and
  // blockIndex or line).
  function makeCommentable(el, payload) {
    el.classList.add('block');
    el.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('.popover')) return;
      openPopover(el, payload);
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
      const payload = { view: 'source', line: line, quote: quote };
      makeCommentable(row, payload);
      table.appendChild(row);
      return { el: row, index: line, quote: quote, payload: payload };
    });
    pane.innerHTML = '';
    pane.appendChild(table);
    return anchors;
  }

  function renderGherkin(pane, source) {
    pane.innerHTML = '';
    return parseGherkinBlocks(source).map((block, i) => {
      const anchor = gherkinAnchor(block, i);
      const el = gherkinBlockElement(block);
      appendGherkinLines(el, block.lines);
      markGherkinHeader(el);
      makeCommentable(el, anchor);
      pane.appendChild(el);
      return { el: el, index: i, quote: anchor.quote, payload: anchor };
    });
  }

  function gherkinBlockElement(block) {
    const el = document.createElement('div');
    el.className = 'gherkin-block';
    el.dataset.kind = block.kind;
    return el;
  }

  function markGherkinHeader(el) {
    const header = el.querySelector('.gl-keyword');
    if (header) header.classList.add('gl-header');
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

  // ===== diff view =====
  //
  // Renders the diff tree from revision-diff.cjs. Unchanged blocks look as they
  // do in the full view; added ones are green, removed ones red, and changed
  // ones mark their words inline. Every block a comment can attach to anchors
  // to the target revision's own unmarked block, never to the diff's mixed text.

  const MARKED_RENDER = {
    blocks: tokens => marked.parser(tokens),
    inline: tokens => marked.Parser.parseInline(tokens)
  };
  const revisionEntriesCache = new Map(); // revisionKey(latest doc) -> GET /revisions entries

  // The revision a diff compares against: the one before the doc's latest.
  // null when there is none or it can't be loaded (logged), so the full doc shows.
  async function baseRevisionFor(doc) {
    if (!doc.revision || doc.revision < 2) return null;
    let entries;
    try {
      entries = await revisionEntries(doc);
    } catch (e) {
      console.error('revision list for ' + doc.path + ' failed to load: ' + e.message);
      return null;
    }
    const entry = entries.find(e => e.revision === doc.revision - 1);
    if (!entry) return null;
    const baseDoc = { id: doc.id, path: doc.path, revision: entry.revision, sha256: entry.sha256 };
    const source = await docText(baseDoc);
    if (!textCache.has(revisionKey(baseDoc))) return null;
    return { revision: entry.revision, source: source };
  }

  async function revisionEntries(doc) {
    const key = revisionKey(doc);
    if (!revisionEntriesCache.has(key)) revisionEntriesCache.set(key, await fetchJson('/revisions/' + doc.id));
    return revisionEntriesCache.get(key);
  }

  // Returns {anchors, isIdentical}.
  function renderDiff(pane, id, view, baseSource, targetSource) {
    if (view === 'gherkin') return renderGherkinDiff(pane, baseSource, targetSource);
    if (view === 'source') return renderLinesDiff(pane, baseSource, targetSource);
    return renderMarkdownDiff(pane, id, baseSource, targetSource);
  }

  // The target revision's anchors, rendered off-screen.
  function detachedAnchors(renderInto) {
    return renderInto(document.createElement('div'));
  }

  function anchorDiffElement(el, targetAnchor, anchors) {
    makeCommentable(el, targetAnchor.payload);
    anchors.push({ el: el, index: targetAnchor.index, quote: targetAnchor.quote, payload: targetAnchor.payload });
  }

  function renderMarkdownDiff(pane, id, baseSource, targetSource) {
    const blocksOf = source => marked.lexer(source).filter(token => token.type !== 'space');
    const tree = diffMarkdown(blocksOf(baseSource), blocksOf(targetSource), MARKED_RENDER);
    const targetAnchors = detachedAnchors(container => renderRendered(container, id, targetSource));
    const anchors = [];
    pane.innerHTML = '';
    tree.nodes.forEach(node => {
      markdownNodeElements(node).forEach(el => {
        pane.appendChild(el);
        if (el.dataset.side !== 'base') anchorDiffElement(el, targetAnchors[node.targetIndex], anchors);
      });
    });
    rewriteImages(pane, id);
    return { anchors: anchors, isIdentical: tree.isIdentical };
  }

  // One node can yield two elements (a changed block that falls back to a
  // removal plus an addition); the removal is marked data-side="base".
  function markdownNodeElements(node) {
    if (node.op === 'equal') return [blockElement(node.target, null)];
    if (node.op === 'added') return [blockElement(node.target, 'd-added')];
    if (node.op === 'removed') return [blockElement(node.base, 'd-removed')];
    const changed = changedBlockElement(node);
    return changed ? [changed] : [blockElement(node.base, 'd-removed'), blockElement(node.target, 'd-added')];
  }

  // null when the change can't be shown in place: the caller falls back.
  function changedBlockElement(node) {
    if (node.words) return rebuiltBlockElement(node);
    if (node.items) return wrap(listDiffElement(node));
    if (node.rows) return wrap(tableDiffElement(node));
    if (node.lines) return wrap(codeDiffElement(node));
    if (node.children) return wrap(blockquoteDiffElement(node));
    return null;
  }

  function wrap(child) {
    const el = document.createElement('div');
    el.appendChild(child);
    return el;
  }

  function blockElement(token, diffClass) {
    const el = document.createElement('div');
    el.innerHTML = marked.parser([structuredClone(token)]);
    if (diffClass) el.classList.add(diffClass);
    if (diffClass === 'd-removed') el.dataset.side = 'base';
    return el;
  }

  // A changed paragraph or heading rebuilt from its word runs, or null if the
  // markers changed how it renders (checked against both unmarked revisions).
  function rebuiltBlockElement(node) {
    const prefix = node.kind === 'heading' ? '#'.repeat(node.target.depth) + ' ' : '';
    const el = document.createElement('div');
    el.innerHTML = marked.parse(prefix + wordsMarkdown(node.words));
    return rendersLike(el, blockElement(node.base, null), blockElement(node.target, null)) ? el : null;
  }

  function wordsMarkdown(words) {
    return words.map(run => {
      if (run.op === 'added') return '<ins class="d-add">' + run.text + '</ins>';
      if (run.op === 'removed') return '<del class="d-del">' + run.text + '</del>';
      return run.text;
    }).join('');
  }

  // Without its <del>s the marked element must read as the target; without
  // its <ins>s, as the base. Otherwise a marker landed inside markdown syntax.
  function rendersLike(markedEl, baseEl, targetEl) {
    return textWithout(markedEl, 'del') === normalizedText(targetEl) &&
      textWithout(markedEl, 'ins') === normalizedText(baseEl);
  }

  function textWithout(el, selector) {
    const copy = el.cloneNode(true);
    copy.querySelectorAll(selector).forEach(child => child.remove());
    return normalizedText(copy);
  }

  function normalizedText(el) {
    return el.textContent.replace(/\s+/g, ' ').trim();
  }

  function listDiffElement(node) {
    const list = document.createElement(node.target.ordered ? 'ol' : 'ul');
    if (node.target.ordered && node.target.start !== '' && node.target.start !== 1) list.start = node.target.start;
    node.items.forEach(item => {
      if (item.op === 'equal') list.appendChild(itemElement(node.target, item.target, null));
      else if (item.op === 'added') list.appendChild(itemElement(node.target, item.target, 'd-added'));
      else if (item.op === 'removed') list.appendChild(itemElement(node.base, item.base, 'd-removed'));
      else changedItemElements(node, item).forEach(li => list.appendChild(li));
    });
    return list;
  }

  // An item rendered as marked renders it: as the only item of its list.
  function itemElement(listToken, item, diffClass) {
    const holder = document.createElement('div');
    holder.innerHTML = marked.parser([Object.assign(structuredClone(listToken), { items: [structuredClone(item)] })]);
    const li = holder.querySelector('li');
    if (diffClass) li.classList.add(diffClass);
    return li;
  }

  function changedItemElements(node, item) {
    const baseLi = itemElement(node.base, item.base, null);
    const targetLi = itemElement(node.target, item.target, null);
    if (item.words) {
      const li = document.createElement('li');
      li.innerHTML = marked.parseInline(wordsMarkdown(item.words));
      if (rendersLike(li, baseLi, targetLi)) return [li];
    }
    baseLi.classList.add('d-removed');
    targetLi.classList.add('d-added');
    return [baseLi, targetLi];
  }

  function tableDiffElement(node) {
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    node.header.forEach(cell => head.appendChild(cellElement('th', cell)));
    const body = table.createTBody();
    node.rows.forEach(row => {
      const tr = body.insertRow();
      if (row.op === 'changed') {
        row.cells.forEach(cell => tr.appendChild(cellElement('td', cell)));
        return;
      }
      const cells = row.op === 'removed' ? row.base : row.target;
      if (row.op !== 'equal') tr.classList.add(row.op === 'added' ? 'd-added' : 'd-removed');
      cells.forEach(cell => tr.appendChild(inlineCell('td', cell.tokens)));
    });
    return table;
  }

  function cellElement(tag, cell) {
    if (cell.op === 'equal' || cell.op === 'added') return inlineCell(tag, cell.target.tokens);
    if (cell.op === 'removed') return inlineCell(tag, cell.base.tokens);
    const el = document.createElement(tag);
    el.innerHTML = marked.parseInline(wordsMarkdown(cell.words));
    if (rendersLike(el, inlineCell(tag, cell.base.tokens), inlineCell(tag, cell.target.tokens))) return el;
    el.innerHTML = '<del class="d-del">' + MARKED_RENDER.inline(structuredClone(cell.base.tokens)) + '</del>' +
      '<ins class="d-add">' + MARKED_RENDER.inline(structuredClone(cell.target.tokens)) + '</ins>';
    return el;
  }

  function inlineCell(tag, tokens) {
    const el = document.createElement(tag);
    el.innerHTML = MARKED_RENDER.inline(structuredClone(tokens));
    return el;
  }

  // Code is built as DOM: <ins>/<del> inside a fence would be escaped by marked.
  function codeDiffElement(node) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    node.lines.forEach((line, i) => {
      if (i > 0) code.appendChild(document.createTextNode('\n'));
      code.appendChild(lineElement(line));
    });
    pre.appendChild(code);
    return pre;
  }

  // One diff line as a span: whole-line class for added/removed, word runs
  // for changed.
  function lineElement(line) {
    const span = document.createElement('span');
    if (line.op === 'changed') {
      line.words.forEach(run => span.appendChild(wordRunElement(run)));
      return span;
    }
    span.textContent = line.op === 'removed' ? line.base : line.target;
    if (line.op !== 'equal') span.className = line.op === 'added' ? 'd-added' : 'd-removed';
    return span;
  }

  function wordRunElement(run) {
    if (run.op === 'equal') return document.createTextNode(run.text);
    const el = document.createElement(run.op === 'added' ? 'ins' : 'del');
    el.className = run.op === 'added' ? 'd-add' : 'd-del';
    el.textContent = run.text;
    return el;
  }

  function blockquoteDiffElement(node) {
    const quote = document.createElement('blockquote');
    node.children.forEach(child => markdownNodeElements(child).forEach(el => quote.appendChild(el)));
    return quote;
  }

  function renderGherkinDiff(pane, baseSource, targetSource) {
    const tree = diffGherkin(parseGherkinBlocks(baseSource), parseGherkinBlocks(targetSource));
    const targetAnchors = detachedAnchors(container => renderGherkin(container, targetSource));
    const anchors = [];
    pane.innerHTML = '';
    tree.nodes.forEach(node => {
      const el = gherkinNodeElement(node);
      pane.appendChild(el);
      if (node.op !== 'removed') anchorDiffElement(el, targetAnchors[node.targetIndex], anchors);
    });
    return { anchors: anchors, isIdentical: tree.isIdentical };
  }

  function gherkinNodeElement(node) {
    const block = node.op === 'removed' ? node.base : node.target;
    const el = gherkinBlockElement(block);
    if (node.op === 'changed') {
      node.lines.forEach(line => el.appendChild(gherkinDiffLine(node, line)));
    } else {
      appendGherkinLines(el, block.lines);
      if (node.op !== 'equal') el.classList.add(node.op === 'added' ? 'd-added' : 'd-removed');
    }
    markGherkinHeader(el);
    return el;
  }

  // Equal, added and removed lines keep their Gherkin styling; a changed line
  // shows its word runs.
  function gherkinDiffLine(node, line) {
    if (line.op === 'changed') {
      const el = document.createElement('div');
      el.className = 'gl gl-' + node.target.lines[line.targetIndex].kind;
      line.words.forEach(run => el.appendChild(wordRunElement(run)));
      return el;
    }
    const source = line.op === 'removed' ? node.base.lines[line.baseIndex] : node.target.lines[line.targetIndex];
    const el = gherkinLine(source);
    if (line.op !== 'equal') el.classList.add(line.op === 'added' ? 'd-added' : 'd-removed');
    return el;
  }

  // Plain-text docs: numbered lines, as in the source view.
  function renderLinesDiff(pane, baseSource, targetSource) {
    const lines = diffLines(baseSource, targetSource);
    const targetAnchors = detachedAnchors(container => renderSource(container, targetSource));
    const anchors = [];
    const table = document.createElement('table');
    table.className = 'source';
    lines.forEach(line => {
      const row = document.createElement('tr');
      const number = document.createElement('td');
      number.className = 'ln';
      number.textContent = line.op === 'removed' ? '' : String(line.targetIndex + 1);
      const code = document.createElement('td');
      code.className = 'code';
      code.appendChild(lineElement(line));
      row.appendChild(number);
      row.appendChild(code);
      if (line.op === 'added' || line.op === 'removed') row.classList.add(line.op === 'added' ? 'd-added' : 'd-removed');
      table.appendChild(row);
      // Source anchors are 1-based line numbers.
      if (line.op !== 'removed') anchorDiffElement(row, targetAnchors[line.targetIndex], anchors);
    });
    pane.innerHTML = '';
    pane.appendChild(table);
    return { anchors: anchors, isIdentical: lines.every(line => line.op === 'equal') };
  }

  // comparison: {from, to, isIdentical} when a diff is on screen, else null.
  function renderHeader(doc, view, comparison) {
    $('#diffinfo').textContent = comparisonText(comparison);
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

  function comparisonText(comparison) {
    if (!comparison) return '';
    const range = 'revision ' + comparison.from + ' and revision ' + comparison.to;
    return comparison.isIdentical ? 'No changes between ' + range : 'Changes between ' + range;
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

  // anchor: { view, quote, blockIndex? , line? } — copied onto the comment event,
  // plus the quote's occurrence among the anchors on screen.
  function openPopover(el, clickedAnchor) {
    const onScreen = renderedAnchors.find(a => a.el === el);
    const anchor = Object.assign({}, clickedAnchor, { occurrence: occurrenceOf(renderedAnchors, onScreen) });
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
    applySidebarWidth($('#sidebar').getBoundingClientRect().width);
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
    if (!shownRevisions.has(doc.path)) { flash('Nothing to approve — this revision failed to load'); return; }
    sendEvent({ type: 'approve', doc: doc.path });
    markDocSent(doc.path);
    renderSubmitButton();
    showAllCardsSent();
    // The revision on screen, not the latest /docs reported: a newer one may
    // still be loading.
    approved.set(doc.path, shownRevisions.get(doc.path));
    renderSidebar();
    renderHeader(doc, currentViewFor(doc.path));
    flash('Approved');
  };

  connect();
  loadSavedComments().then(refreshDocs);
})();
