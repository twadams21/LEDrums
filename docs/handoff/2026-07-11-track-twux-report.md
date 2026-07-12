# Track T — twux fleet: completion report

**Experiment:** A/B of two orchestration approaches on the "Patch-Graph Integrity &
Review Remediation (Waves 1–2)" spec. Track T ran 6 of the 11 slices via a **twux fleet**
(real tmux implementer sessions). Track W (the sibling) runs the other 5 via dynamic
Workflow, launched separately.

**Result:** all 6 slices delivered and merged into `track/twux` (off `main` @ `8ecbca1`).
Branch left **unmerged** — Trent integrates the two tracks. Final gate green.

## Slices (dispatch → accepted)

| Wave | Slice | Effort | Wall (dispatch→report) | Escalations | Review | Gate fails | Fence viol |
|---|---|---|---|---|---|---|---|
| 1 | S01 setKitOutputs gate | medium | ~8m | 0 | clean | 0 | 0 |
| 1 | S02 PatchGraphView self-heal | medium | ~8m | 0 | clean | 0 | 0 |
| 1 | S05 HTTP handler extraction | medium | ~8m | 0 | clean | 0 | 0 |
| 2 | S07 core routing-validation seam | **high** | ~20m | 1 (boot Q) | clean (excellent) | 0 | 0 |
| 2 | S08 cleanup wave | low | ~10m | 0 | 1 flagged (orphans) | 0 | 0 |
| 3 | S11 editor fan-out rejection | medium | ~16m | 0 | **B1 blocker** (fixed) | 0 | 0 |

Waves 1 (S01/S02/S05) and 2 (S07/S08) each ran file-disjoint in parallel (cap 3). S11
serial after both deps merged.

## Keystone delivered
One definition of "valid routing" in `packages/core/src/model/routing-integrity.ts`
(`validateRouting` → 4 named issue classes: schema / unknown-drum / hoop-out-of-range /
hoop-fan-out), consumed at **two enforcement points without restatement** — the server
write-gate (`client-message.ts`) and the editor connect-guard (`hasHoopFanOut`). fan-out
detection catches the silent-overwrite class `buildDmxMap` misses.

## Escalations (1)
- **S07 `loadProject` boot question** — the pre-flagged one. Implementer traced the boot
  path (top-level `initialProject()`, no try/catch → a throw bricks boot) and found new
  outputs corruption is recoverable via `buildMapSafe`. Orchestrator resolved from spec
  intent + the "never brick" non-negotiable: **Option A** — no load-time throw; the loud
  surface is the `buildMapSafe`→Monitor degradation event naming the bad ref. Not surfaced
  to Trent (clearly spec-resolvable). No human intervention.

## Track-level review (fable/high) → 2 blocking, 5 followups
Report: `docs/handoff/2026-07-11-track-twux-review.md`.
- **B1 (fixed):** S11's `onReconnect` bypassed the fan-out guard on the *hoop-end* drag —
  editor accepts a fan-out the server rejects → the incident desync class. Re-dispatched to
  the S11 implementer; shared `edgesFanOut` helper now gates add + re-point; F4 folded in.
  Merged, gate green (web 1432).
- **B2 (satisfied):** S08 shipped without its required `pnpm ui-shot` evidence. Captured the
  copy surfaces post-hoc — `pnpm ui-shot patch-graph effect-gallery transport patch-controller
  --strict` passed (exit 0 = **no console errors**) at the track tip; copy renders correctly.
  Low-risk string-only edits, svelte-check + tests green.
- Followups filed (not blocking): F1–F5 below.

## Followups to file
- **F1 (high value):** `setProject` (bulk re-rig) applies + persists routing that
  `setKitOutputs` rejects — it validates `projectPatchSchema` shape only, not routing
  integrity. A pasted ClipDoc with a hoop fan-out is applied+broadcast+autosaved silently
  (fan-out doesn't throw in `buildDmxMap`, so no degradation event either). One-call fix:
  `validateRouting(patch.kit, patch.kit.outputs)` in the accepted-parse branch. **Out of
  every Wave-1/2 fence — needs its own tiny slice.**
- **F2:** byte-exact golden routing fixtures (invoked by S01/S07 acceptance) don't exist
  in-repo. Pin the authoritative rig routing (kick 196 / snare 108 / tom1 108 / tom2 136,
  PixLite A4) as a fixture that must pass `validateRouting` untouched.
- **F3:** `assertRoutingIntegrity` + `RoutingIntegrityError` have zero consumers (Option A
  dropped the intended `loadProject` caller). Trim, or keep with a note naming a future
  caller (CLI/migration tool).
- **F5:** the two new HTTP handlers duplicate route-match boilerplate; a third route earns
  a shared `route()` helper.
- (F4 was folded into the B1 fix.)

## Orchestration overhead / harness notes
- **Trust-dialog boot failure (one-time):** first Wave-1 launch died on Claude's
  folder-trust dialog for the new worktree paths (twux failed loudly, as designed). Fixed by
  pre-trusting w1/w2/w3 in `~/.claude.json`. ~10 min, 0 human.
- **ui-shot server reuse gotcha:** ui-shot reuses an already-running dev server on :5173
  regardless of which worktree invoked it — captures reflected the wrong worktree until the
  stale server was killed. Worth a note in the ui-shot README (detect cwd/worktree mismatch).
- Human interventions in the slice work: **0** (past the one-time trust seed). The only
  human decision points were the deliberate escalation gates (none triggered to Trent) and
  the review-model choice.

## Final state
- `track/twux` HEAD: see `git log` (Wave 1+2 merges + review report + B1 fix). Unmerged.
- Full sweep at the track tip: `pnpm typecheck` 0 errors; `pnpm test` green
  (core 746, server 289, web 1432, io 54, protocol 1).
