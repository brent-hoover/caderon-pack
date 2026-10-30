// Structure-aware diff between two revisions of a reviewed doc.
//
// Loaded two ways: inlined into the viewer page as a plain <script> (where the
// top-level functions become globals), and require()d by the Node tests. The
// .cjs extension keeps it CommonJS under the repo's "type": "module".
//
// Pure: it never touches the DOM or lexes markdown itself. Callers pass marked
// tokens plus a `render` with `blocks(tokens)` and `inline(tokens)` returning
// HTML, so the same code runs against the vendored marked in both places.
//
// Diff tree node: { op: 'equal'|'added'|'removed'|'changed', kind, base?, target?,
// baseIndex?, targetIndex?, and for 'changed' one of: words | items | header+rows
// | lines | children }. A word run is { op, text }.

// Inline tokens that never split into words, so a diff marker can't land
// inside an emphasis run, a code span or a link.
const ATOMIC_INLINE_TYPES = ['strong', 'em', 'del', 'codespan', 'link', 'image'];

// Share of distinct words (Jaccard) two blocks need in common to pair as an
// edit in a longer run. 0.3 still pairs "retries 3" with "retries 5" while
// keeping unrelated sentences apart.
const PAIRING_SIMILARITY = 0.3;

// Elements with no closing tag, so they never open a container.
const VOID_ELEMENTS = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'];
const TAG_PATTERN = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;

// marked splits raw HTML at blank lines, so a container such as
// <details>…markdown…</details> arrives as an opening html token, markdown
// tokens, then a closing html token. Rendered one token at a time, the
// container would close early and its markdown would spill out of it, so the
// run becomes one html block. This is the block list the viewer renders and
// diffs: block i is entry i.
function groupHtmlContainers(blocks, render) {
  const grouped = [];
  let open = null;
  for (const token of blocks) {
    const balance = token.type === 'html' ? tagBalance(token.raw) : 0;
    if (open) {
      open.tokens.push(token);
      open.depth += balance;
      if (open.depth <= 0) { grouped.push(mergedHtmlBlock(open.tokens, render)); open = null; }
    } else if (balance > 0) {
      open = { tokens: [token], depth: balance };
    } else {
      grouped.push(token);
    }
  }
  // A container never closed runs to the end of the doc, as a browser would.
  if (open) grouped.push(mergedHtmlBlock(open.tokens, render));
  return grouped;
}

function mergedHtmlBlock(tokens, render) {
  return { type: 'html', block: true, pre: false, raw: tokens.map(token => token.raw).join(''),
    text: render.blocks(clone(tokens)) };
}

// Opening tags minus closing tags, ignoring void and self-closed elements.
function tagBalance(html) {
  let balance = 0;
  for (const match of html.matchAll(TAG_PATTERN)) {
    const [, closing, name, selfClosing] = match;
    if (VOID_ELEMENTS.includes(name.toLowerCase()) || selfClosing) continue;
    balance += closing ? -1 : 1;
  }
  return balance;
}

// Top-level diff of two revisions' non-space block tokens.
function diffMarkdown(baseBlocks, targetBlocks, render) {
  const nodes = diffBlocks(baseBlocks, targetBlocks, render);
  return { nodes, isIdentical: nodes.every(node => node.op === 'equal') };
}

function diffBlocks(baseBlocks, targetBlocks, render) {
  const isSame = (a, b) => renderBlock(a, render) === renderBlock(b, render);
  const ops = pairChanges(diffSequence(baseBlocks, targetBlocks, isSame), token => token.type);
  return ops.map(op => blockNode(op, render));
}

function blockNode(op, render) {
  const node = { op: op.op, kind: (op.a || op.b).type, base: op.a, target: op.b,
    baseIndex: op.aIndex, targetIndex: op.bIndex };
  if (op.op !== 'changed') return node;
  return Object.assign(node, describeChange(op.a, op.b, render));
}

// What a changed block descends into, by token type. A shape we can't descend
// into becomes a whole-block removal plus addition.
function describeChange(base, target, render) {
  switch (base.type) {
    case 'paragraph':
    case 'heading':
      return { words: diffWords(base.tokens, target.tokens, render) };
    case 'list':
      return { items: diffListItems(base.items, target.items, render) };
    case 'table':
      return diffTable(base, target, render);
    case 'code':
      return { lines: diffLines(base.text, target.text) };
    case 'blockquote':
      return { children: diffBlocks(withoutSpace(base.tokens), withoutSpace(target.tokens), render) };
    default:
      return { replaced: true };
  }
}

