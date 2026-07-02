# Group F — Effect params & envelopes (issue #51) — lane-2 orch report

Branch: `group/F` @ d02cf34 (integrated with rock-solid 453576e pre-handoff).
Slices S18–S24, all merged. **Review verdict: PASS** (2 trivial findings, fixed in-branch).
Final sweep: typecheck 0 errors (all 6 projects) · **1300 tests passed, 0 failed, 0 skipped**
(core 327, web 783, server 176, io 13, protocol 1).

## Per-slice

| Slice | What landed | Report |
|---|---|---|
| S18 enum params | ParamValue widened to `number\|boolean\|string` (core+web mirrored); `mapParamSpec` total over all 4 ParamTypes; enum → Select in PlayNodeInspector; radial-wash mode / wipe-3d axis+mode live | S18.md |
| S19 colour batch 1 | ColorSwatch write-through primitive (hex↔HSB, env badge); saturation on 8 hit/trigger effects; colour-pass RECIPE + audit table established | S19.md |
| S20 colour batch 2 | 9 wash/base/utility/meter effects; temp-sweep warm/cool endpoints (justified deviation) | S20.md |
| S21 colour batch 3 | 13 textures; tunnel + rainbow-flow multi (hueOffset/hueRange); lava-lamp + caustics gained base hue | S21.md |
| S22 colour batch 4 | 10 particles; starfield/lightning keep non-1 default saturation; confetti/gravity-wells range remap; **audit closed 41/41** | S22.md |
| S23 envelope core v2 | attackLevel + per-segment EaseSpec (10 families × 3 dirs) single-sourced in core; web re-exports by value (identity-tested); migrateAdsr exact-parity + idempotent | S23.md |
| S24 EnvelopeEditor | attackLevel Y-drag, per-segment ease selection (new EasePicker primitive), curve slider removed; migrateAdsr wired on hydrate; defaultAdsr v2-canonical | S24.md |

## Merges & conflicts

- All slice merges `--no-ff` into group/F, full sweep after each (every one green).
- Two conflicts, both additive add/add in `packages/core/src/effects/effects.test.ts`
  (parallel batches adding imports + describe blocks at the same anchors). Resolved by union —
  each batch keeps its own describe block with its own scanLit scaffolding. No source-file
  conflicts anywhere.
- Pre-handoff integration merge of rock-solid (tracker commits only, trivial).

## Review findings (full-diff review vs doc 05 + slice file + AGENTS.md)

1. **Core purity: clean** — no Node/DOM/IO imports anywhere in the core diff; effects remain
   pure functions of RenderContext (grep over full 76-file diff).
2. **LOCKED decision honored: swatch is UI-only** — persistence/protocol carry only numbers +
   enum strings; no stored colour values (verified: no persistence/schema/server files in the
   diff; enum persistence round-trip byte-for-byte in enum-params.test.ts — coerceAuthored
   passes params through untyped, so no defensive-coercion change was needed; evidenced by
   test rather than code, accepted).
3. **ParamValue mirror intact** — core `voice/types.ts` and web `sim.envelopes.ts` structurally
   identical (`number | boolean | string`), both sides documented.
4. **Audit table complete** — 41/41 registry effects with before/after params + swatch/multi
   classification. (Finding: tally line still said "S21 in flight" — fixed d02cf34.)
5. **Design-system rule honored** — ColorSwatch + EasePicker are lib/ui primitives, demoed in
   the styleguide, design-system.html regenerated in the same change (both slices).
6. (Finding: stale "owned here until S18 widens" comment header in sim.envelopes.ts — fixed
   d02cf34.)

## Context pack for dependent groups (H, I — this lane; S31/S33/S34/S38)

- **Enum params (S31 builds on this):** the two mirrored ParamValue definitions
  (`packages/core/src/voice/types.ts:111`, `apps/web/src/lib/trigger-lab/sim.envelopes.ts:47`)
  MUST be widened together. Engine routes strings untouched: `compositor.ts:58`
  applyEffectiveParams copies all params, envelope loop skips non-number specs;
  `generator-bridge.ts:80-85` overlays live keys onto generator defaults. `mapParamSpec`
  (fixtures.ts, exported) is total — new ParamTypes need a control branch there + inspector.
- **Envelope seams (S33 modulation core consumes):** `packages/core/src/voice/envelope.ts` —
  `adsrToPoints(a, n=48)`, `sampleEnvelope(env, phase)`, `migrateAdsr` (idempotent; only
  curve===0 promotes to explicit eases, others ride the legacy-curve fallback for exact parity);
  `easing.ts` — `ease(spec, t)`, add a family = one IN-table entry. The compositor sampler is
  shape-agnostic — richer shapes need no compositor change.
- **EnvelopeEditor (S34's Envelope node inspector reuses):** `EnvelopeEditor.svelte` +
  pure geometry in `envelope-editor-geom.ts` (unit-tested) + `lib/ui/EasePicker.svelte`
  (family-grouped fn/dir). Shapes round-trip via `store.setEnvAdsr`. Hydrate normalizes legacy
  shapes via migrateAdsr (`store/hydrate.ts`, foldVelocitySwitch precedent).
- **Colour conventions (any future effect):** every colour effect exposes
  hue+saturation+brightness (auto-swatch via PlayNodeInspector `hasColorSwatch`) OR
  range/offset params for multi-colour (no swatch, `*multi*` in audit). Golden pattern:
  sat 0 ⇒ lit>0 ∧ achromatic; defaults byte-preserve old output.
- **What NOT to redo:** don't re-widen ParamValue; don't add zod to setShow (none exists —
  decodeClient is bare JSON.parse by design); don't duplicate easing code in web (import from
  core; identity test enforces).
