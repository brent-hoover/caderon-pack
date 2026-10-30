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
  const shownRevisions = new Map(); // path -> {revision, sha256} of the target revision on screen
  // path -> {base, target, lastBase}: what the operator is comparing. base null
  // is the full document; lastBase is what Show changes returns to.
  const comparisons = new Map();
  // Every comment saved this session, in order: [{event, isSent}]. Rebuilt from
  // GET /events on load; a comment is sent once a submit or approve on its own
  // doc follows it.
  let savedComments = [];
  let currentOrphans = [];        // [{event, note, status}]: comments of the current doc/view shown at doc level
  let renderedAnchors = [];       // [{el, index, quote}] of the doc on screen
  const viewChoice = new Map();   // path -> view the operator toggled to (in-memory; resets on reload)
  const approvals = new Map();    // path -> {revision, sha256} the operator approved
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
  // Returns {text, isLoaded}: isLoaded is this call's own outcome, so an
  // overlapping successful load can't make a failed one look shown. Only
  // successful loads are cached, so a failed one retries on the next notice.
  async function docText(doc) {
    const key = revisionKey(doc);
    if (textCache.has(key)) return { text: textCache.get(key), isLoaded: true };
    if (doc.revision === null) {
      return { text: '*' + doc.path + ' has no revisions yet — the agent needs to run serve-doc or revise.*', isLoaded: false };
    }
    let status;
    let text;
    try {
      const r = await fetch('/doc/' + doc.id + '/rev/' + doc.revision + '?sha256=' + doc.sha256);
      status = r.status;
      // The body can fail after the headers arrived, so it is read in here too.
      text = r.ok ? await r.text() : null;
    } catch (e) {
      console.error('revision ' + doc.revision + ' of ' + doc.path + ' failed to load: ' + e.message);
      return { text: '*Failed to load revision ' + doc.revision + ' of ' + doc.path + ' (network error)*', isLoaded: false };
    }
    if (text === null) return { text: '*Failed to load revision ' + doc.revision + ' of ' + doc.path + ' (' + status + ')*', isLoaded: false };
    textCache.set(key, text);
    return { text: text, isLoaded: true };
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
    remapCurrentId();
    if (id === currentId) {
      // A new revision of the doc on screen: show what changed since the one
      // the operator was looking at.
      // Until the new revision is on screen, there is nothing current to approve.
      $('#approve').disabled = true;
      const shown = shownRevisions.get(doc.path);
      const base = shown && shown.revision < doc.revision ? shown.revision : null;
      comparisons.set(doc.path, { base: base, target: doc.revision, lastBase: base });
      await renderDoc(id, { preserveScroll: true });
    } else {
      // Opened later, it starts from the last revision the operator viewed.
      comparisons.delete(doc.path);
      updated.add(doc.path);
    }
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
      if (isApprovalCurrent(doc)) {
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
      // Approvals from viewers that predate revisions name no revision and
      // can't be tied to content, so they don't count.
      if (event.type === 'approve' && event.revision !== undefined) {
        approvals.set(event.doc, { revision: event.revision, sha256: event.sha256 });
      }
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

  // Comments made on the revision on screen attach to the block whose text
  // matches their quote (occurrence, then the nearest index, break ties).
  // Comments made on an earlier revision are carried forward through the diffs
  // between there and the target, and show whether their text has changed
  // since. placement: {target, carry (see carryContext, or null), removedBlocks
  // (anchor index in the base revision -> its removed element in the diff on
  // screen), base (the diff's base revision, or null)}.
  // Returns the comments to show at doc level: [{event, note, status}].
  function attachCommentCards(docPath, view, anchors, placement) {
    const cardsByEl = new Map();
    const docLevel = [];
    const attach = (el, saved, status) => {
      if (!cardsByEl.has(el)) cardsByEl.set(el, []);
      cardsByEl.get(el).push({ saved: saved, status: status });
    };
    const elAt = index => (anchors.find(anchor => anchor.index === index) || {}).el;
    commentsIn(docPath, view).forEach(saved => {
      const revision = commentRevision(saved.event);
      if (revision > placement.target) {
        docLevel.push({ event: saved.event, note: 'Made on revision ' + revision + ': “' + saved.event.quote + '”' });
        return;
      }
      if (revision === placement.target || !placement.carry) {
        const anchor = resolveAnchor(saved.event, anchors);
        if (anchor) attach(anchor.el, saved, null);
        else docLevel.push({ event: saved.event, note: 'Commented text has changed: “' + saved.event.quote + '”' });
        return;
      }
      const carry = placement.carry;
      const outcome = carryForward(saved.event, carry.anchorsFor, (v, from) => carry.chainBetween(from, placement.target));
      if (outcome.state === 'unanchored') {
        docLevel.push({ event: saved.event, note: 'Anchor not found: “' + saved.event.quote + '”' });
      } else if (outcome.state === 'open') {
        attach(elAt(outcome.index), saved, 'open');
      } else if (outcome.state === 'addressed') {
        attach(elAt(outcome.index), saved, 'addressed in revision ' + outcome.revision);
      } else {
        const status = 'addressed in revision ' + outcome.revision + ' (text removed)';
        const el = removedBlockFor(saved.event, placement) || elAt(outcome.afterIndex);
        if (el) attach(el, saved, status);
        else docLevel.push({ event: saved.event, note: 'Commented text was removed: “' + saved.event.quote + '”', status: status });
      }
    });
    cardsByEl.forEach((comments, el) => attachComments(el, comments));
    return docLevel;
  }

  // The removed element in the diff on screen that a carried comment's block
  // became: only when the block still exists in the diff's base revision.
  function removedBlockFor(event, placement) {
    const revision = commentRevision(event);
    if (placement.base === null || placement.base < revision) return null;
    const carry = placement.carry;
    const inBase = carryForward(event, carry.anchorsFor, (v, from) => carry.chainBetween(from, placement.base));
    if (inBase.state !== 'open' && inBase.state !== 'addressed') return null;
    return placement.removedBlocks.get(inBase.index) || null;
  }

  // Comments from viewers that predate revisions were made on revision 1.
  function commentRevision(event) {
    return event.revision !== undefined ? event.revision : 1;
  }

  // Submit is per doc: it counts and sends only the current doc's comments.
  function renderSubmitButton() {
    const docPath = currentId === null ? null : docs[currentId].path;
    const pendingCount = savedComments.filter(saved => !saved.isSent && saved.event.doc === docPath).length;
    const btn = $('#submit-comments');
    btn.textContent = 'Submit comments (' + pendingCount + ')';
    btn.disabled = pendingCount === 0;
  }

  // status: where a carried-forward comment stands now ('open', 'addressed in
  // revision k', …), or null for a comment on the revision on screen.
  function commentCard(saved, status) {
    const card = document.createElement('div');
    card.className = 'comment-card';
    const badge = document.createElement('span');
    badge.className = 'badge ' + (saved.isSent ? 'sent' : 'pending');
    badge.textContent = saved.isSent ? 'sent' : 'pending';
    card.appendChild(badge);
    if (status) {
      const statusBadge = document.createElement('span');
      statusBadge.className = 'status-badge ' + (status === 'open' ? 'open' : 'addressed');
      statusBadge.textContent = status;
      card.appendChild(statusBadge);
    }
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
    comments.forEach(comment => cards.appendChild(commentCard(comment.saved, comment.status)));
    insertAfter(el, cards);
  }

  // Doc-level entries are kept as events and looked up here, so their sent
  // status is current even after a Submit replaced the savedComments entries.
  function renderDocComments(doc, docLevel) {
    const list = $('#doc-comments');
    list.innerHTML = '';
    commentsIn(doc.path, 'doc').forEach(saved => list.appendChild(commentCard(saved, null)));
    docLevel.forEach(entry => {
      const saved = savedComments.find(candidate => candidate.event === entry.event);
      if (!saved) return;
      const card = commentCard(saved, entry.status || null);
      const note = document.createElement('div');
      note.className = 'orphan';
      note.textContent = entry.note;
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

  let headerState = null; // the arguments of the last renderHeader, for refreshes

  let renderGeneration = 0; // bumped per renderDoc; a superseded render discards its result

  async function renderDoc(id, opts) {
    const doc = docs[id];
    if (!doc) return;
    const generation = ++renderGeneration;
    // A draft open on the previous render must not be saved against this one.
    closePopover();
    const view = currentViewFor(doc.path);
    // Markdown and Gherkin source views show the revision itself, never a diff.
    const isDiffable = !(view === 'source' && TOGGLEABLE_EXTENSIONS.includes(extensionOf(doc.path)));
    const entries = await revisionEntriesOrNone(doc);
    // comparisonFor records the comparison it picks, so a superseded render
    // must stop before it.
    if (generation !== renderGeneration) return;
    const comparison = comparisonFor(doc, entries);
    const target = await revisionText(doc, entries, comparison.target);
    const base = isDiffable && comparison.base !== null ? await revisionText(doc, entries, comparison.base) : null;
    const carry = await carryContext(doc, view, entries, comparison.target, id);
    // Everything below is synchronous: what is drawn, and what Approve would
    // approve, change together — and only for the newest render.
    if (generation !== renderGeneration) return;
    const pane = $('#doc');
    const scrollTop = opts.preserveScroll ? pane.scrollTop : 0;
    // A failed load shows an error, not the revision, so it can't be approved.
    if (target.isLoaded) {
      shownRevisions.set(doc.path, { revision: comparison.target, sha256: entrySha256(doc, entries, comparison.target) });
      writeLastViewed(doc.path, comparison.target);
    } else {
      shownRevisions.delete(doc.path);
    }
    let anchors;
    let shownComparison = null;
    let removedBlocks = new Map();
    if (base && base.isLoaded && target.isLoaded) {
      const shown = renderDiff(pane, id, view, base.text, target.text);
      anchors = shown.anchors;
      removedBlocks = shown.removedBlocks;
      shownComparison = { from: comparison.base, to: comparison.target, isIdentical: shown.isIdentical };
    } else if (view === 'source') anchors = renderSource(pane, target.text);
    else if (view === 'gherkin') anchors = renderGherkin(pane, target.text);
    else anchors = renderRendered(pane, id, target.text);
    renderedAnchors = anchors;
    currentOrphans = attachCommentCards(doc.path, view, anchors, {
      target: comparison.target, carry: carry, removedBlocks: removedBlocks,
      base: shownComparison ? shownComparison.from : null
    });
    headerState = { doc: doc, view: view, shownComparison: shownComparison, entries: entries, comparison: comparison };
    renderHeader(headerState);
    renderDocComments(doc, currentOrphans);
    pane.scrollTop = scrollTop;
  }

  function refreshHeader() {
    if (headerState) renderHeader(headerState);
  }

  // Each renderer fills the pane and returns its commentable anchors.
  // One wrapper per non-space top-level token: wrapper i is block i, the same
  // index the diff and comment carry-forward use, even for a token that
  // renders nothing (an HTML comment) or several elements.
  function renderRendered(pane, id, source) {
    pane.innerHTML = '';
    markdownBlocks(source).forEach(token => {
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

  // The doc's revision index, or [] when it can't be loaded (logged): the
  // latest revision then still shows, without navigation.
  async function revisionEntriesOrNone(doc) {
    if (doc.revision === null) return [];
    try {
      return await revisionEntries(doc);
    } catch (e) {
      console.error('revision list for ' + doc.path + ' failed to load: ' + e.message);
      return [];
    }
  }

  function entrySha256(doc, entries, revision) {
    const entry = entries.find(e => e.revision === revision);
    if (entry) return entry.sha256;
    return revision === doc.revision ? doc.sha256 : null;
  }

  // {text, isLoaded} of one revision of the doc.
  async function revisionText(doc, entries, revision) {
    const sha256 = entrySha256(doc, entries, revision);
    if (revision === null || sha256 === null) return docText(doc);
    return docText({ id: doc.id, path: doc.path, revision: revision, sha256: sha256 });
  }

  // What carrying comments forward to the target needs: every revision from
  // the oldest one commented on (in this view) up to the target, loaded.
  // null when no comment predates the target, or a revision failed to load
  // (logged); comments then attach to the target by quote, as they are.
  async function carryContext(doc, view, entries, target, id) {
    const older = commentsIn(doc.path, view).map(saved => commentRevision(saved.event)).filter(r => r < target);
    if (older.length === 0 || entries.length === 0) return null;
    const texts = new Map();
    for (let revision = Math.min(...older); revision <= target; revision++) {
      const loaded = await revisionText(doc, entries, revision);
      if (!loaded.isLoaded) {
        console.error('revision ' + revision + ' of ' + doc.path + ' unavailable; comments shown without carry-forward');
        return null;
      }
      texts.set(revision, loaded.text);
    }
    return {
      anchorsFor: revision => offscreenAnchors(view, id, texts.get(revision)),
      chainBetween: (from, to) => {
        const chain = [];
        for (let revision = from; revision < to; revision++) chain.push(diffNodes(view, texts.get(revision), texts.get(revision + 1)));
        return chain;
      }
    };
  }

  function offscreenAnchors(view, id, source) {
    const container = document.createElement('div');
    if (view === 'source') return renderSource(container, source);
    if (view === 'gherkin') return renderGherkin(container, source);
    return renderRendered(container, id, source);
  }

  // Top-level diff nodes between two revisions, in the view's own units:
  // markdown blocks, Gherkin blocks, or source lines.
  function diffNodes(view, baseSource, targetSource) {
    if (view === 'source') return diffLines(baseSource, targetSource);
    if (view === 'gherkin') return diffGherkin(parseGherkinBlocks(baseSource), parseGherkinBlocks(targetSource)).nodes;
    return diffMarkdown(markdownBlocks(baseSource), markdownBlocks(targetSource), MARKED_RENDER).nodes;
  }

  // What to show: the operator's choice for this doc, else — when the doc has
  // revisions they haven't seen — the diff from the last one they viewed,
  // else the latest revision in full.
  function comparisonFor(doc, entries) {
    const chosen = comparisons.get(doc.path);
    if (chosen && entries.some(e => e.revision === chosen.target)) return chosen;
    const lastViewed = readLastViewed(doc.path);
    const hasUnseen = lastViewed !== null && lastViewed < doc.revision && entries.some(e => e.revision === lastViewed);
    const opened = hasUnseen
      ? { base: lastViewed, target: doc.revision, lastBase: lastViewed }
      : { base: null, target: doc.revision, lastBase: null };
    comparisons.set(doc.path, opened);
    return opened;
  }

  const LAST_VIEWED_KEY_PREFIX = 'mdreview-last-viewed:';

  // Per-browser convenience: storage can be unavailable or blocked, and then
  // every doc simply opens on its latest revision.
  function readLastViewed(docPath) {
    let stored;
    try { stored = localStorage.getItem(LAST_VIEWED_KEY_PREFIX + docPath); } catch (e) { return null; }
    const revision = Number(stored);
    return stored !== null && Number.isInteger(revision) && revision > 0 ? revision : null;
  }

  function writeLastViewed(docPath, revision) {
    try { localStorage.setItem(LAST_VIEWED_KEY_PREFIX + docPath, String(revision)); } catch (e) { /* storage unavailable */ }
  }

  // An approval still names a revision in the doc's history (deleted and
  // recreated history can reuse the number for different content).
  function validApproval(doc, entries) {
    const approval = approvals.get(doc.path);
    if (!approval) return null;
    const entry = entries.find(e => e.revision === approval.revision);
    return entry && entry.sha256 === approval.sha256 ? approval : null;
  }

  function isApprovalCurrent(doc) {
    const approval = approvals.get(doc.path);
    return Boolean(approval) && approval.revision === doc.revision && approval.sha256 === doc.sha256;
  }

  function showComparison(base, target) {
    const comparison = comparisons.get(currentPath);
    comparisons.set(currentPath, { base: base, target: target, lastBase: base !== null ? base : comparison.lastBase });
    renderDoc(currentId, { preserveScroll: false });
  }

  const BASE_NOT_OLDER_MESSAGE = 'Base revision must be older than the target';

  $('#base-revision').onchange = (e) => {
    const comparison = comparisons.get(currentPath);
    const base = Number(e.target.value);
    if (base >= comparison.target) { flash(BASE_NOT_OLDER_MESSAGE); refreshHeader(); return; }
    showComparison(base, comparison.target);
  };

  $('#target-revision').onchange = (e) => {
    const comparison = comparisons.get(currentPath);
    const target = Number(e.target.value);
    if (comparison.base !== null && comparison.base >= target) { flash(BASE_NOT_OLDER_MESSAGE); refreshHeader(); return; }
    showComparison(comparison.base, target);
  };

  $('#diff-toggle').onclick = () => {
    const comparison = comparisons.get(currentPath);
    if (comparison.base !== null) { showComparison(null, comparison.target); return; }
    const hasLastBase = comparison.lastBase !== null && comparison.lastBase < comparison.target;
    showComparison(hasLastBase ? comparison.lastBase : comparison.target - 1, comparison.target);
  };

  $('#since-approved').onclick = () => {
    const doc = docs[currentId];
    showComparison(approvals.get(doc.path).revision, doc.revision);
  };

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

  // The block list both views render: non-space tokens, with HTML containers
  // that span tokens grouped into one block.
  function markdownBlocks(source) {
    return groupHtmlContainers(marked.lexer(source).filter(token => token.type !== 'space'), MARKED_RENDER);
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
    const tree = diffMarkdown(markdownBlocks(baseSource), markdownBlocks(targetSource), MARKED_RENDER);
    const targetAnchors = detachedAnchors(container => renderRendered(container, id, targetSource));
    const anchors = [];
    pane.innerHTML = '';
    const removedBlocks = new Map();
    tree.nodes.forEach(node => {
      markdownNodeElements(node).forEach(el => {
        pane.appendChild(el);
        if (el.dataset.side !== 'base') anchorDiffElement(el, targetAnchors[node.targetIndex], anchors);
        else if (node.op === 'removed') removedBlocks.set(node.baseIndex, el);
      });
    });
    rewriteImages(pane, id);
    return { anchors: anchors, isIdentical: tree.isIdentical, removedBlocks: removedBlocks };
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
    // A level change has no word to mark: show the old and new heading.
    if (node.kind === 'heading' && node.base.depth !== node.target.depth) return null;
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
      li.innerHTML = taskCheckbox(item.target) + marked.parseInline(wordsMarkdown(item.words));
      if (rendersLike(li, baseLi, targetLi)) return [li];
    }
    baseLi.classList.add('d-removed');
    targetLi.classList.add('d-added');
    return [baseLi, targetLi];
  }

  // marked keeps a task item's checkbox outside its words; a rebuilt item puts
  // it back. (A checked-state change is never rebuilt: it's a replaced item.)
  function taskCheckbox(item) {
    if (!item.task) return '';
    return '<input type="checkbox" disabled' + (item.checked ? ' checked' : '') + '> ';
  }

  function tableDiffElement(node) {
    const align = node.target.align;
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    node.header.forEach((cell, i) => head.appendChild(cellElement('th', cell, align[i])));
    const body = table.createTBody();
    node.rows.forEach(row => {
      const tr = body.insertRow();
      if (row.op === 'changed') {
        row.cells.forEach((cell, i) => tr.appendChild(cellElement('td', cell, align[i])));
        return;
      }
      const cells = row.op === 'removed' ? row.base : row.target;
      if (row.op !== 'equal') tr.classList.add(row.op === 'added' ? 'd-added' : 'd-removed');
      cells.forEach((cell, i) => tr.appendChild(inlineCell('td', cell.tokens, align[i])));
    });
    return table;
  }

  // A cell of a changed row or of the header: added and removed cells (a column
  // gained or dropped) are marked like added and removed blocks.
  function cellElement(tag, cell, align) {
    if (cell.op === 'equal') return inlineCell(tag, cell.target.tokens, align);
    if (cell.op === 'added' || cell.op === 'removed') {
      const el = inlineCell(tag, (cell.op === 'added' ? cell.target : cell.base).tokens, align);
      el.classList.add(cell.op === 'added' ? 'd-added' : 'd-removed');
      return el;
    }
    const el = inlineCell(tag, [], align);
    el.innerHTML = marked.parseInline(wordsMarkdown(cell.words));
    if (rendersLike(el, inlineCell(tag, cell.base.tokens, align), inlineCell(tag, cell.target.tokens, align))) return el;
    el.innerHTML = '<del class="d-del">' + MARKED_RENDER.inline(structuredClone(cell.base.tokens)) + '</del>' +
      '<ins class="d-add">' + MARKED_RENDER.inline(structuredClone(cell.target.tokens)) + '</ins>';
    return el;
  }

  function inlineCell(tag, tokens, align) {
    const el = document.createElement(tag);
    el.innerHTML = MARKED_RENDER.inline(structuredClone(tokens));
    if (align) el.style.textAlign = align;
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
    const removedBlocks = new Map();
    tree.nodes.forEach(node => {
      const el = gherkinNodeElement(node);
      pane.appendChild(el);
      if (node.op !== 'removed') anchorDiffElement(el, targetAnchors[node.targetIndex], anchors);
      else removedBlocks.set(node.baseIndex, el);
    });
    return { anchors: anchors, isIdentical: tree.isIdentical, removedBlocks: removedBlocks };
  }

  function gherkinNodeElement(node) {
    const block = node.op === 'removed' ? node.base : node.target;
    const el = gherkinBlockElement(block);
    if (node.op === 'changed') {
      appendGherkinDiffLines(el, node);
    } else {
      appendGherkinLines(el, block.lines);
      if (node.op !== 'equal') el.classList.add(node.op === 'added' ? 'd-added' : 'd-removed');
    }
    markGherkinHeader(el);
    return el;
  }

  // Like appendGherkinLines: consecutive table lines become one table, every
  // other line one row div, each keeping its diff marking.
  function appendGherkinDiffLines(container, node) {
    let tableLines = [];
    const flushTable = () => {
      if (tableLines.length > 0) container.appendChild(gherkinDiffTable(node, tableLines));
      tableLines = [];
    };
    node.lines.forEach(line => {
      if (gherkinLineOf(node, line).kind === 'table') { tableLines.push(line); return; }
      flushTable();
      container.appendChild(gherkinDiffLine(node, line));
    });
    flushTable();
  }

  // The parsed Gherkin line a diff line came from (the target's, unless removed).
  function gherkinLineOf(node, line) {
    return line.op === 'removed' ? node.base.lines[line.baseIndex] : node.target.lines[line.targetIndex];
  }

  // First row is the header row, as in gherkinTable. A changed row marks the
  // cells whose text changed.
  function gherkinDiffTable(node, lines) {
    const table = document.createElement('table');
    table.className = 'gherkin-table';
    lines.forEach((line, rowIndex) => {
      const row = document.createElement('tr');
      const tag = rowIndex === 0 ? 'th' : 'td';
      const targetCells = line.op === 'removed' ? [] : splitTableRow(node.target.lines[line.targetIndex].text);
      const baseCells = line.op === 'added' ? [] : splitTableRow(node.base.lines[line.baseIndex].text);
      if (line.op === 'changed') {
        // Every position of either row, so a dropped column still shows.
        const width = Math.max(baseCells.length, targetCells.length);
        for (let i = 0; i < width; i++) row.appendChild(changedGherkinCell(tag, baseCells[i], targetCells[i]));
      } else {
        (line.op === 'removed' ? baseCells : targetCells).forEach(text => {
          const cell = document.createElement(tag);
          cell.textContent = text;
          row.appendChild(cell);
        });
      }
      if (line.op === 'added' || line.op === 'removed') row.classList.add(line.op === 'added' ? 'd-added' : 'd-removed');
      table.appendChild(row);
    });
    return table;
  }

  // baseText or targetText is undefined for a column only one side has.
  function changedGherkinCell(tag, baseText, targetText) {
    const cell = document.createElement(tag);
    if (targetText === undefined) {
      cell.textContent = baseText;
      cell.classList.add('d-removed');
    } else if (baseText === undefined) {
      cell.textContent = targetText;
      cell.classList.add('d-added');
    } else if (baseText === targetText) {
      cell.textContent = targetText;
    } else {
      cell.appendChild(wordRunElement({ op: 'removed', text: baseText }));
      cell.appendChild(wordRunElement({ op: 'added', text: targetText }));
    }
    return cell;
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
    const removedBlocks = new Map(); // 1-based base line -> its removed row
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
      else removedBlocks.set(line.baseIndex + 1, row);
    });
    pane.innerHTML = '';
    pane.appendChild(table);
    return { anchors: anchors, isIdentical: lines.every(line => line.op === 'equal'), removedBlocks: removedBlocks };
  }

  const APPROVE_LATEST_HINT = 'Approve the latest revision';

  // state: {doc, view, shownComparison ({from, to, isIdentical} when a diff is
  // on screen, else null), entries, comparison}.
  function renderHeader(state) {
    const doc = state.doc;
    $('#diffinfo').textContent = comparisonText(state.shownComparison);
    renderRevisionControls(doc, state.entries, state.comparison);
    const isApproved = state.comparison.target === doc.revision && isApprovalCurrent(doc);
    $('#docheader').textContent = titleFor(doc) + (isApproved ? '  ✓ approved' : '');
    $('#docheader').title = doc.path;
    const btn = $('#approve');
    btn.textContent = isApproved ? 'Approved ✓' : 'Approve';
    btn.classList.toggle('approved', isApproved);
    // Only the latest revision can be signed off.
    const isOlderRevision = state.comparison.target !== doc.revision;
    btn.disabled = isOlderRevision;
    btn.title = isOlderRevision ? APPROVE_LATEST_HINT : '';
    renderSubmitButton();
    const toggle = $('#view-toggle');
    toggle.hidden = !TOGGLEABLE_EXTENSIONS.includes(extensionOf(doc.path));
    toggle.textContent = state.view === 'source' ? 'Rendered' : 'Source';
  }

  function renderRevisionControls(doc, entries, comparison) {
    const controls = $('#revision-controls');
    controls.hidden = entries.length === 0;
    if (controls.hidden) return;
    $('#revinfo').textContent = 'Revision ' + comparison.target + ' of ' + doc.revision;
    const base = $('#base-revision');
    base.hidden = comparison.base === null;
    fillRevisionSelect(base, entries, comparison.base);
    fillRevisionSelect($('#target-revision'), entries, comparison.target);
    const toggle = $('#diff-toggle');
    toggle.textContent = comparison.base === null ? 'Show changes' : 'Full document';
    toggle.disabled = comparison.base === null && comparison.target <= 1;
    const approval = validApproval(doc, entries);
    const since = $('#since-approved');
    since.hidden = !approval || approval.revision >= doc.revision;
    if (!since.hidden) since.textContent = 'Changes since approved (rev ' + approval.revision + ')';
  }

  function fillRevisionSelect(select, entries, selected) {
    select.innerHTML = '';
    entries.forEach(entry => {
      const option = document.createElement('option');
      option.value = String(entry.revision);
      option.textContent = 'rev ' + entry.revision;
      option.selected = entry.revision === selected;
      select.appendChild(option);
    });
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
    // The doc this draft belongs to, fixed now: currentId may change before Save.
    const docPath = docs[currentId].path;
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
      saveInlineComment(Object.assign({ type: 'comment', doc: docPath }, anchor,
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

  // Every comment records the revision on screen it was made on.
  function recordComment(event) {
    const shown = shownRevisions.get(event.doc);
    if (shown) event.revision = shown.revision;
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
    const shown = shownRevisions.get(doc.path);
    if (!shown) { flash('Nothing to approve — this revision failed to load'); return; }
    // A newer revision may have been announced and still be loading.
    if (shown.revision !== doc.revision || shown.sha256 !== doc.sha256) { flash(APPROVE_LATEST_HINT); return; }
    sendEvent({ type: 'approve', doc: doc.path, revision: shown.revision, sha256: shown.sha256 });
    markDocSent(doc.path);
    renderSubmitButton();
    showAllCardsSent();
    // The revision on screen, not the latest /docs reported: a newer one may
    // still be loading.
    approvals.set(doc.path, shown);
    renderSidebar();
    refreshHeader();
    flash('Approved');
  };

  connect();
  loadSavedComments().then(refreshDocs);
})();
