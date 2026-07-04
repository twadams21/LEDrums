# Effects System Review — contract, quality tiers, emissions

**Date:** 2026-07-05 · **Status:** review complete; emission contract + first 4 effects shipped.

## Inventory & provenance (the "which are original?" answer)

All 41 pre-existing effects were committed 2026-06-20 in three waves (git `--diff-filter=A`):

| Generation | Commit | Effects | Character |
|---|---|---|---|
| Gen-0 (S21 original) | `29c9311` | 12 — solid-base, chase, whole-drum/kit, follow-hoop, radial-wash, wipe-3d, meter-eq, pixel-accum, colour-melody, strobe, synced-hoops (+1) | Foundational tracers. **Weakest tier** — several are global singletons (chase = one beat-indexed step; no per-hit identity). |
| Gen-1 (S22 phase 1) | `2dd5234` | 5 — burst, swing, sidechain, sacred-hogs, collisions | Hit-responsive, mid tier. |
| Gen-2 (S22 phase 2) | `77df5f5` | 24 — 12 UV textures (plasma, fire, ripple-pond, …), 4 particles (confetti, lightning, starfield, comet-trails), washes (gravity-wells, wave-collapse, …) | **The good ones** — the suspicion was right. Textures ride `renderUvField`; particles/washes are stateful + seeded. |

New Gen-3 (this change): **chase-bands, ripple-3d, spark-arc, rain-3d** — emission-based, 3D-first.

## The structural diagnosis

The `EffectGenerator` interface itself is healthy — a deep module (`render(ctx, params, fb, state)` + `createState` + `timebase`) with 41 adapters behind it, pure and deterministic. **Do not replace it.** The real gaps were three, and none require breaking the seam:

1. **No per-hit multiplicity primitive.** Weak effects render ONE global thing — chase indexes one step off `transport.beat`; ripple-pond is a wall-clock texture. Repeated hits therefore stack identical copies (in voice mode every voice of an absolute-timebase effect renders the *same frame*, composited N×) instead of layering. The trigger contract (`ctx.triggers` with `seq`/`ageMs`) always supported the right shape; effects just needed a lifecycle helper.
   → **Shipped: `effects/emitter.ts`** — `createEmitterState()` / `updateEmissions(state, ctx, ttlMs, spawnData)`: spawn-exactly-once per `seq`, hit-relative aging via `dt` accumulation (clock-domain agnostic), TTL expiry, in-place compaction, `MAX_EMISSIONS=64` cap. Effects written against it are host-agnostic: correct under the voice bridge's single synthetic trigger (multiplicity via polyphony), under a live trigger stream (legacy engine, sim, thumbnails), and under the thumbnail loop.

2. **Thumbnails: the synthetic hit never re-fired.** `effect-thumb-render.ts` looped `ageMs` over 1600ms but pinned `seq: 1` forever, so every seq-gated effect (confetti, pixel-accum, swing, sidechain, velocity-flames, colour-melody) fired once, decayed below 0.004, and rendered black.
   → **Shipped:** seq now increments per loop (`floor(tMs / THUMB_LOOP_MS) + 1`) — fire → decay → re-fire, forever.

3. **Kit-fraction scale assumptions.** Reaches derived from `bounds.size` fractions break on other models (thumb 26×13) or miss a drum's own pixels (they sit a full drum-radius from the origin — the spark-arc landing-flash bug, fixed by sizing to `target.radiusMm`). Rule: distances that relate to *a drum* derive from that drum's geometry; kit-fraction only for kit-space waves.

## Contract going forward (additive, no API break)

- `EffectGenerator` stays the seam. Extensions are optional members (`timebase` today, `telemetry?(state)` per the perf-SLA plan) — never signature changes.
- **Trigger effects use emissions.** Any effect where a hit "launches a thing" iterates `updateEmissions`; per-emission randomness derives from the state's seeded rng inside `spawnData`. This composes with everything already planned: Rock Solid doc-09 (retrigger timebase), doc-10 (modulation targets emission params like any other), per-effect scope/target.
- **3D is the identity.** New effects should treat the kit as one object in a room: world-space wavefronts that cross drums, paths through the air *between* drums, the negative space as canvas. `pixel-grid` (radius/nearest queries) makes flying-point → pixels cheap; `Pixel.tangent/normal/angleDeg/hoopIndex` give shell-aware shapes.
- Determinism invariants unchanged: seeded RNG in state only, time from ctx, no allocation in the per-frame hot path (in-place compaction pattern).

## New Gen-3 effects (shipped, tested)

| id | What it does | 3D lean |
|---|---|---|
| `chase-bands` | Every hit launches a comet band around the struck drum's hoops (width in hoop-fractions, speed in rev/beat, life in beats). Hits on consecutive beats = bands chasing each other — the exact behaviour the original chase couldn't do. `twist` corkscrews the band up the hoop stack. | Helical ribbon on a real cylinder |
| `ripple-3d` | Spherical wavefront expands in world space from the struck drum and washes across the *other* drums as it reaches them; trailing echo rings; hue ages with distance. Concurrent hits interfere. | The kit is one object in a room |
| `spark-arc` | A spark arcs through the AIR (lofted 3D bezier) from the struck drum to a seeded target drum, dragging a tail, then detonates a radial flash on landing. | Light travels between drums |
| `rain-3d` | Drops fall through the kit's airspace, lighting whatever pixel each is physically nearest (grid lookup) — streaks down a shell, vanishes in the gap, catches the next drum. Hits burst extra drops above the struck drum. | Negative space becomes canvas |

Tests: `effects/batch-e.test.ts` (emitter lifecycle/cap/age-seeding; two-hits-two-bands; ripple crosses drums; arc lands on target; rain bursts + recycles; determinism ×3; finiteness). Registry 41→45.

## Known follow-ups (not this change)

- **Voice-mode mono buses still restart-not-layer** for ANY effect (a retrigger replaces the voice). Emission effects fix the effect-side; the host-side option (route repeat hits into one persistent voice's trigger stream for `multiHit` effects) belongs with Rock Solid doc-09 territory.
- Gen-0 rehab: chase/ripple-pond et al. could migrate to emissions; cheap mechanical batch once the pattern is blessed (chase-bands is the reference).
- Thumbnail `ui-shot` verification of the gallery (seq fix + 4 new thumbs) — owed, no browser driven this session.
- `reduced-motion` static frame renders at 400ms fixed age — dim for short-decay effects; could pick a per-effect representative age later.
