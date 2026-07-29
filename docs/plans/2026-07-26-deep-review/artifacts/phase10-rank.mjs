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
  {
    id: 'INIT-05-pin-auth-hardening',
    payoff: 'medium',
    reason:
      'First of the light track: the tunnel PIN is the only thing between the internet and the rig, and the throttle design is small (~340 LOC), independent, and security-shaped — worth landing before any remote show.',
  },
  {
    id: 'INIT-07-patch-node-identity',
    payoff: 'medium',
    reason:
      'Fixes a LIVE defect found during repair (every reconciled port titles as "Output output" in the Inspector) while retiring the stringly-typed node-id grammar. Before the remaining light rows because it has user-visible payoff.',
  },
  {
    id: 'INIT-11-telemetry-resilience',
    payoff: 'medium',
    reason:
      'Closes the telemetry silent-failure pair (blocked-that-never-blocks, opaque transport errors). Blocked behind INIT-04: seven of INIT-04\'s steps churn main.ts where INIT-11\'s S5 lands, and INIT-04 is the far larger edit.',
  },
  {
    id: 'INIT-08-kit-schema-split',
    payoff: 'medium',
    reason:
      'Three-axis split of kit-schema.ts retires a divergent-change hotspot; independent of everything above, but no live-defect or security payoff, so it queues behind those.',
  },
  {
    id: 'INIT-09-ui-component-dedup',
    payoff: 'medium',
    reason:
      'Design-system dedup incl. the ControllerStatusPanel split; meaningful surface reduction but UI-only. Repair pinned real regressions to watch (Discover spinner keyframes, styleguide targeting), keeping risk honest.',
  },
  {
    id: 'INIT-10-test-helper-dedup',
    payoff: 'low',
    reason:
      'Test-only consolidation (37 Storage copies, 6 effects helpers). Zero runtime risk and good hygiene, but no production behaviour changes — cheap to land whenever capacity allows.',
  },
  {
    id: 'INIT-13-core-surface-trims',
    payoff: 'low',
    reason:
      'Three small API trims; the repair demoted its tooling evidence (knip cannot see core\'s barrel surface), so this is grep-and-typecheck-backed tidy-up. Last because smallest payoff.',
  },
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
    // Trent approved all 12 rows as ranked on 2026-07-29 (11-decisions.md):
    // approved-and-waiting = queued; unmet dependency = blocked.
    status: deps.length === 0 ? 'queued' : 'blocked',
  };
});
assert(rows.reduce((s, r) => s + r.criticals, 0) === 9, 'ranked rows must cover all 9 criticals');

// ---- Dropped (retained in full) ----
const dropped = Object.entries(EXECUTED).map(([id, reason]) => ({ reason, initiative: byInit.get(id), status_note: 'done' }));
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
md += `\n**APPROVED: all 12 rows as ranked (Trent, 2026-07-29).** Every open question is resolved in \`11-decisions.md\` — it is the execution authority and overrides plan text where they disagree. dead-code-0001 stays held.\n\nEach row's plan: see \`plan_ref\` — an adversarially-reviewed synthesis with per-step verification.\n\n**Execution note (systemic, found in repair):** several plans were authored when the suite stood at 2,981/2,968 tests — any hard-coded test-count gate is stale by construction. Every executing agent must re-measure the collected test count at its own starting HEAD and gate on that number.\n\n## Not ranked (retained in dropped)\n\n`;
md += `**Executed this stint:** INIT-12-kit-mirror-removal — ${EXECUTED['INIT-12-kit-mirror-removal']}\n`;
writeFileSync(join(ROOT, '10-ranked.md'), md);
console.log(`Phase 10 OK: ${rows.length} ranked rows (${rows.filter((r) => r.status === 'ready').length} ready), ${dropped.length} dropped-with-reason.`);
