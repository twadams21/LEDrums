#!/usr/bin/env node
// Phase 10 — Rank & phase. Deterministic, main thread, no agent (SPEC). Reads the
// synthesised plans + initiative map + findings, emits 10-ranked.json (collection
// envelope; items = ranked rows per ranked.schema.json) + 10-ranked.md view.
//
// Rows exist ONLY for initiatives with a 09-synthesis plan (ranked.schema.json:
// "a row without a surviving plan behind it is a wish"). Everything else is retained
// IN FULL under `dropped` with its reason. Payoff and order are orchestrator judgment,
// encoded explicitly below with reasons; all counts asserted.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = 'docs/plans/2026-07-26-deep-review';

const assert = (c, m) => { if (!c) { console.error(`PHASE 10 ABORT: ${m}`); process.exit(1); } };

const inits = JSON.parse(readFileSync(join(ROOT, '04-initiatives.json'), 'utf8'));
const findingsRaw = JSON.parse(readFileSync(join(ROOT, '02-findings/_all.json'), 'utf8'));
const findings = Array.isArray(findingsRaw) ? findingsRaw : findingsRaw.items;
const sevById = new Map(findings.map((f) => [f.id, f.severity]));
const byInit = new Map(inits.items.map((i) => [i.initiative_id, i]));

// ---- Orchestrator judgment: order + payoff, with the argument written down ----
// Payoff anchors (ranked.schema.json): high = removes a whole duplicated subsystem or
// closes a silent-failure path; medium = meaningful surface reduction in one module.
const RANKING = [
  {
    id: 'INIT-03-io-output-resilience',
    payoff: 'high',
    reason:
      'Closes the live-show-goes-dark silent failure (total error swallow in both output adapters) at the smallest cost on the table (660 LOC, 11 steps); zero protocol/UI change. Highest payoff per unit risk — land first.',
  },
  {
    id: 'INIT-04-server-runtime-hardening',
    payoff: 'high',
    reason:
      'Resolves 3 criticals including the unprotected render loop (one throw kills output silently) and module-scope boot fragility. Operational resilience second only to INIT-03, and independent of the engine consolidation.',
  },
  {
    id: 'INIT-01-single-render-stack',
    payoff: 'high',
    reason:
      'Removes an entire duplicated subsystem (legacy engine stack + sim.ts voice mirror, ~2450 LOC mostly deletion). Third despite scale because INIT-02/INIT-06 rework overlapping territory (trigger-lab store, core voice types) — landing this first shrinks what they must rebase onto.',
  },
  {
    id: 'INIT-02-store-decomposition',
    payoff: 'medium',
    reason:
      'Resolves 3 criticals in the god-object cluster via a 23-commit strangler with a durable resting state after each. After INIT-01 because both rework trigger-lab; medium risk but the largest estimate (2750 LOC).',
  },
  {
    id: 'INIT-06-graph-node-type-model',
    payoff: 'medium',
    reason:
      'Buys compiler-enforced totality over the 19-kind node model and fixes the live effect-arm dispatch bug. Last of the five because it touches persisted-show compatibility and benefits from INIT-01 having deleted the legacy consumers of these types.',
  },
];

// Light-track initiatives: attacked but all verdicts were sound-with-repairs — held
// out of 09-synthesis until a repair pass applies the named repairs. Not rows.
const LIGHT_HELD = [
  'INIT-05-pin-auth-hardening',
  'INIT-07-patch-node-identity',
  'INIT-08-kit-schema-split',
  'INIT-09-ui-component-dedup',
  'INIT-10-test-helper-dedup',
  'INIT-11-telemetry-resilience',
  'INIT-13-core-surface-trims',
];
const EXECUTED = {
  'INIT-12-kit-mirror-removal':
    'Executed this stint as fix batch-02 (commits a7c46eb + 792cb23, gates green 2968, Phase 6 review non-blocking): mirror field removed at every layer; setKitGlobal survives carrying live kit config.',
};

