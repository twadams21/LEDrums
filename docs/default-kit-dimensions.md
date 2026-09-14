# Default kit: Blender LED-path dimensions

Updated: 2026-09-14. Requirement: Trent's request, “update the app kit to match the
blender dimensions which will be much more accurate.” This correction adopts dimensions
only, **not Blender poses**, in `packages/core/src/model/defaults.ts`.

## Source and meaning

Read-only references under `docs/cad/drum-kit/.cache/`:

- `lighting/cad-led-layout.json`: measured frozen Onshape tape meshes, microversion
  `ccb469f8e706cc0c8c1207c4`. SHA-256:
  `d88fa659809d14cd8bd11b236d82196191f43535905a3e052285077042b7df7b`.
- `blender/realism/raised-rim-v1.blend` and `raised-rim-v1-audit.json`: the audit reports
  PASS, preservation of original tape geometry/poses, and 2192 engine pixels. The blend's
  read-only SHA-256 check matches the audit's `outputSha256`:
  `8715c5423ff8efe96966d7a448f617888034fd1f149c7ac2d7ee84a84b22acbc`.

The source's `*.hoopN.tape.OUTWARD-emission.120LED-per-m` radial bounds describe the tape,
not the outer acrylic shell. Use the exact tape-centre dimensions supplied with the request
below, rather than retaining tessellation/float noise from the measurements. The CAD density
label does **not** replace the rig's literal pixel counts.

| App id | CAD drum | LED path diameter (mm) | Adjacent-hoop spacing (mm) | First-to-last hoop span (mm) | Pixels/hoop |
| --- | --- | ---: | ---: | ---: | ---: |
| kick | kick | 513.5 | 94 | 282 | 196 |
| snare | snare | 278.5 | 182 / 3 | 182 | 108 |
| tom1 | tom1 | 278.5 | 182 / 3 | 182 | 108 |
| tom2 | floor-tom | 358.5 | 322 / 3 | 322 | 136 |

`diameterIn = diameterMm / 25.4` without decimal rounding. Radii are 256.75, 139.25,
139.25 and 179.25 mm. Four hoops per drum remain **2192 pixels total**, in the same
kick → snare → tom1 → tom2 / hoop / pixel order.

## Preserve the app's existing world poses

The old seed was version 3: `parseKit` shifted each first-hoop origin by
`R × (0, 0, 90 mm)` (half of its old 3 × 60 mm stack) to produce the current centred
origin. Changing spacing on that legacy seed would change the shift and move the drums.
The new seed uses `CURRENT_KIT_VERSION` (7 at this correction), explicit four-entry
`hoops[]`, and these **exact existing post-migration** centres:

| App id | World centre (x, y, z), mm | Intrinsic XYZ rotation, degrees |
| --- | --- | --- |
| kick | (0, 340, 330) | (90, 0, 0) |
| snare | (-230, 0, 740) | (0, 0, 0) |
| tom1 | (-120, 272.18847050625476, 925.5950864665638) | (18, 0, 4) |
| tom2 | (360, 40, 710) | (0, 0, 0) |

IDs, labels/colours, reverse flags, local spin (270°), start angle (0°), global settings
and routing are unchanged. Pixels resize around those centres; individual hoop positions,
skin/effect origins, segment lengths and overall bounds necessarily change with the dimensions.
The global 60 mm fallback is unchanged; every default drum supplies its own spacing.

## Verification and limits

`defaults.test.ts` freezes the old v3 seed independently and checks exact non-dimensional
field parity, world centroids, every pixel's radius/axial placement, literal counts, angular
identity/order, full DMX-map equality, and independent default-project JSON round-trips.
In-memory saved-project fixtures (legacy, migrated and custom-routed/reversed) retain their
own dimensions and geometry without input mutation. The new suite first failed only its
four requested-dimension cases against the old defaults; all 61 focused tests now pass:

```sh
pnpm --filter @ledrums/core exec vitest run \
  src/model/defaults.test.ts src/model/project-schema.test.ts \
  src/geometry/origin-centre.test.ts src/geometry/pixel-model.test.ts \
  src/geometry/per-hoop-attrs.test.ts src/geometry/dmx-map.flat-rgb.test.ts \
  --no-file-parallelism --maxWorkers=1 --minWorkers=1 --no-cache
```

`apps/server/projects/default.json` is absent and not tracked in this checkout; no seed
file was created. No saved `.local` files were read or written. No bootstrap/migration,
Stage/exporter/web/protocol or CAD cache changes; core has no IO dependency. Blender was
not launched. Full gates, UI/hardware verification, benchmarks, `.mex` and git delivery
remain the parent task's responsibility; existing saved kits are intentionally not upgraded.
