export const meta = {
  name: 'ticket-to-pr',
  description: 'Zone B: write tests, implement, (later) review-fix, commit on the worktree branch',
  phases: [
    { title: 'Tests' },
    { title: 'Dev' },
    { title: 'Refine' },
  ],
}

// args = { ticket:{title,body,acceptanceCriteria[]}, verifyCmds:{build,lint,test},
//          worktreePath, branch, caps:{test,dev,refine} }
const { ticket, verifyCmds, worktreePath, caps } = args
const WT = `All work happens in the git worktree at: ${worktreePath}\n` +
  `Run \`cd "${worktreePath}"\` before ANY command. Never operate on the main checkout.\n\n`
const ac = ticket.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')

const TEST_FILES = {
  type: 'object',
  properties: { files: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
  required: ['files', 'notes'],
}
const DEV_RESULT = {
  type: 'object',
  properties: {
    testsPassing: { type: 'boolean' }, buildClean: { type: 'boolean' }, lintClean: { type: 'boolean' },
    diffSummary: { type: 'string' }, acMet: { type: 'array', items: { type: 'string' } },
  },
  required: ['testsPassing', 'buildClean', 'lintClean', 'diffSummary', 'acMet'],
}
const green = (d) => !!(d?.testsPassing && d?.buildClean && d?.lintClean)
const VERDICT = {
  type: 'object',
  properties: { satisfied: { type: 'boolean' }, gaps: { type: 'array', items: { type: 'string' } } },
  required: ['satisfied', 'gaps'],
}
const REVIEW = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' }, jobId: { type: 'string' }, reviewText: { type: 'string' },
  },
  required: ['passed', 'jobId', 'reviewText'],
}

phase('Tests')
let tests = await agent(
  `${WT}Write failing tests for this ticket.\n\nTITLE: ${ticket.title}\n\nBODY:\n${ticket.body}\n\n` +
  `ACCEPTANCE CRITERIA:\n${ac}\n\nTest command: ${verifyCmds.test}`,
  { agentType: 'test-writer', schema: TEST_FILES })

let verdict = null
for (let i = 0; i < (caps?.test ?? 3); i++) {
  verdict = await agent(
    `${WT}Review these tests for coverage of the acceptance criteria.\n\nACCEPTANCE CRITERIA:\n${ac}` +
    `\n\nTest files: ${(tests?.files ?? []).join(', ')}\n\nTest command: ${verifyCmds.test}`,
    { agentType: 'test-adequacy-reviewer', schema: VERDICT })
  if (verdict?.satisfied) break
  tests = await agent(
    `${WT}Revise the tests to close these gaps:\n${(verdict?.gaps ?? []).map(g => `- ${g}`).join('\n')}` +
    `\n\nACCEPTANCE CRITERIA:\n${ac}\n\nTest command: ${verifyCmds.test}`,
    { agentType: 'test-writer', schema: TEST_FILES })
}

phase('Dev')
let dev = null
for (let j = 0; j < (caps?.dev ?? 3); j++) {
  dev = await agent(
    `${WT}IMPLEMENT mode.\n\nACCEPTANCE CRITERIA:\n${ac}\n\nTests already written: ` +
    `${(tests?.files ?? []).join(', ')}\n\nBuild: ${verifyCmds.build}\nLint: ${verifyCmds.lint}\n` +
    `Test: ${verifyCmds.test}\n\nAll three (build, lint, test) must be clean.`,
    { agentType: 'dev', schema: DEV_RESULT })
  if (green(dev)) break
}

// Do not commit or review a branch that never reached green — report and stop (Zone C surfaces it).
if (!green(dev)) {
  return {
    testFiles: tests?.files ?? [], diffSummary: dev?.diffSummary ?? '',
    acMet: dev?.acMet ?? [], testsPassing: !!dev?.testsPassing, buildClean: !!dev?.buildClean,
    lintClean: !!dev?.lintClean,
    adequacyVerdict: verdict?.satisfied ? 'satisfied' : 'cap-reached',
    roborevVerdict: 'skipped', status: 'dev-cap-reached', commitInfo: null,
  }
}

phase('Refine')
// Commit the implemented state first so roborev has commits to review (also guarantees at least one
// commit exists even when the first review passes).
const commitInfo = await agent(
  `${WT}Stage all changes and create ONE commit. Message (conventional): ` +
  `"feat: ${ticket.title}". Then output the commit SHA on the last line.`,
  { agentType: 'dev' })

let refinePass = false
for (let k = 0; k < (caps?.refine ?? 10); k++) {
  const review = await agent(
    `${WT}Run roborev on this branch and report the verdict + review text as JSON.\n` +
    `1. Run: roborev review --branch --wait  (it exits 1 on Fail — expected; capture output).\n` +
    `2. Extract the job id from the "Enqueued job <id>" line. For a panel, use the synthesis PARENT job.\n` +
    `3. Poll: roborev list --json until that job's status == "done".\n` +
    `4. Run: roborev show <jobId> --json. passed = (verdict_bool == 1). reviewText = the "output" field.\n` +
    `Return passed, jobId (as string), and reviewText. Do NOT fix anything.`,
    { agentType: 'dev', schema: REVIEW })
  if (review?.passed) { refinePass = true; break }
  const fixResult = await agent(
    `${WT}FIX mode. Address the findings in this roborev review, highest severity first:\n\n` +
    review.reviewText +
    `\n\nAfter fixing, run ${verifyCmds.build}, ${verifyCmds.lint}, and ${verifyCmds.test} ` +
    `(all must stay clean), then commit (conventional). ` +
    `Then comment a concise summary on the review and close it. Pass the comment via a heredoc ` +
    `(never interpolate review text into the shell):\n` +
    `  roborev comment --commenter ticket-to-pr --job ${review.jobId} -m "$(cat <<'TTP_C'\n` +
    `<your summary of fixes + any dismissed findings>\nTTP_C\n)"\n` +
    `  roborev close ${review.jobId}\n` +
    `(Confirm the exact comment flag with \`roborev comment --help\`; the refine skill uses -m.) ` +
    `If a commit-scoped hook review appears (roborev wait), close it too.`,
    { agentType: 'dev', schema: DEV_RESULT })
  if (fixResult) dev = fixResult   // returned state must reflect post-fix code, not pre-roborev
}

return {
  testFiles: tests?.files ?? [], diffSummary: dev?.diffSummary ?? '',
  acMet: dev?.acMet ?? [], testsPassing: !!dev?.testsPassing, buildClean: !!dev?.buildClean,
  lintClean: !!dev?.lintClean,
  adequacyVerdict: verdict?.satisfied ? 'satisfied' : 'cap-reached',
  roborevVerdict: refinePass ? 'pass' : 'cap-reached',
  status: refinePass ? 'ok' : 'roborev-cap-reached',
  commitInfo,
}
