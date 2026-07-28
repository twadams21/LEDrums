#!/usr/bin/env node
// Phase 4 — Triage & split. Deterministic, no agent (SPEC: "Deterministic JavaScript
// in the workflow script"). Reads 03-verdicts.json + 02-findings/_all.json, assigns
// every structural-track finding to exactly one initiative, applies the held-finding
// list, and emits 04-ledger.json + 04-ledger.md (md is a rendered view, JSON canonical).
//
// Every expectation is asserted in code; a count mismatch aborts the phase.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_SHA = '3708648';

// ---- Trent's decisions (recorded 2026-07-28/29, see HANDOFF.md §2) ----
const HOLDS = {
  'dead-code-0001': {
    reason:
      "Trent 2026-07-28: 'patch copy paste was meant to be fixed or changed, i cant remember.' " +
      'Product question, not cleanup — components un-mounted by 39b7d6b but store.copyPatch() and ' +
      'trigger-lab/patch-diff.ts are alive. Do not delete until resolved.',
  },
};
const DECISIONS = {
  'dead-code-0002': {
    decision:
      "Trent 2026-07-28: kit mirror is REMOVED by intent (option b of the finding's two fixes). " +
      'Delete PatchMirrorControl.svelte + unreachable setKitGlobal client path. Server half stays ' +
      'pending a separate call (tracked ask to Trent).',
  },
};

// ---- Initiative assignment: every structural finding, exactly once ----
const INITIATIVES = {
  'INIT-01-single-render-stack': {
    title: 'One render stack: retire legacy engine/, absorb sim.ts voice semantics into core',
    priority: 1,
    findings: [
      'divergent-change-0001',
      'divergent-change-0003',
      'duplicated-code-0004',
      'resilience-hole-0011',
      'duplicated-code-0011',
    ],
  },
  'INIT-02-store-decomposition': {
    title: 'TriggerLab store god-object: real extraction (kill forwarders), web state architecture',
    priority: 2,
    findings: [
      'divergent-change-0002',
      'middle-man-0001',
      'speculative-generality-0001',
      'duplicated-code-0003',
      'resilience-hole-0007',
      'data-clumps-0005',
      'speculative-generality-0007',
    ],
  },
  'INIT-03-io-output-resilience': {
    title: 'Art-Net/sACN silent-failure closure: error surfacing, ready-flag lifecycle, send seam',
    priority: 1,
    findings: ['resilience-hole-0003', 'primitive-obsession-0006', 'duplicated-code-0012'],
  },
  'INIT-04-server-runtime-hardening': {
    title: 'Server main.ts decomposition + fault containment (render loop, boot, WS liveness)',
    priority: 1,
    findings: [
      'divergent-change-0004',
      'resilience-hole-0001',
      'resilience-hole-0002',
      'resilience-hole-0004',
      'resilience-hole-0005',
      'resilience-hole-0013',
      'speculative-generality-0002',
      'duplicated-code-0006',
    ],
  },
  'INIT-05-pin-auth-hardening': {
    title: 'Tunnel PIN gate: credential types + brute-force resistance',
    priority: 3,
    findings: ['resilience-hole-0006', 'primitive-obsession-0010'],
  },
  'INIT-06-graph-node-type-model': {
    title: 'GraphNode/NodeKind discriminated-union redesign + voice ctx/param clumps',
    priority: 2,
    findings: [
      'primitive-obsession-0001',
      'primitive-obsession-0003',
      'primitive-obsession-0009',
      'repeated-switches-0001',
      'repeated-switches-0002',
      'data-clumps-0001',
      'data-clumps-0003',
      'data-clumps-0004',
      'middle-man-0003',
    ],
  },
  'INIT-07-patch-node-identity': {
    title: 'Patch node id grammar → typed identity; {drumId,slot} trigger address object',
    priority: 3,
    findings: ['primitive-obsession-0008', 'dead-code-0008', 'data-clumps-0007'],
  },
  'INIT-08-kit-schema-split': {
    title: 'kit-schema.ts: split schema surface / migration ladder / defaults',
    priority: 3,
    findings: ['divergent-change-0005'],
  },
  'INIT-09-ui-component-dedup': {
    title: 'Design-system dedup: control contract, inspector chrome, MIDI-learn, ControllerStatusPanel split',
    priority: 4,
    findings: [
      'data-clumps-0002',
      'duplicated-code-0010',
      'duplicated-code-0013',
      'duplicated-code-0014',
      'divergent-change-0007',
      'middle-man-0007',
    ],
  },
  'INIT-10-test-helper-dedup': {
    title: 'Shared test harness: in-memory Storage (×37) + effects test helpers (×6)',
    priority: 4,
    findings: ['duplicated-code-0001', 'duplicated-code-0002'],
  },
  'INIT-11-telemetry-resilience': {
    title: 'Telemetry transport + ingest Worker fault handling',
    priority: 3,
    findings: ['resilience-hole-0008', 'resilience-hole-0010'],
  },
  'INIT-12-kit-mirror-removal': {
    title: 'Kit mirror removal (decided): client path deletion; server half pending Trent',
    priority: 3,
    findings: ['dead-code-0002'],
  },
  'INIT-13-core-surface-trims': {
    title: 'Small core API trims (pixel-grid wrappers, graph-integrity throwing form, listCanvasScenes)',
    priority: 4,
    findings: ['speculative-generality-0011'],
  },
};

