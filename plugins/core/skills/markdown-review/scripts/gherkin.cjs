// Split Gherkin source into commentable blocks of typed lines.
//
// Loaded two ways: inlined into the viewer page as a plain <script> (where the
// top-level function becomes a global), and require()d by the Node tests. The
// .cjs extension keeps it CommonJS under the repo's "type": "module".
//
// Deliberately not a full Gherkin parser: English keywords only, no
// validation. Every source line lands in exactly one block, so rendering can
// never drop text.

const BLOCK_KIND_BY_KEYWORD = {
  'Feature': 'feature',
  'Rule': 'rule',
  'Background': 'background',
  'Scenario': 'scenario',
  'Example': 'scenario',
  'Scenario Outline': 'scenario',
  'Scenario Template': 'scenario'
};
const HEADER_PATTERN = /^(Feature|Rule|Background|Scenario Outline|Scenario Template|Scenario|Example):\s*(.*)$/;
const EXAMPLES_PATTERN = /^(Examples|Scenarios):/;
const STEP_PATTERN = /^(Given|When|Then|And|But)\s|^\*\s/;
const DOCSTRING_FENCE_PATTERN = /^("""|```)/;

// Block = { kind, title, startLine, lines: Line[] }; Line = { kind, text, lineNo }.
// startLine is the 1-based line of the block's header keyword (1 for the preamble).
function parseGherkinBlocks(source) {
  const lines = classifyLines(source);
  const starts = findBlockStarts(lines);
  const blocks = [];
  const firstStart = starts.length > 0 ? starts[0].index : lines.length;
  if (firstStart > 0) {
    blocks.push({ kind: 'preamble', title: '', startLine: 1, lines: lines.slice(0, firstStart) });
  }
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : lines.length;
    blocks.push({
      kind: BLOCK_KIND_BY_KEYWORD[start.keyword],
      title: start.title,
      startLine: start.headerLineNo,
      lines: lines.slice(start.index, end)
    });
  });
  return blocks;
}

function classifyLines(source) {
  let openFence = null;
  return source.split('\n').map((text, index) => {
    const trimmed = text.trim();
    const fence = DOCSTRING_FENCE_PATTERN.test(trimmed) ? trimmed.slice(0, 3) : null;
    const kind = openFence !== null || fence !== null ? 'docstring' : classifyOutsideDocString(trimmed);
    if (fence !== null && openFence === null) openFence = fence;
    else if (fence !== null && fence === openFence) openFence = null;
    return { kind, text, lineNo: index + 1 };
  });
}

function classifyOutsideDocString(trimmed) {
  if (trimmed === '') return 'blank';
  if (trimmed.startsWith('#')) return 'comment';
  if (trimmed.startsWith('@')) return 'tag';
  if (trimmed.startsWith('|')) return 'table';
  if (HEADER_PATTERN.test(trimmed) || EXAMPLES_PATTERN.test(trimmed)) return 'keyword';
  if (STEP_PATTERN.test(trimmed)) return 'step';
  return 'text';
}

// A block starts at its header line, pulled back over the tags and comments
// directly above it — those annotate the header, not the block before it.
function findBlockStarts(lines) {
  const starts = [];
  lines.forEach((line, index) => {
    const header = line.kind === 'keyword' ? line.text.trim().match(HEADER_PATTERN) : null;
    if (!header) return;
    let start = index;
    while (start > 0 && (lines[start - 1].kind === 'tag' || lines[start - 1].kind === 'comment')) start--;
    starts.push({ index: start, keyword: header[1], title: header[2].trim(), headerLineNo: line.lineNo });
  });
  return starts;
}

// Cells of one '| a | b |' table line. Escapes are read left to right, as
// Gherkin does: '\\|' is a literal pipe and '\\\\' a literal backslash, so
// in '\\\\|' the pipe is still a separator.
function splitTableRow(text) {
  const pieces = [''];
  const row = text.trim();
  for (let i = 0; i < row.length; i++) {
    const next = row[i + 1];
    if (row[i] === '\\' && (next === '|' || next === '\\')) {
      pieces[pieces.length - 1] += next;
      i++;
    } else if (row[i] === '|') {
      pieces.push('');
    } else {
      pieces[pieces.length - 1] += row[i];
    }
  }
  return pieces.slice(1, -1).map(cell => cell.trim());
}

if (typeof module !== 'undefined') module.exports = { parseGherkinBlocks, splitTableRow };
