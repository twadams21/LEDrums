# Independent Stage / Spatial Field review

## Follow-up status (2026-09-14)

1. **Sourced Stage review:** a separate read-only review of the actual GLB loader, rigid binding,
   semantic materials, atlas and resource ownership found no must-fix findings. This replaced
   the generic-body direction reviewed below; it did not certify GPU behavior or user acceptance.
2. **Late-correction review:** another independent read-only pass covered the neutral fast path,
   fused geometry filling, parity/transition tests, bounded shader wrap, raw thumbnail state and
   mounted regression, plus the reproducible GPU check and refusal tests. **No must-fix findings.**
   It ran no tests, benchmarks, browsers, servers or external apps and edited no files.
3. **Parent verification:** actual GPU readback, guarded UI captures and paired measurements are
   recorded in [the implementation report](2026-09-14-stage-spatial-implementation.md). Local
   verification is complete; ordinary CI is tracked on [PR #218](https://github.com/twadams21/LEDrums/pull/218).
   Neither reviews nor readback establishes Live/Max,
   packaged desktop, physical latency, optical calibration or user visual acceptance.

## Historical initial review — before the Blender correction

The remainder preserves the first review's observations and line references. Its generic-body /
spill implementation and then-outstanding statuses **do not describe the final sourced Stage**.

**Next at that point: parent-owned headless UI verification and integration gates. No must-fix source defects identified in the reviewed scope.** This is not visual, GPU-performance, hardware, or merge-readiness certification.

## Scope and method

Reviewed the current working tree against `efbf269230ba23c77e1adbc243b059c0b59835e4`; HEAD equals that base, so the implementation is uncommitted. Included tracked diffs and untracked source/tests in:

- `packages/core/src/effects/spatial-*` and `impl/spatial-field.ts`.
- `apps/web/src/lib/visualizer/**` and `apps/web/src/lib/app/docks/Visualizer.svelte`, including its scoped test.
- The Stage styleguide entry and its registration.

Requirements came from the review request. Supporting dependency/consumer code was consulted only to resolve these files' contracts; unrelated input/server/desktop changes were not reviewed. No implementation-agent conclusions were used as evidence.

No app, browser, dev server, device, full suite, build, or benchmark was launched. Only the two narrowly filtered test commands below ran. This report is the only intentionally written file; source, `.mex`, and git state were not edited.

## Must-fix defects

**None found.** No reproducible scoped output drift, incorrect shell transform, stale-cache/hot-parameter defect, source-confirmed GPU ownership leak, or preview-to-engine dependency was established.

## Standards

No scoped source-level violations identified:

1. **Pure core and bounded ownership.** `spatial-geometry.ts:31–65` retains one immutable model revision, normalized Float64 coordinates, and one source-distance buffer. Model identity invalidates even equal-count replacements; source identity plus scalar origin values invalidate distances. There is no growing model/source map. `impl/spatial-field.ts:72–77` allocates fixed emission-capacity wave scratch per generator state.
2. **Hot inputs do not rely on object identity.** `spatial-sampling.ts:29–49` refreshes sampling values every render. `impl/spatial-field.ts:96–132` refreshes wave radius/strength, caches only physical distances, and directly samples other source drums. Reused parameter carriers therefore do not freeze authored/modulated changes.
3. **Explicit rendering-resource lifetime.** `stage-view.svelte.ts:8–24` keys construction to model/layout/quality, not frames, and cleanup closes over its own resource snapshot. `stage-resources.ts:210–220` disposes unique tracked geometry/materials once; temporary merged geometries are retired at `:82–85`. `Stage.svelte:17` and `Pixels.svelte:288` disable competing Threlte disposal, while Pixels retains its explicit owner at `Pixels.svelte:61`.
4. **UI composition.** `StagePreviewControls.svelte` composes the existing Select, SegmentedControl and IconButton primitives with project tokens, accessible names, explicit empty-state disabling and reduced-motion handling. The real reusable control is demonstrated at `SectionStagePreview.svelte:17–22`. The generated-artifact gate remains outstanding below.

## Spec

No scoped implementation blocker identified:

1. **Legacy output:** independently normalized the frozen reference's import/export changes and compared it with `git show efbf2692:packages/core/src/effects/impl/spatial-field.ts`. It matches exactly; the recorded SHA-256 also matches. The two executed parity tests compare full Float32 frames with natural and authored decay, legacy parameter edits and multiple source hits—not aggregate brightness alone.
2. **Authored complexity and voice semantics:** warp/advection/detail default to zero and skip their optional arithmetic at defaults (`spatial-sampling.ts:62–102`). Wave distance stays in physical world space before domain distortion (`impl/spatial-field.ts:118–136`). Source-read contract/voice tests cover parameter-carrier reuse, source isolation, Scope, checkpoint replay, model replacement and pooled-state retirement; those additional tests were inspected, not rerun.
3. **Actual shell geometry:** `stage-geometry.ts:47–93` reconstructs hoop planes, radius and cylinder axis from serialized positions/tangents/normals/arc lengths using the same XYZ→XZY scale conversion as Pixels. `stage-resources.ts:104–115` applies that center and axis to the shell group. The executed rotated/translated/mixed-density tests passed for no mirror, X mirror and Y mirror, including flips/reversed hoops.
4. **Diagnostic pixels and camera separation:** `Scene.svelte:40–41` keeps one common Pixels renderer outside the presentation branch. `pixel-resources.ts:5–17` reads current frame bytes without mutating them and clears missing channels. Stage's task likewise reads the current buffer each frame (`Stage.svelte:13`), rather than watching buffer identity. Camera/presentation/quality remain local dock state; the core sampling path imports none of them. Value-stable camera poses and an explicit controls update address equal-geometry churn and damping-disabled orientation (`stage-camera.ts:13–35`, `PreviewCamera.svelte:14–26`).
5. **Comparator honesty:** `spatial-field.benchmark.test.ts:16–23` explicitly distinguishes frozen-age renderer microbenchmarks from input latency/full compositor/checkpoint cost. Cold construction is separate; AB/BA ordering and matching checksums are present. No benchmark was run, and no speedup or GPU suitability is inferred. The older Mac is not treated as the live rig.

## Small nits / limitations and outstanding gates

1. **Generated styleguide still pending.** The Stage source entry exists, but `docs/design-system.html` has no diff against the base and contains no Stage-preview entry. Parent must regenerate it in the same change, as required by the styleguide README. This is an outstanding integration requirement, not a runtime defect.
2. **Real Canvas behavior remains unverified here.** `Stage.test.ts:10–25` exercises the resource-owner probe without WebGL; `Visualizer.test.ts:7–8` replaces the entire Scene. Those tests cannot establish shader compilation, actual GPU buffer deletion, initial camera appearance, browser/WebView compatibility, or visual quality. Parent's headless checks should cover cold mount, reduced motion, preset/reset, repeated Stage/Pixels and 2D/3D switching, quality changes, and model replacement. Include the minimum-height authoring dock: the new two-row controls consume real canvas space.
3. **Resize reframes the camera.** Aspect is part of the pose key (`stage-camera.ts:17`), so resizing the dock restores the selected preset rather than retaining a manual orbit. Ordinary equal-geometry frame updates do not. This is a limitation, not a violation of an explicitly requested resize contract.
4. **Approximation is real and disclosed.** Single-plane shell depth is estimated (`stage-geometry.ts:83–85`); bodies cap at 32, halos at 8,192, and spill samples at 128/drum. Sparse unsampled bright pixels can therefore produce little/no spill despite remaining visible in the diagnostic mesh. This is consistent with approximate—not calibrated—preview requirements, not proof of physical lighting fidelity or frame-budget safety.

## Executed checks

| Check | Result |
| --- | --- |
| Frozen reference normalized source comparison and SHA-256 | Exact match |
| `pnpm --filter @ledrums/core exec vitest run src/effects/spatial-field-contract.test.ts --maxWorkers=1 --minWorkers=1 -t 'keeps old defaults'` | 2 passed; 19 filtered out; 1.84 s total |
| `pnpm --filter @ledrums/web exec vitest run src/lib/visualizer/stage-geometry.test.ts --maxWorkers=1 --minWorkers=1 -t 'recovers rotated'` | 3 passed; 4 filtered out; 3.99 s total |

**Verdict:** Standards—no source-level blockers, generated-artifact gate pending. Spec—no source-confirmed blockers; real UI/rendering verification and full gates remain parent-owned.