// ---- Load inputs ----
const verdicts = JSON.parse(readFileSync(join(ROOT, '03-verdicts.json'), 'utf8'));
const refuted = JSON.parse(readFileSync(join(ROOT, '03-refuted.json'), 'utf8'));
const findingsRaw = JSON.parse(readFileSync(join(ROOT, '02-findings/_all.json'), 'utf8'));
const findings = Array.isArray(findingsRaw) ? findingsRaw : findingsRaw.items;
const byId = new Map(findings.map((f) => [f.id, f]));

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`PHASE 4 ABORT: ${msg}`);
    process.exit(1);
  }
};

// ---- Input validation (schema-shape + counts) ----
assert(verdicts.baseline_sha?.startsWith(BASELINE_SHA), `verdicts baseline ${verdicts.baseline_sha} != ${BASELINE_SHA}`);
for (const it of verdicts.items) {
  for (const k of ['finding_id', 'refutation', 'mechanical_verification', 'disposition'])
    assert(k in it, `verdict ${it.finding_id ?? '?'} missing ${k}`);
  assert(
    ['auto-fix', 'structural-track', 'refuted', 'unadmitted'].includes(it.disposition),
    `verdict ${it.finding_id} bad disposition ${it.disposition}`
  );
  assert(byId.has(it.finding_id), `verdict ${it.finding_id} has no finding in 02-findings/_all.json`);
}

const autoFix = verdicts.items.filter((i) => i.disposition === 'auto-fix');
const structural = verdicts.items.filter((i) => i.disposition === 'structural-track');
assert(verdicts.items.length === 63, `expected 63 verdict items, got ${verdicts.items.length}`);
assert(autoFix.length === 13, `expected 13 auto-fix, got ${autoFix.length}`);
assert(structural.length === 50, `expected 50 structural-track, got ${structural.length}`);
assert(refuted.items.length === 44, `expected 44 refuted, got ${refuted.items.length}`);
assert(
  verdicts.items.length + refuted.items.length === 107,
  `verdicts+refuted != 107 (${verdicts.items.length}+${refuted.items.length})`
);

// ---- Initiative coverage: exactly the structural set, no dupes ----
const assigned = new Map();
for (const [initId, init] of Object.entries(INITIATIVES))
  for (const fid of init.findings) {
    assert(!assigned.has(fid), `${fid} assigned to both ${assigned.get(fid)} and ${initId}`);
    assigned.set(fid, initId);
  }
const structuralIds = new Set(structural.map((i) => i.finding_id));
for (const fid of assigned.keys()) assert(structuralIds.has(fid), `${fid} assigned but not structural-track`);
for (const fid of structuralIds) assert(assigned.has(fid), `structural finding ${fid} has no initiative`);

