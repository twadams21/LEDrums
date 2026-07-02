# Group H — Modifier nodes (issue #54) — lane-2 orch report

Branch: `group/H` off rock-solid 9d23a5a (contains F+G); integrated with rock-solid 8f69a02
pre-handoff. Slices S28–S32, all merged. **Review verdict: PASS — no findings requiring fixes.**
Final sweep: typecheck 0 errors · **1483 tests passed, 0 failed, 0 skipped**
(core 474, web 819, server 176, io 13, protocol 1).

**Policy note**: first group under Trent's effort tiering (S28/S29 opus-high, S30–S32
opus-medium, orch full-diff review before every merge). All five slices passed review
first-try; whole group built in one morning. The tiering holds.

## Per-slice

| Slice | What landed | Report |
|---|---|---|
| S28 (high) | Modifier engine core: `packages/core/src/modifiers/` registry + `applyModifierChain` between render and blend on BOTH compositor paths (zero-alloc hot path gated on chain length); per-voice `modState` resets with the voice; web sim mirrors via the same core runner; Trail | S28.md |
| S29 (high) | Graph layer: `NodeKind 'modifier'` (inert in eval), `GraphEdge.toPort 'in'\|'mod'` (doc-10-ready), pure `resolveModifierChain` shared engine+sim (mod→mod upstream-first, parallel y-order, cycle-guarded), scoped never-throw validation (fuzzed), mod handle + dashed `--role-mod` wires + chain-count chip + ModifierNodeInspector, persistence round-trip, design system regen | S29.md |
| S30 (med) | Bloom (snapshot-scratch, order-independent), Sparkle + Grain (seeded `voice/prng`), Strobe (voice-clock phase) | S30.md |
| S31 (med) | Echo (per-voice ring-buffer delay line), Pixelate, Mirror (enum axis), HueShift, Levels | S31.md |
| S32 (med) | Slide, Blur, Posterize/Threshold, Feedback, Kaleidoscope, Freeze, Flicker, Chromatic + shared strip helpers; core `listModifiersByCategory()`; ModifierPalette (category filter, registry-driven) + design system regen | S32.md |

## Merges & conflicts

S28 → S29 → S31 → S30 → S32, `--no-ff`, full sweep after each (all green).
`modifiers/registry.ts` conflicted twice (S30 vs S31, S32 vs both) — union-resolved, `ALL[]`
keeps commented per-slice blocks; the module-load duplicate-id guard + the "every registered
modifier exactly once" palette test verify the union executably.

## Review (full group diff vs doc 06 §C + slice file + AGENTS.md)

- **Doc 06 §C scope COMPLETE**: all 10 primary + all 8 second-wave modifiers = **18 shipped**,
  each a pure deep module behind the registry; the LOCKED graph-node model implemented exactly
  (explicit wiring, one modifier → many plays with shared params + per-voice state).
- **Core purity clean** over the 68-file/4158-line diff; the only `Math.random`/wall-clock
  grep hits are docblocks asserting their absence. All randomness seeded (`voice/prng`,
  `mulberry32`); all time is the host voice's clock through the bridge (H×G seam holds — no
  modifier re-derives time; temporal state resets with the voice, pool-reuse tested).
- **Determinism pinned**: per-modifier goldens + determinism tests; bypass = identity ×18;
  unknown id = skip-never-throw on the render path.
- **UI obligations met**: S29/S32 regenerated the design system in-change; palette/inspector
  are registry-driven (no per-modifier UI step — S30/S31's modifiers appeared with zero UI edits,
  proving the seam).

**Deviations reviewed and ACCEPTED** (documented in slice reports): Echo `feedback` in place of
`repeats/falloff` (same ghost-train behaviour); Mirror axis = 1D `low/high/flip` (apply has no
geometry — see residuals); Grain always animates (no `scale/animate` params); levels = one
modifier (sat+brightness+invert); Bloom 1D-only (doc: "start 1D"); e2e wiring tests at the
compositor seam for S30 (sibling file scoping).

## Residuals for the tracker (non-blocking)

1. **Modifier per-param envelopes author but don't apply**: inspector + persistence carry
   `env`, but `ResolvedModifier` deliberately omits it — doc 06 wants modifier params
   envelope-able; doc 10 owns modulation of modifier params. **Lands in group I (my next
   group)** — S33–S38 must wire env through the resolved chain.
2. Geometric (XYZ/per-drum) Mirror + `radiusMm` Bloom need model geometry at the modifier seam
   (1D index space today) — future slice if wanted.
3. Echo ring depth 64 frames (~1s at 60fps): longer `delayMs` saturates.
4. Doc 10 should reuse `toPort` as designed (`param:<key>` extension point is in place).

## Context pack for group I (S33–S38, modulation)

- **The env seam**: `ResolvedModifier {modifierId, params, bypass}` in `modifiers/types.ts` —
  add `env` there, populate in `resolveModifierChain` (node.env is already authored/persisted),
  sample per-frame where the compositor calls `applyModifierChain` (both paths + web sim
  mirror at `render.ts`). `sampleEnvelope`/`adsrToPoints` (S23) are the primitives.
- **Wiring infra to extend**: `GraphEdge.toPort` currently `'in'|'mod'` — doc 10 widens with
  `param:<key>`; validation lives in `store/graph-wiring.ts` (`directionOk`), hit-test routing
  by source kind in the S29 canvas changes.
- **References**: EnvelopeEditor/EasePicker (group-F §S24) for any new envelope UI; VoiceStat +
  thumb-clock (group-E/G) for S38 signal previews.
