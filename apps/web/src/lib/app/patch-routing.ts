/* Patch routing compiler — a PURE, order-preserving translation between the Patch
   graph's output half (Output → Hoop → Hoop … physical data run) and core's
   physical-output topology (`OutputConfig[]`). No xyflow / Svelte / DOM here so the
   wiring math is trivially unit-testable and shares core's pure-module discipline
   (S2/S6 of the "Patch Graph authoritative" mission).

   D1: core's `OutputConfig` is now FLAT — an Output carries its hoop chain directly as
   range-compressed `segments` (Output = exactly one data run). The web layer mirrors
   that 1:1: a `PatchOutput` carries its `hoops` list directly (no intermediate Data
   Line). `patchToOutputs` coalesces each output's hoops → `segments`; `outputsToPatch`
   expands each Output's segments back into its hoops — a straight, level-for-level map.

   The Patch graph authors PIXEL TRANSMIT ORDER, not universes — the controller owns
   universe/channel offsets, packing pixels channel-dense in transmit order. An optional
   per-output `startUniverse` snaps a run to a universe boundary (blank = dense/auto).
   `patchToOutputs` coalesces each output's hoops into ascending-contiguous
   `OutputSegment` runs (core expands each segment ascending, so non-ascending runs must
   not be merged). `outputsToPatch` expands each Output's segments back to hoops.
   `pixelRanges` derives the Inspector's first/last global pixel read-outs by sweeping the
   same transmit order. */

import { checkRoutingIntegrity, type HoopRef, type KitConfig, type OutputConfig, type OutputSegment, type RgbOrder } from '@ledrums/core';

/** A single hoop on a drum, addressed by drum id + **1-based** hoop index within that drum
    (A1) — matches core `OutputSegment.hoopStart/End`, core's own `HoopRef`, and the
    `hoop:<drum>:N` node id. Re-exported from core so the web bridge and the core wiring
    rules share ONE definition. */
export type { HoopRef };

/** One physical controller output = **exactly one data run** (D1: the intermediate Data
    Line was removed). An ordered `hoops` chain + transport. An optional `startUniverse`
    snaps the run to a universe boundary (blank = dense/auto); `rgbOrder` is the per-output
    strip wiring order (blank = the packer's default). */
export type PatchOutput = {
  id: string;
  startUniverse?: number;
  channelsPerPixel: number;
  rgbOrder?: RgbOrder;
  hoops: HoopRef[];
};

/** The full output-half routing: physical outputs in transmit order. */
export type PatchRouting = { outputs: PatchOutput[] };

/** A first/last global pixel-index span (inclusive). */
export type PixelSpan = { first: number; last: number };

/** Default hoops-per-output used by `defaultRouting` (patch-graph.ts) when synthesizing a
    fresh routing from a kit with no authored outputs. A tidy display default, not a wiring
    constraint. */
export const DEFAULT_HOOPS_PER_OUTPUT = 6;

/** Coalesce an ordered hoop list into `OutputSegment` runs: a run extends while the next
    hoop is the SAME drum and exactly one greater than the previous (ascending-contiguous).
    Any break — a different drum, a backwards/duplicate hoop, or a gap — starts a new
    segment, so the segments are a faithful, canonical encoding of transmit order. */
function coalesceHoops(hoops: HoopRef[]): OutputSegment[] {
  const segments: OutputSegment[] = [];
  let current: OutputSegment | null = null;
  for (const { drumId, hoop } of hoops) {
    if (current !== null && current.drumId === drumId && hoop === current.hoopEnd + 1) {
      current.hoopEnd = hoop; // extend the ascending-contiguous run
    } else {
      current = { drumId, hoopStart: hoop, hoopEnd: hoop };
      segments.push(current);
    }
  }
  return segments;
}

/** Expand an `OutputSegment` back into its `hoopStart..hoopEnd` (ascending) hoops. */
function expandSegment(seg: OutputSegment): HoopRef[] {
  const hoops: HoopRef[] = [];
  for (let h = seg.hoopStart; h <= seg.hoopEnd; h++) hoops.push({ drumId: seg.drumId, hoop: h });
  return hoops;
}

