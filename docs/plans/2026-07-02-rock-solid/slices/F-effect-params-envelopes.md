# Group F — Effect params & envelopes

Context: [doc 05](../05-effects-color-params-envelopes.md) · Parent PRD: #45 · Stories: 22–25

## S18 — Enum params end-to-end `effects`

**Blocked by:** none.

**What to build:** Widen the param value type to include enum strings (core voice types, sim,
setShow schema path, persistence coercion). The spec-mapping seam maps enum params to a Select
control in the play-node inspector instead of dropping them. Demo effects: radial-wash mode
(out/in/bounce) and wipe-3d axis/mode change output live.

**Acceptance criteria:**
- [ ] Enum params render, edit, persist, and reach the engine (round-trip test)
- [ ] Changing radial-wash mode / wipe-3d axis changes rendered output (engine golden)
- [ ] No param spec type is silently dropped any more (mapping unit test over all four types)

## S19 — Colour batch 1: swatch + hit/trigger effects `effects`

**Blocked by:** none.

**What to build:** The write-through colour swatch control (hex ↔ HSB, updates the underlying
hue/saturation/brightness numeric params; shows a modulation badge instead of animating when a
param is modulated). Add saturation (+brightness where missing) to the core hit/trigger effects
(chase, wholeDrum, wholeKit, followHoop, burst, pixelAccum, syncedHoops, swing, colourMelody).
Start the effect×params audit table (implementation appendix committed with the slice).

**Acceptance criteria:**
- [ ] Saturation 0 ⇒ white output on lit pixels for every batch effect (engine goldens)
- [ ] Swatch writes through to sliders and reflects them (component test)
- [ ] Audit table covers the batch (before/after params)

## S20 — Colour batch 2: wash/base/utility/meter `effects` `mechanical`

**Blocked by:** S18 (shared files with enum demo effects), S19 (pattern + swatch).

**What to build:** Same colour pass for radialWash, wipe3d, solidBase, breathingKit,
hueRotateKit, strobe, tempSweep, meterEq, sidechain. Follow the S19 pattern exactly; extend the
audit table.

**Acceptance criteria:**
- [ ] Saturation/brightness exposed and functional on all batch effects (goldens incl. white)
- [ ] Existing presets/params unaffected (defaults preserve current output)

## S21 — Colour batch 3: textures `effects` `mechanical`

**Blocked by:** S19.

**What to build:** Colour pass for plasma, fire, ripplePond, rainbowFlow, tunnel, checkerPulse,
perlinClouds, lavaLamp, interference, caustics, spiral, gridGlow, waveCollapse — multi-colour
effects expose range/offset controls where a single hue is wrong. Extend the audit table.

**Acceptance criteria:**
- [ ] Every texture effect has meaningful colour control (goldens per effect)
- [ ] Defaults preserve current look (golden parity)

## S22 — Colour batch 4: particles `effects` `mechanical`

**Blocked by:** S19.

**What to build:** Colour pass for starfield, cometTrails, lightning, confettiBurst, helix,
orbitRings, gravityWells, collisions, sacredHogs, velocityFlames. Complete the audit table (all
41 effects accounted for).

**Acceptance criteria:**
- [ ] Colour control on all batch effects (goldens); defaults preserve current look
- [ ] Audit table complete across the registry

## S23 — Envelope core v2 `effects`

**Blocked by:** none.

**What to build:** The envelope shape gains attackLevel and independent per-segment easings
(standard easing set: linear/quad/cubic/quart/expo/sine/circ/back/bounce/elastic × in/out/inOut).
Shape + easing + sampling code single-sourced in core, web imports it (delete sim duplicates —
the computeDelayMs precedent). Behavior-preserving idempotent migrator from the legacy single
curve field.

**Acceptance criteria:**
- [ ] Sampling goldens per easing fn/dir; attackLevel scales attack peak and decay start
- [ ] Migrator parity (legacy curve vs migrated shape sample-identical) + idempotency
- [ ] Web sim and core sample byte-identically (single source verified by import, not copy)

## S24 — EnvelopeEditor component rework `effects` `ui-significant`

**Blocked by:** S23.

**What to build:** The envelope editor component (reused later by the Envelope node inspector):
attack handle draggable in Y (attackLevel), per-segment ease selection (click segment → ease
fn/dir controls, family-grouped), single Curve slider removed. Keyboard accessible,
reduced-motion aware.

**Acceptance criteria:**
- [ ] Attack level and per-segment eases editable; shape round-trips through the model
- [ ] Pure handle↔shape geometry helpers unit-tested; component test via jsdom infra
- [ ] Applies `/make-interfaces-feel-better`