function diffListItems(baseItems, targetItems, render) {
  const isSame = (a, b) => itemKey(a, render) === itemKey(b, render);
  const ops = pairChanges(diffSequence(baseItems, targetItems, isSame), () => 'item');
  return ops.map(op => {
    const node = { op: op.op, base: op.a, target: op.b, baseIndex: op.aIndex, targetIndex: op.bIndex };
    if (op.op !== 'changed') return node;
    const baseInline = itemInlineTokens(op.a);
    const targetInline = itemInlineTokens(op.b);
    // A ticked or unticked checkbox lives in item metadata, not in its words.
    const isCheckboxChange = op.a.task !== op.b.task || op.a.checked !== op.b.checked;
    if (baseInline === null || targetInline === null || isCheckboxChange) return Object.assign(node, { replaced: true });
    return Object.assign(node, { words: diffWords(baseInline, targetInline, render) });
  });
}

// marked keeps a task item's checkbox in `task`/`checked`, outside its tokens.
function itemKey(item, render) {
  return JSON.stringify([item.task, item.checked, render.blocks(clone(item.tokens))]);
}

// A simple item holds one text or paragraph block; nested lists and multi-block
// items have no single run of words and are diffed as a whole.
function itemInlineTokens(item) {
  if (item.tokens.length !== 1 || !item.tokens[0].tokens) return null;
  return item.tokens[0].tokens;
}

function diffTable(base, target, render) {
  const cellNode = (a, b) => {
    if (!a) return { op: 'added', target: b };
    if (!b) return { op: 'removed', base: a };
    if (render.inline(clone(a.tokens)) === render.inline(clone(b.tokens))) return { op: 'equal', base: a, target: b };
    return { op: 'changed', base: a, target: b, words: diffWords(a.tokens, b.tokens, render) };
  };
  const cellsByPosition = (aCells, bCells) =>
    Array.from({ length: Math.max(aCells.length, bCells.length) }, (_, i) => cellNode(aCells[i], bCells[i]));
  // An array, not a joined string: cell text can itself contain the separator.
  const renderRow = row => JSON.stringify(row.map(cell => render.inline(clone(cell.tokens))));
  const isSameRow = (a, b) => renderRow(a) === renderRow(b);
  const rows = pairChanges(diffSequence(base.rows, target.rows, isSameRow), () => 'row').map(op => {
    const node = { op: op.op, base: op.a, target: op.b, baseIndex: op.aIndex, targetIndex: op.bIndex };
    if (op.op === 'changed') node.cells = cellsByPosition(op.a, op.b);
    return node;
  });
  return { header: cellsByPosition(base.header, target.header), rows };
}

// Gherkin blocks (from parseGherkinBlocks) match by kind + title. A matched
// block whose lines differ is 'changed'; a scenario renamed in place shows up
// as a removal plus an addition of the same kind, which pairChanges turns into
// 'changed' too, so comments on it read as addressed rather than removed.
function diffGherkin(baseBlocks, targetBlocks) {
  const keyOf = block => block.kind + ':' + block.title;
  const textOf = block => block.lines.map(line => line.text).join('\n');
  const ops = pairChanges(diffSequence(baseBlocks, targetBlocks, (a, b) => keyOf(a) === keyOf(b)), block => block.kind);
  const nodes = ops.map(op => {
    const node = { op: op.op, kind: (op.a || op.b).kind, base: op.a, target: op.b,
      baseIndex: op.aIndex, targetIndex: op.bIndex };
    const isEdited = op.op === 'changed' || (op.op === 'equal' && textOf(op.a) !== textOf(op.b));
    if (!isEdited) return node;
    return Object.assign(node, { op: 'changed', lines: diffLines(textOf(op.a), textOf(op.b)) });
  });
  return { nodes, isIdentical: nodes.every(node => node.op === 'equal') };
}

// Line diff, then word runs inside each changed line. Used for code fences,
// plain-text docs, and mapping Source-view comments.
function diffLines(baseText, targetText) {
  const ops = pairChanges(diffSequence(baseText.split('\n'), targetText.split('\n'), (a, b) => a === b), () => 'line');
  return ops.map(op => {
    const node = { op: op.op, base: op.a, target: op.b, baseIndex: op.aIndex, targetIndex: op.bIndex };
    if (op.op === 'changed') node.words = diffPlainWords(op.a, op.b);
    return node;
  });
}

