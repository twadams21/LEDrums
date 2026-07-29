export const meta = {
  name: 'codex-mix-probe',
  description: 'Prove native Claude and proxied codex (gpt-5.6-luna) agents run mixed inside one Opus-driven dynamic Workflow',
  phases: [
    { title: 'Probe', detail: '1 native control + 2 proxied luna(low) agents, concurrent' },
  ],
}

// Repo-relative so this is runnable by anyone, from any session. v3 committed a
// copy that hardcoded a prior session's scratchpad and therefore could not run;
// both reviewers caught it.
const REPO = '/Users/trent/Documents/dev/ledrums'
const SP = REPO + '/docs/plans/2026-07-26-deep-review/artifacts'

const SCHEMA = {
  type: 'object',
  properties: {
    lane: { type: 'string', description: 'which lane this is' },
    model_reported: { type: 'string', description: 'the exact model id the answering model reported for itself' },
    answer: { type: 'string', description: 'the substantive answer to the task' },
    ok: { type: 'boolean', description: 'true if the lane completed without error' },
    notes: { type: 'string', description: 'any error text or caveat, empty if none' },
  },
  required: ['lane', 'model_reported', 'answer', 'ok', 'notes'],
  additionalProperties: false,
}

function codexLane(lane, innerPrompt, promptFile) {
  return `You are a LAUNCHER, not a solver. Do NOT answer the task yourself and do NOT read any repo files yourself.

Your entire job is to shell out to a proxied codex model and relay what it says.

Step 1 — write the prompt file with a heredoc (run exactly this):
cat > ${SP}/${promptFile} <<'PROMPT_EOF'
${innerPrompt}
PROMPT_EOF

Step 2 — run exactly this command:
bash ${SP}/codex-agent.sh 'gpt-5.6-luna(low)' ${SP}/${promptFile} Read,Grep,Glob ${REPO}

Step 3 — return the structured result:
  lane = "${lane}"
  model_reported = the exact model identifier the subprocess printed for itself
  answer = the substantive answer the subprocess gave
  ok = true only if the command exited 0 AND produced a real answer
  notes = any stderr/warning text, or "" if clean

If the command fails, set ok=false and put the error in notes. Do not retry more than once. Do not substitute your own answer for the subprocess's.`
}

phase('Probe')

const results = await parallel([
  () => agent(
    `You are the NATIVE CONTROL lane. Answer directly from your own knowledge, no tools, no shelling out.
Return:
  lane = "native-control"
  model_reported = the exact model identifier you are running as
  answer = "native lane reached"
  ok = true
  notes = ""`,
    { label: 'native-control', phase: 'Probe', schema: SCHEMA, model: 'haiku', effort: 'low' }
  ),

  () => agent(
    codexLane(
      'codex-luna-exports',
      'Read the file packages/io/src/osc.ts. Count how many top-level exported symbols it declares (lines beginning with "export "). Reply with exactly one line and nothing else: MODEL=<the exact model identifier you are running as> COUNT=<the number> NAMES=<comma-separated exported symbol names>',
      'probe-exports.txt'
    ),
    { label: 'codex-luna-exports', phase: 'Probe', schema: SCHEMA, model: 'haiku', effort: 'low' }
  ),

  () => agent(
    codexLane(
      'codex-luna-protocol',
      'Use Glob and Read to inspect packages/protocol. Reply with exactly one line and nothing else: MODEL=<the exact model identifier you are running as> FILES=<number of .ts files under packages/protocol/src> TOPIC=<five words describing what this package is for>',
      'probe-protocol.txt'
    ),
    { label: 'codex-luna-protocol', phase: 'Probe', schema: SCHEMA, model: 'haiku', effort: 'low' }
  ),
])

const clean = results.filter(Boolean)
log(`lanes returned: ${clean.length}/3`)
for (const r of clean) log(`${r.lane} :: ok=${r.ok} :: model=${r.model_reported}`)

return {
  lanes_returned: clean.length,
  mixed_ok: clean.length === 3 && clean.every(r => r.ok),
  results: clean,
}