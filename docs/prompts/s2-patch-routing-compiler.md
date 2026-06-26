# S2 — Pure compiler: PatchRouting ⇄ OutputConfig[]

Part of the **Patch Graph authoritative** mission (`docs/prompts/patch-graph-authoritative.md`, read it for the model). Branch `feat/unified-shell`.

## Why
The Patch graph's output half (`hoop → dataline → output → controller`) authors **pixel transmit order**. We need a pure, unit-tested translation between a neutral routing structure and core's `OutputConfig[]` (`packages/core/src/geometry/kit-schema.ts` → `segments[]`, an ordered run of hoop ranges per physical output). The later web slice (S3) maps the xyflow wiring to/from this neutral structure — keep this module **free of any xyflow / Svelte / DOM dependency** so it is trivially testable and core-pure-compatible.

## Scope (disjoint file set — yours alone; both NEW)
- `apps/web/src/lib/app/patch-routing.ts` (new pure module)
- `apps/web/src/lib/app/patch-routing.test.ts` (new, node/vitest)
- You may import **types only** from `@ledrums/core` (`OutputConfig`, `OutputSegment`). Do not import anything web/DOM.

## The contract (define these types in the module)
```ts
export type HoopRef = { drumId: string; hoop: number };          // hoop index within the drum
export type DataLine = { id: string; hoops: HoopRef[] };          // ordered hoops on one data line
export type PatchOutput = {                                       // one physical controller output (PixLite port)
  id: string; startUniverse: number; channelsPerPixel: number; dataLines: DataLine[];
};
export type PatchRouting = { outputs: PatchOutput[] };            // ordered outputs
```

## Functions
1. `patchToOutputs(routing: PatchRouting): OutputConfig[]`
   - For each `PatchOutput`, flatten its `dataLines` in order → a flat ordered list of `HoopRef`. Datalines flatten away but their **order is preserved**.
   - Coalesce **contiguous hoops of the same drum** into `OutputSegment { drumId, hoopStart, hoopEnd }` runs (inclusive). A break to a different drum (or non-contiguous hoop) starts a new segment.
   - Emit `OutputConfig { id, startUniverse, channelsPerPixel, segments }`. Skip outputs with no hoops (or emit none — document the choice).

2. `outputsToPatch(outputs: OutputConfig[], opts?: { hoopsPerDataLine?: number }): PatchRouting`
   - Inverse. Expand each `OutputSegment` back into `HoopRef[]` (hoopStart..hoopEnd). Re-chunk into datalines by `hoopsPerDataLine` (default a sensible constant, e.g. 6) — **dataline boundaries need not match the original**; only pixel order must round-trip.

3. `pixelRanges(routing: PatchRouting, pixelsForHoop: (h: HoopRef) => number): { byDataLine: Record<string,{first:number,last:number}>; byOutput: Record<string,{first:number,last:number}> }`
   - Walk outputs→datalines→hoops in transmit order, accumulating a running global pixel index. For each dataline and each output, record the **first and last global pixel index** it covers. This feeds the Inspector read-outs ("universe / first & last pixel"). Empty groups → omit or `{first:-1,last:-1}` (document).

## Acceptance / tests
- `pnpm --filter @ledrums/web typecheck` clean; `pnpm --filter @ledrums/web test` passes the new file.
- **Round-trip property**: for representative routings, `patchToOutputs` then `outputsToPatch` then `patchToOutputs` yields **identical `OutputConfig[]`** (pixel order stable; segment coalescing canonical). Test contiguous-coalescing, drum-boundary splits, multi-output ordering, and an empty output.
- `pixelRanges` correctness on a hand-computed example (e.g. drum A hoops 0..1 @ 50px, then drum B hoop 0 @ 30px → ranges 0..49, 50..99, 100..129).

## Don't
- No xyflow/Svelte/DOM imports. No reading the store. No engine calls. Pure functions only. Don't merge to main.

## Report back
Report to parent (`twux send-message --session parent`) with: commit SHA, the exported API, test output, and any contract tweaks you made (so S3 consumes the real shape). **Commit on `feat/unified-shell`** before reporting.