// ---- Holds: only against auto-fix findings ----
const autoFixIds = new Set(autoFix.map((i) => i.finding_id));
for (const fid of Object.keys(HOLDS)) assert(autoFixIds.has(fid), `hold ${fid} is not an auto-fix finding`);
const landNow = autoFix.filter((i) => !(i.finding_id in HOLDS));
assert(landNow.length === 12, `expected 12 land-now auto-fixes, got ${landNow.length}`);

// ---- Emit ledger ----
const triage = {};
for (const it of verdicts.items) {
  const f = byId.get(it.finding_id);
  const t = {
    track: it.disposition === 'auto-fix' ? (it.finding_id in HOLDS ? 'held' : 'trivial') : 'structural',
    severity: f.severity,
    fix_size_loc: f.fix_size_loc,
    lens: f.lens,
  };
  if (assigned.has(it.finding_id)) t.initiative_id = assigned.get(it.finding_id);
  if (it.finding_id in HOLDS) t.hold_reason = HOLDS[it.finding_id].reason;
  if (it.finding_id in DECISIONS) t.decision = DECISIONS[it.finding_id].decision;
  triage[it.finding_id] = t;
}

const ledger = {
  artifact: '04-ledger',
  schema_version: 1,
  baseline_sha: verdicts.baseline_sha,
  produced_by: { phase: 4, generator: 'artifacts/phase4-triage.mjs', deterministic: true },
  dropped: [],
  counts: {
    total_findings: 107,
    refuted: refuted.items.length,
    auto_fix: autoFix.length,
    auto_fix_land_now: landNow.length,
    auto_fix_held: Object.keys(HOLDS).length,
    structural: structural.length,
    initiatives: Object.keys(INITIATIVES).length,
  },
  initiatives: INITIATIVES,
  triage,
  items: verdicts.items, // verbatim; each validates against schemas/verdict.schema.json
};
writeFileSync(join(ROOT, '04-ledger.json'), JSON.stringify(ledger, null, 1) + '\n');

// ---- Rendered md view ----
const sevOrder = { critical: 0, major: 1, minor: 2 };
let md = `# 04 — Triage Ledger (rendered view; 04-ledger.json is canonical)\n\nBaseline: \`${verdicts.baseline_sha}\` · generated by \`artifacts/phase4-triage.mjs\`\n\n`;
md += `**107 findings** = 44 refuted · 13 auto-fix (12 land now, ${Object.keys(HOLDS).length} held) · 50 structural in ${Object.keys(INITIATIVES).length} initiatives.\n\n`;
md += `## Auto-fix (Phase 5)\n\n| finding | action |\n|---|---|\n`;
for (const it of autoFix)
  md += `| ${it.finding_id} | ${it.finding_id in HOLDS ? '**HELD** — ' + HOLDS[it.finding_id].reason : 'land'} |\n`;
md += `\n## Structural initiatives (Phases 7–10)\n\n`;
const inits = Object.entries(INITIATIVES).sort((a, b) => a[1].priority - b[1].priority || a[0].localeCompare(b[0]));
for (const [initId, init] of inits) {
  const rows = init.findings
    .map((fid) => byId.get(fid))
    .sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || a.id.localeCompare(b.id));
  const crit = rows.filter((r) => r.severity === 'critical').length;
  const loc = rows.reduce((s, r) => s + (r.fix_size_loc || 0), 0);
  md += `### ${initId} (P${init.priority}) — ${init.title}\n\n`;
  md += `${rows.length} findings · ${crit} critical · ~${loc} LOC\n\n| sev | finding | claim |\n|---|---|---|\n`;
  for (const r of rows) md += `| ${r.severity} | ${r.id} | ${r.claim.slice(0, 160).replaceAll('|', '\\|')} |\n`;
  const dec = init.findings.find((fid) => fid in DECISIONS);
  if (dec) md += `\n> **Decision:** ${DECISIONS[dec].decision}\n`;
  md += `\n`;
}
writeFileSync(join(ROOT, '04-ledger.md'), md);

console.log(
  `Phase 4 OK: 04-ledger.json + 04-ledger.md written. ` +
    `${landNow.length} land-now, ${Object.keys(HOLDS).length} held, ${structural.length} structural in ${Object.keys(INITIATIVES).length} initiatives.`
);
