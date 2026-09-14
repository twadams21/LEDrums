---
name: stage-serialization
description: Shared physical drum placement for Stage without changing authoritative LED geometry.
triggers:
  - "Stage serialization"
  - "SerializedDrum.stage"
last_updated: 2026-09-14
---

# Stage serialization

## Context
Source: an agent-selected implementation seam supporting Trent's approved Blender-backed Stage
on Trent's MacBook Pro, 2026-09-14; not a separately stated user API requirement. Protocol owns
one pure `serializePixelModel(PixelModel)`; server `serializeModel` is an alias and offline web
`trigger-lab/kit.ts` calls the same function. No core geometry/default changes are needed.

## Steps and gotchas
1. Copy old positions/normals/tangents/segment lengths/drum identities/bounds verbatim.
2. Recover raw world X = `normal*cos(angle) - tangent*sin(angle)` and Y =
   `normal*sin(angle) + tangent*cos(angle)` from a pixel's `angleDeg` (degrees).
   If the first pixel's local Z is positive on a multi-hoop drum, negate recovered Y for flip.
3. Locate first/last hoops with prefix sums of `DrumInfo.hoopPixelCounts`, never a uniform stride.
   Centres are `world - normal*radius`; origin is their midpoint, Z their normalized difference.
   Do not use the skin-side effect origin for body placement or X cross Y for Z: mirrors can
   produce a left-handed frame. Body orientation must not rotate with start angle/spin/reverse.
4. Emit optional `stage` only for a valid multi-hoop, positive-span frame. Missing metadata means
   Pixels fallback. Metadata is world mm + unit physical drum-local XYZ, not metres or glTF Y-up;
   asset axis/unit conversion is the consumer's responsibility.

## Verify / debug
- Focused tests: protocol `src/model-serialization.test.ts src/schemas.test.ts`, server
  `src/ws-protocol.test.ts`, web `src/lib/trigger-lab/kit.test.ts` (run from each workspace).
- `pnpm --filter @ledrums/protocol typecheck` checks exact drum/stage/model schema-interface locks.
- Use explicit `CURRENT_KIT_VERSION` on body-centred test fixtures: unversioned `parseKit` input
  runs the old skin-origin migration, so expected translations otherwise shift by half a stack.
- Preserve core, store and visualizer ownership when implementing this seam; no running app,
  network, CAD, hardware or full sweep is needed for these pure serialization tests.

## Update scaffold
Record seam/consumer contract changes in `.mex/ROUTER.md` and `.mex/context/architecture.md`.
