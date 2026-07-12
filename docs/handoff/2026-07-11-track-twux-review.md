# Track-level review: track/twux (Patch-Graph Integrity, Waves 1–2)

**Reviewer:** twux rev · 2026-07-11
**Reviewed:** `git diff main...track/twux` (main=`8ecbca1`, track tip=`8a57468`), 20 commits, 6 slices (S01, S02, S05, S07, S08, S11), against the Notion slice briefs + parent spec + AGENTS.md.
**Method:** two-axis `/code-review` (Standards + Spec sub-agents) + direct keystone verification + full gate run.

## Verdict: **Changes needed** — 2 blocking, 5 followups

Gates on the track tip are green: `pnpm typecheck` 0 errors, `pnpm test` all suites pass
(web: 145 files / 1431 tests), exit 0. The keystone architecture is delivered correctly
(§Verified below). The two blockers are a real integrity bypass in S11's third connect
path, and missing acceptance evidence for S08.

---

## BLOCKING

### B1 — Reconnect gesture bypasses the fan-out guard and silently desyncs editor from server (S11)

`apps/web/src/lib/app/views/PatchGraphView.svelte:221-234` (`onReconnect`)

**Problem.** S11 guards `onBeforeConnect` and `dropConnect` (which delegates at
`PatchGraphView.svelte:214`), but `onReconnect` re-points **either end** of an existing
wire (`:79`: "wire = the reconnectable custom edge (its ends are drag anchors)") with only
self/controller/input checks — no fan-out (and no duplicate) check. Dragging the **hoop-end**
anchor of a hoop→dataline wire onto a different hoop that already has its own data line puts
that hoop on two lines — a connect-gesture fan-out the editor accepts.

The doc comment at `:150-152` asserts a reconnect "re-homes a hoop by MOVING its one wire …
so it never reaches this gate and is never rejected as a fan-out" — true only for the
dataline-end drag (the tested case, `patch-routing.test.ts`); false for the hoop-end drag.

**Failure chain.** `onReconnect` → `commitRouting()` (`:322-328`, syncs `lastSig` to the
fan-out routing) → `store.setRouting` (`trigger-lab/store.svelte.ts:2053-2057`) applies the
corrupt routing to the **local** project optimistically, then sends `setKitOutputs` → the
S01/S07 server gate correctly rejects (error reply, no state, no broadcast). Net: server
keeps last-known-good, but the canvas and the local `project.kit.outputs` durably hold the
fan-out (the adopt `$effect` sees local project ≡ `lastSig`, so nothing snaps back); the
only signal is the dismissible `store.serverError` notice. This is the incident failure
class — editor believes an edit the engine refused — minus persistence. User story 6
("the editor can't author a patch the physical rig cannot execute") is violated on this path.

**Fix (small, in-fence for S11).** In `onReconnect`, before applying: build the prospective
edge set (`edges.map(e => e.id === oldEdge.id ? re-pointed : e)`), run it through
`routingFromGraph` + `hasHoopFanOut` (same probe shape as `wouldFanOut`, minus the old
edge), and on fan-out push `FANOUT_REJECTION_MESSAGE` + snap the anchor back (the existing
`hover.decorate([...edges])` no-op path). Add the dup check while there. Correct the
`:150-152` comment. Test via the pure helpers with a hoop-end re-point.

### B2 — S08 copy wave shipped without its required ui-shot evidence

AGENTS.md (non-negotiable): "UI changes must be verified with `pnpm ui-shot` captures."
The S08 brief's acceptance restates it explicitly: "ui-shot the surfaces with visible copy
changes (transport tooltip, patch palette, the three inspectors, effect gallery)."

The ten copy commits (`aea73e6..000ff48`) touch seven rendered surfaces; zero commits
record a capture (grep of all track commit bodies: the only ui-shot mention is S11's
`aebac1d`, which documents a deliberate, reasoned waiver — the correct form). Risk is low
(string-literal-only edits; svelte-check + 1431 tests green) so this is an **evidence gap,
not a suspected defect** — satisfiable by running `pnpm ui-shot` on the affected surfaces
and recording the result, not by code change. Flagged blocking because it is a
constitutional repo rule and the slice's own acceptance line, and letting it slide unmarks
the rule.

---

## Followups (file, don't block)

### F1 — `setProject` applies + persists routing that `setKitOutputs` would reject (S effort, highest-value followup)

