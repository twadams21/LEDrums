/* Patch routing compiler — a PURE, order-preserving translation between the Patch
   graph's output half (output → dataline → hoop) and core's physical-output topology
   (`OutputConfig[]`). No xyflow / Svelte / DOM here so the wiring math is trivially
   unit-testable and shares core's pure-module discipline (S2/S6 of the "Patch Graph
   authoritative" mission).

   D1: core's `OutputConfig` DROPPED the intermediate data line — an Output now carries
   its hoop chain directly as `segments` (Output = exactly one data run). This module still
   holds the graph's own 2-level model (`PatchOutput.dataLines[]`) — the current visual is
   unchanged (C1) — and TRANSLATES at the core boundary: `patchToOutputs` SPLITS each web
   data line into its own core Output (coalescing that line's hoops → `segments`, lifting the
   line's `startUniverse` per the migrator rule so DMX is byte-identical), and `outputsToPatch`
   maps each core Output back to one web output carrying a single data line. (C2 removes the
   data-line level from the graph itself; until then this split keeps the boundary honest.)

   The Patch graph authors PIXEL TRANSMIT ORDER, not universes — the controller owns
   universe/channel offsets, packing pixels channel-dense in transmit order. An optional
   per-output / per-data-line `startUniverse` snaps a run to a universe boundary (blank =
   dense/auto). `patchToOutputs` coalesces each line's hoops into ascending-contiguous
   `OutputSegment` runs (core expands each segment ascending, so non-ascending runs must not
   be merged). `outputsToPatch` expands each Output's segments back to hoops. `pixelRanges`
   derives the Inspector's first/last global pixel read-outs by sweeping the same transmit order. */

import { checkRoutingIntegrity, type KitConfig, type OutputConfig, type OutputSegment } from '@ledrums/core';

/** A single hoop on a drum, addressed by drum id + **1-based** hoop index within that drum
    (A1) — matches core `OutputSegment.hoopStart/End` and the `hoop:<drum>:N` node id. */
export type HoopRef = { drumId: string; hoop: number };

/** One data line: an ordered run of hoops cross-wired onto a single physical line. An
    optional `startUniverse` snaps it to a universe boundary (blank = dense/auto). */
export type DataLine = { id: string; startUniverse?: number; hoops: HoopRef[] };

/** One physical controller output (a PixLite port): ordered data lines + transport. An
    optional `startUniverse` snaps the port to a universe boundary (blank = dense/auto). */
export type PatchOutput = {
  id: string;
  startUniverse?: number;
  channelsPerPixel: number;
  dataLines: DataLine[];
};

/** The full output-half routing: physical outputs in transmit order. */
export type PatchRouting = { outputs: PatchOutput[] };

/** A first/last global pixel-index span (inclusive). */
export type PixelSpan = { first: number; last: number };

/** Default hoops-per-dataline used by `defaultRouting` (patch-graph.ts) when synthesizing
    a fresh routing from a kit with no authored outputs. A tidy display default, not a
    wiring constraint. */
export const DEFAULT_HOOPS_PER_DATALINE = 6;

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
 * Each web data line becomes its OWN core Output — the D1 split (`splitOutputDataLines` in
 * the kit migrator does the same to persisted data). A line's hoops coalesce into its core
 * Output's `segments`; the core Output inherits the port's `channelsPerPixel`; the run's
 * `startUniverse` is lifted per the migrator rule — the port's FIRST line inherits the port
 * `startUniverse`, later lines take only their own (so the packed byte stream is unchanged).
 * Empty data lines are SKIPPED (core `segments.min(1)`); the output order follows
 * `routing.outputs` then each output's `dataLines`.
 */
export function patchToOutputs(routing: PatchRouting): OutputConfig[] {
  const configs: OutputConfig[] = [];

  for (const output of routing.outputs) {
    output.dataLines.forEach((line, i) => {
      const segments = coalesceHoops(line.hoops);
      if (segments.length === 0) return; // empty line → emit nothing for it
      // Lift: first line inherits the port snap; later lines only their own (migrator parity).
      const startUniverse = line.startUniverse ?? (i === 0 ? output.startUniverse : undefined);
      configs.push({
        id: line.id,
        ...(startUniverse !== undefined ? { startUniverse } : {}),
        channelsPerPixel: output.channelsPerPixel,
        segments,
      });
    });
  }

  return configs;
}

/**
 * Inverse of `patchToOutputs`: expand `OutputConfig[]` back into a `PatchRouting`.
 *
 * Each core Output = one data run → one web `PatchOutput` carrying a SINGLE data line (the
 * graph still shows output + data-line nodes; C2 removes that level). The output's `segments`
 * expand back into that line's `hoops` (ascending); the run's `startUniverse` maps to the
 * PORT level (where `scalarsFor` reads it), the single line packing dense beneath it.
 */
export function outputsToPatch(outputs: OutputConfig[]): PatchRouting {
  const patchOutputs: PatchOutput[] = outputs.map((output) => ({
    id: output.id,
    ...(output.startUniverse !== undefined ? { startUniverse: output.startUniverse } : {}),
    channelsPerPixel: output.channelsPerPixel,
    // Reuse the core Output id as the single line's id so a web→core→web→core round-trip is
    // STABLE (patchToOutputs derives the core Output id FROM the line id — a synthesized
    // `${id}:dl0` would grow the id every round-trip and defeat the echo-signature guard).
    dataLines: [
      {
        id: output.id,
        hoops: output.segments.flatMap(expandSegment),
      },
    ],
  }));

  return { outputs: patchOutputs };
}

/**
 * True when `routing` would drive a single physical hoop from more than one data line —
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
 * Derive the first/last GLOBAL pixel index covered by each data line and each output,
 * sweeping the routing in transmit order (outputs → datalines → hoops) and accumulating a
 * running global pixel cursor. `pixelsForHoop` supplies each hoop's literal pixel count.
 * Feeds the Inspector's "first & last pixel" read-outs.
 *
 * NOTE the cursor is a pure transmit-order accumulator; it ignores `startUniverse` jumps
 * (those re-map universes, not pixel transmit order). Groups that carry zero pixels (empty
 * datalines / outputs) are OMITTED from the returned records rather than reported as a span.
 */
export function pixelRanges(
  routing: PatchRouting,
  pixelsForHoop: (h: HoopRef) => number,
): { byDataLine: Record<string, PixelSpan>; byOutput: Record<string, PixelSpan> } {
  const byDataLine: Record<string, PixelSpan> = {};
  const byOutput: Record<string, PixelSpan> = {};
  let cursor = 0; // next global pixel index to assign

  for (const output of routing.outputs) {
    const outputStart = cursor;
    let outputCovered = false;

    for (const dl of output.dataLines) {
      const lineStart = cursor;
      let lineCovered = false;

      for (const hoop of dl.hoops) {
        const count = pixelsForHoop(hoop);
        if (count <= 0) continue;
        cursor += count;
        lineCovered = true;
        outputCovered = true;
      }

      if (lineCovered) {
        byDataLine[dl.id] = { first: lineStart, last: cursor - 1 };
      }
    }

    if (outputCovered) {
      byOutput[output.id] = { first: outputStart, last: cursor - 1 };
    }
  }

  return { byDataLine, byOutput };
}
