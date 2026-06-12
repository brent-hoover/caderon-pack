export const meta = {
  name: 'ticket-to-pr',
  description: 'Zone B: write tests, implement, (later) review-fix, commit on the worktree branch',
  phases: [
    { title: 'Tests' },
    { title: 'Dev' },
    { title: 'Commit' },
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
    testsPassing: { type: 'boolean' }, buildClean: { type: 'boolean' },
    diffSummary: { type: 'string' }, acMet: { type: 'array', items: { type: 'string' } },
  },
  required: ['testsPassing', 'buildClean', 'diffSummary', 'acMet'],
}

phase('Tests')
const tests = await agent(
  `${WT}Write failing tests for this ticket.\n\nTITLE: ${ticket.title}\n\nBODY:\n${ticket.body}\n\n` +
  `ACCEPTANCE CRITERIA:\n${ac}\n\nTest command: ${verifyCmds.test}`,
  { agentType: 'test-writer', schema: TEST_FILES })

phase('Dev')
let dev = null
for (let j = 0; j < (caps?.dev ?? 3); j++) {
  dev = await agent(
    `${WT}IMPLEMENT mode.\n\nACCEPTANCE CRITERIA:\n${ac}\n\nTests already written: ` +
    `${(tests?.files ?? []).join(', ')}\n\nBuild: ${verifyCmds.build}\nTest: ${verifyCmds.test}`,
    { agentType: 'dev', schema: DEV_RESULT })
  if (dev?.testsPassing && dev?.buildClean) break
}

phase('Commit')
const commitInfo = await agent(
  `${WT}Stage all changes and create ONE commit. Message (conventional): ` +
  `"feat: ${ticket.title}". Then output the commit SHA on the last line.`,
  { agentType: 'dev' })

return {
  testFiles: tests?.files ?? [], diffSummary: dev?.diffSummary ?? '',
  acMet: dev?.acMet ?? [], testsPassing: !!dev?.testsPassing, buildClean: !!dev?.buildClean,
  commitInfo,
}