// ---- Build rows ----
const rows = RANKING.map((r, idx) => {
  const init = byInit.get(r.id);
  assert(init, `unknown initiative ${r.id}`);
  const planPath = join(ROOT, '09-synthesis', `${r.id}.json`);
  assert(existsSync(planPath), `no synthesis for ranked row ${r.id}`);
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  assert(plan.variant === 'synthesis', `${r.id} plan variant is ${plan.variant}, not synthesis`);
  const risks = plan.design.map((s) => s.risk);
  const risk = risks.includes('high') ? 'high' : risks.includes('medium') ? 'medium' : 'low';
  const deps = plan.dependencies_on_other_initiatives ?? [];
  const criticals = init.findings.filter((fid) => sevById.get(fid) === 'critical').length;
  return {
    rank: idx + 1,
    initiative_id: r.id,
    title: init.title,
    criticals,
    estimated_loc: plan.estimated_loc,
    risk,
    payoff: r.payoff,
    depends_on: deps,
    recommended_order_reason: r.reason,
    plan_ref: `${R}/09-synthesis/${r.id}.json`,
    status: deps.length === 0 ? 'ready' : 'blocked',
  };
});
assert(rows.reduce((s, r) => s + r.criticals, 0) === 9, 'ranked rows must cover all 9 criticals');

// ---- Dropped (retained in full) ----
const dropped = [
  ...LIGHT_HELD.map((id) => {
    const init = byInit.get(id);
    assert(init, `unknown light initiative ${id}`);
    assert(existsSync(join(ROOT, '07-plans', id, 'opus.json')), `no light plan for ${id}`);
    assert(existsSync(join(ROOT, '08-refutations', `${id}.fable.json`)), `no light attack for ${id}`);
    return {
      reason:
        'Light-track plan exists and was adversarially attacked; verdict sound-with-repairs — held out of 09-synthesis until a repair pass applies the named repairs. Re-rank after promotion.',
      initiative: init,
      plan_ref: `${R}/07-plans/${id}/opus.json`,
      refutation_ref: `${R}/08-refutations/${id}.fable.json`,
    };
  }),
  ...Object.entries(EXECUTED).map(([id, reason]) => ({ reason, initiative: byInit.get(id), status_note: 'done' })),
];
assert(rows.length + dropped.length === inits.items.length, `rows ${rows.length} + dropped ${dropped.length} != ${inits.items.length} initiatives`);

// ---- Emit ----
const out = {
  artifact: '10-ranked',
  schema_version: '3',
  baseline_sha: inits.baseline_sha,
  produced_by: { phase: '10', lane: 'rank', model: 'none-deterministic-script', effort: 'none', nonce_verified: false },
  dropped,
  items: rows,
};
writeFileSync(join(ROOT, '10-ranked.json'), JSON.stringify(out, null, 1) + '\n');

let md = `# 10 — Ranked Approval Table (rendered view; 10-ranked.json is canonical)\n\nBaseline \`${inits.baseline_sha}\` · generated by \`artifacts/phase10-rank.mjs\`\n\nNothing structural executes until Trent approves rows. Rank is a recommendation — reorder freely.\n\n| # | initiative | crit | ~LOC | risk | payoff | status | why here |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of rows)
  md += `| ${r.rank} | ${r.initiative_id} | ${r.criticals} | ${r.estimated_loc} | ${r.risk} | ${r.payoff} | **${r.status}** | ${r.recommended_order_reason} |\n`;
md += `\nEach row's plan: see \`plan_ref\` — an adversarially-reviewed synthesis with per-step verification. Open questions inside each plan need answers before or during execution.\n\n## Not ranked (retained in dropped)\n\n`;
md += `**Executed this stint:** INIT-12-kit-mirror-removal — ${EXECUTED['INIT-12-kit-mirror-removal']}\n\n`;
md += `**Light track, held for repair pass (all verdicts sound-with-repairs):** ${LIGHT_HELD.join(', ')}. Each has a plan in 07-plans/ and an attack in 08-refutations/; a cheap repair pass (one agent per initiative applying the attack's named repairs) promotes them into 09-synthesis for re-ranking.\n`;
writeFileSync(join(ROOT, '10-ranked.md'), md);
console.log(`Phase 10 OK: ${rows.length} ranked rows (${rows.filter((r) => r.status === 'ready').length} ready), ${dropped.length} dropped-with-reason.`);