`apps/server/src/handlers/client-message.ts:294-331`. The bulk re-rig gate validates
`projectPatchSchema` only — shape, not routing integrity. A pasted ClipDoc whose outputs
carry a hoop fan-out (or dangling drum ref) is applied, broadcast, and autosaved
(`autosaver.markDirty()`, `:330`). For fan-out specifically, `buildDmxMap` does not throw
(routing-integrity.ts's own doc: fan-out "succeeds" into a wrong map), so there is **no
degradation Monitor event either** — silently wrong physical output, violating spec user
story 8. The server now disagrees with itself about validity across its two write paths,
the exact drift the one-definition seam exists to prevent. Fix is one call:
`validateRouting(patch.kit, patch.kit.outputs)` inside the accepted-parse branch, same
reply/monitor contract. Out of every Wave-1/2 fence (S07's fence limited client-message.ts
to "gate upgrade only"), so a slicing gap, not implementer error — needs its own tiny slice.

### F2 — "Byte-exact golden routing fixtures" don't exist in-repo

S01/S07 acceptance both invoke golden fixtures; no such fixture exists (no routing JSON in
the repo; `defaults.ts` outputs is `[]`; all new tests use synthetic minimal kits). The
acceptance line was unverifiable as written. Worth pinning the authoritative rig routing
(kick 196 / snare 108 / tom1 108 / tom2 136, PixLite A4 expanded, dense) as a fixture that
must pass `validateRouting` untouched.

### F3 — `assertRoutingIntegrity` + `RoutingIntegrityError` have zero consumers

`packages/core/src/model/routing-integrity.ts:50-59,147-153`. The intended caller
(`loadProject` throwing) was deliberately dropped by orch-approved Option A, leaving the
loud-fail surface exported but dead. Either trim it or keep it with a note naming its
intended future caller (e.g. a CLI/migration tool). Minor.

### F4 — `wouldFanOut` falls back to `DEFAULT_KIT` when no project is loaded

`PatchGraphView.svelte:157`: `store.project?.kit ?? DEFAULT_KIT` can validate a connect
against a kit that doesn't match the displayed topology. Theoretical (patch editor without
a project is an edge state); fold into the B1 fix.

### F5 — Route-match boilerplate duplicated across the two new HTTP handlers

`apps/server/src/http/native-midi.ts:52-53` / `update-status.ts:60-61`: identical
URL-parse + path-gate + boolean-return shape. Two files is tolerable; a third route earns
a tiny shared `route()` helper. Judgement-call smell only.

---

## Verified — no findings

- **Keystone (spec intent):** `packages/core/src/model/routing-integrity.ts` is the ONE
  definition — four distinct named issue codes (`schema` / `unknown-drum` /
  `hoop-out-of-range` / `hoop-fan-out`), schema reused from `kitSchema.shape.outputs`,
  referential rules mirroring `buildDmxMap`'s exact throw set. Consumed at both enforcement
  points without restatement: server via `validateRouting` (client-message.ts:343), editor
  via `hasHoopFanOut` → `checkRoutingIntegrity` (patch-routing.ts:146). S11 imports the
  rule; it does not fork it.
- **Core purity (AGENTS.md):** routing-integrity.ts imports only kit-schema + integrity —
  pure TS + zod, no Node/DOM/IO.
- **S01/S07 gate contract:** invalid `setKitOutputs` → error reply + Monitor event + zero
  state + nothing autosaved; valid → applied unchanged (asserted in
  client-message.test.ts:500-598). S07's upgrade preserved S01's reply/monitor contract.
- **S02 self-heal:** guarded fault → `forceRebuild()` re-derives the output half from
  authoritative `store.project.kit.outputs` via pure, unit-tested `rebuildOutputHalf`
  (patch-graph.ts), positions preserved, `lastSig` synced; fault still reported. S08's copy
  edits in the same file don't disturb it.
- **S05 extraction:** line-for-line behaviour-preserving vs `git show main:apps/server/src/main.ts`
  (same routes, responses, error shapes); `compareVersions` table-driven tests
  (update-status.test.ts); main.ts shrank ~130 lines.
- **S08:** all ten copy strings changed exactly as inventoried; deleted symbols
  grep-verified to zero importers; knip.json records exactly the five entry-point false
  positives with files intact.
- **buildMapSafe degradation (S07):** names the offending reference via
  `checkRoutingIntegrity`, buffers when no sink, flushes at `setMonitor` for boot-time
  corruption (voice-engine-host.ts:131-169,491-496; tested).
- **Intentional decisions respected:** loadProject Option A honored (not flagged);
  the 8 orphaned PARAM_LIBRARY helpers left per fence (not flagged).
- **Gates:** `pnpm typecheck` 0 errors; `pnpm test` full sweep green at `8a57468`.
