# Group I — Modulation system (issue #57) — lane-2 orch report

Branch: `group/I` off group/H 406548e; integrated with rock-solid (tracker-only) pre-handoff.
Slices S33–S38, all merged. **Review verdict: PASS — no findings requiring fixes.**
Final sweep: typecheck 0 errors · **1611 tests passed, 0 failed, 0 skipped**
(core 532, web 889, server 176, io 13, protocol 1).

**This completes lane 2** (F 7 + G 3 + H 5 + I 6 = 21/21 slices). Test suite over the lane:
1111 → 1611 (+500), zero regressions, every slice first-try review pass.

## Per-slice

| Slice | What landed | Report |
|---|---|---|
| S33 (high) | Mapping model (target/source/amount/invert/range), base-relative summed+clamped sweep on BOTH carriers (`Voice.modulations` + `ResolvedModifier.modulations`), envelope source by voice phase, legacy-parity fixture, sim mirrored | S33.md |
| S34 (high) | Envelope node (shape in `env['shape']`), exposed-param rows + `param:<key>` edges (one edge = one mapping, settings ON the edge, target-side editing), shared resolver engine+sim, **group-H modifier-env residual closed**, EnvelopeEditorView extraction, 3rd wire role | S34.md |
| S35 (med) | Hydrate migrator: play env → envelope nodes + mappings (parity via S33 fixture, idempotent, alias-stable); `Voice.env`/`PlayAction.env` + legacy sweep DELETED (compile-verified) | S35.md |
| S36 (med) | LFO node: sine/tri/saw/square/S&H (hash-derived), Hz or division (REUSES delay.ts vocabulary), phase offset; pure f(timeMs,bpm), continuous | S36.md |
| S37 (med) | CC-In node: engine CC table mutated ONLY in processEvent (cleared on setShow — same log ⇒ byte-identical frames), channel/omni keying, MIDI-learn reuse, CC 0 rejected; server routes CC events | S37.md |
| S38 (med) | Signal previews: SignalFace primitive (shared thumb ticker, viewport-gated, reduced-motion static — NO new rAF), envelope/LFO/CC faces + param-row live ticks, all sampled through core fns | S38.md |

## Merges & conflicts

S33 → S34 → S36 → S35 → S37 → S38, `--no-ff`, full sweep after each. S37's merge was the
designed 13-file seam union vs S36+S35 (NodeKind / MOD_SOURCE_KINDS / ModSource / sampleSource /
inert cases / Inspector / meta / store) + design-system regen; one hand-splice error (dropped
closing brace living in the shared tail) was caught immediately by the post-merge sweep.

## Review (full group diff — 74 files / 5273 insertions — vs doc 10 + slice file + AGENTS.md)

- **Doc 10 delivered end-to-end**: sources (envelope/LFO/CC) → `param:<key>` wires → exposed
  param rows on play AND modifier nodes → per-frame summed-and-clamped sweep; **no dual
  mechanism remains** (legacy env sweep deleted, migrator proven sample-identical).
- **Core purity clean**; determinism grep clean (only docblock assertions). LFO S&H is
  hash-derived; CC table state changes only on the drained event log; all sampling pure.
- **Sim/engine can't drift**: one resolver, one sweep, one sample path shared by both.
- **UI obligations met**: design system regenerated in-change (S34/S36/S37/S38); previews ride
  the ONE shared ticker; reduced-motion static frames; signal animates, chrome doesn't.
- **Deviations reviewed and ACCEPTED** (in slice reports): base-relative contribution algebra
  (the only legacy-exact form); parity float-precision not bit-identity (range-clamp ~1 ULP at
  endpoints); play mapping ranges baked on the edge at wire time (eval-graph has no effect
  specs; sweep still clamps live); per-key migration without shape-dedup (explicit-wiring
  idiom; cosmetic); param-row tick = post-invert source signal (indicator, not final value);
  S38 CC bar reads the sim mirror table.

## Residuals for the tracker (non-blocking)

1. Modifier nodes' per-param envelopes still author via the S29 inspector + S34 bridge — they
   apply correctly, but authoring could converge on envelope NODES like play params did (an
   S35-style migration for modifier env) if a uniform surface is wanted.
2. Play mapping ranges bake at wire time — switching a play node's effect after wiring keeps
   the old range until rewired (sweep clamps to live spec, so safe, just stale).
3. Server→web CC echo for hardware-at-server MIDI-learn (S37 learn works on the local WebMIDI
   path).
4. Migration creates one envelope node per env[key] (no identical-shape dedup) — cosmetic
   canvas density on env-heavy old shows.

## Context pack (other lanes / master)

- Modulation is one model: `Mapping` in `voice/modulation.ts`; add a source = one `ModSource`
  arm + one `sampleSource` case + one `nodeModSource` case + `MOD_SOURCE_KINDS` entry (S36/S37
  are 2 worked examples). Targets are generic over play + modifier params.
- `GraphEdge.toPort` is now `'in' | 'mod' | param:<key>` with per-mapping settings on the edge.
- `SignalFace.svelte` = the reusable live-canvas primitive (shared ticker + visibility +
  reduced-motion) for ANY future node-face preview.