// Words of an inline token run: plain text splits on whitespace (keeping the
// whitespace as its own pieces), every other inline token is one word.
// Atomic words compare by rendered HTML, so a link whose reference definition
// changed differs even though its raw text doesn't.
function diffWords(baseInline, targetInline, render) {
  const baseWords = inlineWords(baseInline, render);
  const targetWords = inlineWords(targetInline, render);
  return runsOf(diffSequence(baseWords, targetWords, (a, b) => a.key === b.key)
    .map(op => ({ op: op.op, text: (op.b || op.a).text })));
}

function diffPlainWords(baseText, targetText) {
  return runsOf(diffSequence(splitWords(baseText), splitWords(targetText), (a, b) => a === b)
    .map(op => ({ op: op.op, text: op.b !== undefined ? op.b : op.a })));
}

function inlineWords(inlineTokens, render) {
  const words = [];
  for (const token of inlineTokens) {
    if (!ATOMIC_INLINE_TYPES.includes(token.type)) {
      for (const piece of splitWords(token.raw)) words.push({ text: piece, key: 'text:' + piece });
    } else {
      words.push({ text: token.raw, key: token.type + ':' + render.inline(clone([token])) });
    }
  }
  return words;
}

function splitWords(text) {
  return text.split(/(\s+)/).filter(piece => piece !== '');
}

// Merge consecutive same-op word pieces ({op, text}) into runs. Word ops are
// never 'changed': a changed word is a removal plus an addition.
function runsOf(pieces) {
  const runs = [];
  for (const piece of pieces) {
    const last = runs[runs.length - 1];
    if (last && last.op === piece.op) last.text += piece.text;
    else runs.push({ op: piece.op, text: piece.text });
  }
  return runs;
}

// Where a comment made on an earlier revision stands now. `anchorsFor(revision)`
// returns that revision's anchors ([{index, quote}], as the viewer renders
// them); `diffChainFor(view, fromRevision)` returns the top-level nodes of each
// adjacent diff from that revision to the latest, built for the view the
// comment was made in (rendered → diffMarkdown, gherkin → diffGherkin,
// source → diffLines). Comments from viewers that predate revisions carry no
// revision and were made on revision 1.
// Returns {state: 'unanchored'} or a mapForward result.
function carryForward(event, anchorsFor, diffChainFor) {
  const revision = event.revision !== undefined ? event.revision : 1;
  const view = commentView(event);
  const anchor = resolveAnchor(event, anchorsFor(revision));
  if (!anchor) return { state: 'unanchored' };
  // Source anchors are 1-based line numbers; diff nodes index from 0.
  const lineOffset = view === 'source' ? 1 : 0;
  const outcome = mapForward(diffChainFor(view, revision), anchor.index - lineOffset, revision);
  if (outcome.index !== undefined) outcome.index += lineOffset;
  if (outcome.afterIndex !== undefined && outcome.afterIndex >= 0) outcome.afterIndex += lineOffset;
  return outcome;
}

// Follows one top-level index of revision `fromRevision` through each step of
// the diff chain. Returns {state: 'open', index}, {state: 'addressed',
// revision, index} (revision = first one that changed it), or {state:
// 'removed', revision, afterIndex} (afterIndex = nearest earlier surviving
// block in the latest revision, or -1).
function mapForward(diffChain, index, fromRevision) {
  let current = index;
  let addressedIn = null;
  for (let step = 0; step < diffChain.length; step++) {
    const nodes = diffChain[step];
    const position = nodes.findIndex(node => node.baseIndex === current);
    const node = nodes[position];
    const revision = fromRevision + step + 1;
    if (node.op === 'removed') {
      return { state: 'removed', revision, afterIndex: survivorBefore(diffChain, step, position, fromRevision) };
    }
    if (node.op === 'changed' && addressedIn === null) addressedIn = revision;
    current = node.targetIndex;
  }
  if (addressedIn === null) return { state: 'open', index: current };
  return { state: 'addressed', revision: addressedIn, index: current };
}

// The latest-revision index of the nearest block before nodes[position] that
// exists after this step, followed through the remaining steps.
function survivorBefore(diffChain, step, position, fromRevision) {
  const nodes = diffChain[step];
  for (let p = position - 1; p >= 0; p--) {
    if (nodes[p].targetIndex === undefined) continue;
    const rest = mapForward(diffChain.slice(step + 1), nodes[p].targetIndex, fromRevision + step + 1);
    return rest.state === 'removed' ? rest.afterIndex : rest.index;
  }
  return -1;
}