/**
 * Compile a `PatchRouting` into core's `OutputConfig[]` (D1: Output = one data run).
 *
 * Each web `PatchOutput` maps directly to ONE core Output: its hoops coalesce into that
 * Output's `segments`, and it carries its own transport (`startUniverse`, `channelsPerPixel`,
 * `rgbOrder`). An output with NO hoops coalesces to zero segments and is PRESERVED as an empty
 * (unwired) port — outputs are a fixed port set (4 normal / 8 expanded), so the count must survive
 * a rewire round-trip unchanged; dropping unwired ports here would re-introduce the very drift
 * reconcileOutputs exists to kill. Output order follows `routing.outputs`.
 */
export function patchToOutputs(routing: PatchRouting): OutputConfig[] {
  return routing.outputs.map((output) => ({
    id: output.id,
    ...(output.startUniverse !== undefined ? { startUniverse: output.startUniverse } : {}),
    channelsPerPixel: output.channelsPerPixel,
    ...(output.rgbOrder !== undefined ? { rgbOrder: output.rgbOrder } : {}),
    segments: coalesceHoops(output.hoops),
  }));
}

/**
 * Inverse of `patchToOutputs`: expand `OutputConfig[]` back into a `PatchRouting`.
 *
 * Each core Output = one data run → one web `PatchOutput` (1:1). The output's `segments`
 * expand back into its `hoops` (ascending); its transport (`startUniverse`, `channelsPerPixel`,
 * `rgbOrder`) carries straight across. The core Output id is reused so a web→core→web round-trip
 * is STABLE (the echo-signature guard compares canonical forms).
 */
export function outputsToPatch(outputs: OutputConfig[]): PatchRouting {
  const patchOutputs: PatchOutput[] = outputs.map((output) => ({
    id: output.id,
    ...(output.startUniverse !== undefined ? { startUniverse: output.startUniverse } : {}),
    channelsPerPixel: output.channelsPerPixel,
    ...(output.rgbOrder !== undefined ? { rgbOrder: output.rgbOrder } : {}),
    hoops: output.segments.flatMap(expandSegment),
  }));

  return { outputs: patchOutputs };
}

/**
 * True when `routing` would drive a single physical hoop from more than one OUTPUT —
 * the "fan-out" corruption (that hoop's pixels get silently overwritten, last write wins).
 *
 * This does NOT restate the rule: it compiles the routing to core's `OutputConfig[]` and
 * asks S07's ONE definition ({@link checkRoutingIntegrity}'s `hoop-fan-out` class), the
 * same predicate the server write-gate enforces. Two enforcement points (this editor's
 * connect-time guard + the server backstop), one rule. Other issue classes (unknown-drum,
 * out-of-range) are ignored here — the editor's hoops are always real kit hoops; only the
 * fan-out is reachable by a connect gesture.
 */
export function hasHoopFanOut(kit: KitConfig, routing: PatchRouting): boolean {
  return checkRoutingIntegrity(kit, patchToOutputs(routing)).some((i) => i.code === 'hoop-fan-out');
}

/**
 * Derive the first/last GLOBAL pixel index covered by each output, sweeping the routing in
 * transmit order (outputs → hoops) and accumulating a running global pixel cursor.
 * `pixelsForHoop` supplies each hoop's literal pixel count. Feeds the Inspector's "first &
 * last pixel" read-outs.
 *
 * NOTE the cursor is a pure transmit-order accumulator; it ignores `startUniverse` jumps
 * (those re-map universes, not pixel transmit order). Outputs that carry zero pixels are
 * OMITTED from the returned record rather than reported as a span.
 */
export function pixelRanges(
  routing: PatchRouting,
  pixelsForHoop: (h: HoopRef) => number,
): { byOutput: Record<string, PixelSpan> } {
  const byOutput: Record<string, PixelSpan> = {};
  let cursor = 0; // next global pixel index to assign

  for (const output of routing.outputs) {
    const outputStart = cursor;
    let outputCovered = false;

    for (const hoop of output.hoops) {
      const count = pixelsForHoop(hoop);
      if (count <= 0) continue;
      cursor += count;
      outputCovered = true;
    }

    if (outputCovered) {
      byOutput[output.id] = { first: outputStart, last: cursor - 1 };
    }
  }

  return { byOutput };
}