// The anchor a comment was made on, among one revision's anchors: matched by
// quote, then by occurrence among identical quotes, then by the nearest
// index. null when the quote matches nothing.
function resolveAnchor(event, anchors) {
  const matches = anchors.filter(anchor => anchor.quote === event.quote);
  if (event.occurrence !== undefined && matches[event.occurrence]) return matches[event.occurrence];
  const original = anchorIndexOf(event);
  let nearest = null;
  matches.forEach(anchor => {
    if (nearest === null || Math.abs(anchor.index - original) < Math.abs(nearest.index - original)) nearest = anchor;
  });
  return nearest;
}

// Doc-level comments have scope 'doc'; events from pre-view viewers are 'rendered'.
function commentView(event) {
  if (event.scope === 'doc') return 'doc';
  return event.view || 'rendered';
}

function anchorIndexOf(event) {
  return commentView(event) === 'source' ? event.line : event.blockIndex;
}

// Longest common subsequence of two arrays. Returns ops in order:
// { op: 'equal'|'removed'|'added', a?, b?, aIndex?, bIndex? }. Within a gap,
// removals come before additions, which pairChanges relies on. O(n·m), which
// is fine at the few-KB size of reviewed docs.
function diffSequence(a, b, isSame) {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = isSame(a[i], b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (isSame(a[i], b[j])) {
      ops.push({ op: 'equal', a: a[i], b: b[j], aIndex: i++, bIndex: j++ });
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ op: 'removed', a: a[i], aIndex: i++ });
    } else {
      ops.push({ op: 'added', b: b[j], bIndex: j++ });
    }
  }
  while (i < a.length) ops.push({ op: 'removed', a: a[i], aIndex: i++ });
  while (j < b.length) ops.push({ op: 'added', b: b[j], bIndex: j++ });
  return ops;
}

// A run of removals directly followed by a run of additions is an edit in
// place: pair them one-for-one, in order, when they're the same kind of thing.
function pairChanges(ops, kindOf) {
  const paired = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].op !== 'removed') { paired.push(ops[i++]); continue; }
    const removed = [];
    while (i < ops.length && ops[i].op === 'removed') removed.push(ops[i++]);
    const added = [];
    while (i < ops.length && ops[i].op === 'added') added.push(ops[i++]);
    paired.push(...pairRuns(removed, added, kindOf));
  }
  return paired;
}

// One removal against one addition of the same kind is always an edit in place.
// In longer runs, pairing by position mismatches as soon as a block is dropped
// or inserted, so items pair (in order, by LCS) only with a same-kind item that
// shares enough of its words.
function pairRuns(removed, added, kindOf) {
  const toChanged = (r, a) => ({ op: 'changed', a: r.a, b: a.b, aIndex: r.aIndex, bIndex: a.bIndex });
  if (removed.length === 1 && added.length === 1) {
    return kindOf(removed[0].a) === kindOf(added[0].b) ? [toChanged(removed[0], added[0])] : [removed[0], added[0]];
  }
  const isPair = (r, a) => kindOf(r.a) === kindOf(a.b) && wordSimilarity(textOf(r.a), textOf(a.b)) >= PAIRING_SIMILARITY;
  return diffSequence(removed, added, isPair).map(op => (op.op === 'equal' ? toChanged(op.a, op.b) : op.a || op.b));
}

function wordSimilarity(a, b) {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return 1;
  let shared = 0;
  wordsA.forEach(word => { if (wordsB.has(word)) shared++; });
  return shared / union.size;
}

// The comparable text of anything pairChanges sees: a line, a marked token,
// a table row (array of cells), or a Gherkin block.
function textOf(item) {
  if (typeof item === 'string') return item;
  if (Array.isArray(item)) return item.map(cell => cell.text).join(' ');
  if (item.lines) return item.lines.map(line => line.text).join('\n');
  return item.raw;
}

function withoutSpace(tokens) {
  return tokens.filter(token => token.type !== 'space');
}

function renderBlock(token, render) {
  return render.blocks(clone([token]));
}

// marked mutates some tokens while rendering (it prepends checkbox markup to
// loose task-list items), so every render works on a copy.
function clone(value) {
  return structuredClone(value);
}

if (typeof module !== 'undefined') {
  module.exports = {
    diffMarkdown, diffGherkin, diffLines, diffSequence, pairChanges, diffWords, groupHtmlContainers,
    carryForward, mapForward, resolveAnchor, commentView, anchorIndexOf
  };
}
