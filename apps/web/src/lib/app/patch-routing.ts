/* Patch routing compiler — a PURE, order-preserving translation between the Patch
   graph's output half (output → dataline → hoop) and core's physical-output
   topology (`OutputConfig[]`). No xyflow / Svelte / DOM here so the wiring math is
   trivially unit-testable and shares core's pure-module discipline (S2 of the
   "Patch Graph authoritative" mission).

   The Patch graph authors PIXEL TRANSMIT ORDER, not universes — the controller
   owns universe/channel offsets. Transmit order is: first hoop on the first
   dataline on the first output → next hoop on that dataline → next dataline →
   next output. That is exactly how core's `buildDmxMap` walks `OutputConfig`:
   outputs in order, segments in order, each segment expanded `hoopStart..hoopEnd`
   ASCENDING. So the only thing that must round-trip is the flattened hoop order
   per output — dataline boundaries are free to re-chunk.

   `patchToOutputs` flattens datalines (preserving order) and coalesces only
   same-drum, consecutive-ascending hoops into `OutputSegment` runs, so the
   segments core expands reproduce the authored order bit-for-bit. The inverse,
   `outputsToPatch`, expands segments back to hoops and re-chunks into datalines.
   `pixelRanges` derives the Inspector's first/last global pixel read-outs by
   sweeping the same transmit order. */

import type { OutputConfig, OutputSegment } from '@ledrums/core';

/** A single hoop on a drum, addressed by drum id + hoop index within that drum. */
export type HoopRef = { drumId: string; hoop: number };

/** One data line: an ordered run of hoops cross-wired onto a single physical line. */
export type DataLine = { id: string; hoops: HoopRef[] };

/** One physical controller output (a PixLite port): ordered data lines + transport. */
export type PatchOutput = {
  id: string;
  startUniverse: number;
  channelsPerPixel: number;
  dataLines: DataLine[];
};

/** The full output-half routing: physical outputs in transmit order. */
export type PatchRouting = { outputs: PatchOutput[] };

/** A first/last global pixel-index span (inclusive). */
export type PixelSpan = { first: number; last: number };

/** Default hoops-per-dataline used when re-chunking in `outputsToPatch`. Dataline
    boundaries are cosmetic for transmit order, so this is a tidy display default,
    not a wiring constraint. */
export const DEFAULT_HOOPS_PER_DATALINE = 6;

/** Flatten an output's data lines into one ordered hoop list (order preserved). */
function flattenHoops(output: PatchOutput): HoopRef[] {
  return output.dataLines.flatMap((dl) => dl.hoops);
}

/**
 * Compile a `PatchRouting` into core's `OutputConfig[]`.
 *
 * Each output's data lines are flattened in order into a single hoop stream, then
 * coalesced into `OutputSegment` runs: a run extends while the next hoop is the
 * SAME drum and exactly one greater than the previous hoop (ascending-contiguous).
 * Any break — a different drum, a backwards/duplicate hoop, or a gap — starts a new
 * segment. This keeps the segments a faithful, canonical encoding of transmit order
 * (core expands each segment ascending, so non-ascending runs must not be merged).
 *
 * Outputs that carry no hoops are SKIPPED (no `OutputConfig` is emitted for them) —
 * core's `outputSchema` requires `segments.min(1)`, and an empty port transmits
 * nothing. The order of the emitted configs follows `routing.outputs`.
 */
export function patchToOutputs(routing: PatchRouting): OutputConfig[] {
  const configs: OutputConfig[] = [];

  for (const output of routing.outputs) {
    const hoops = flattenHoops(output);
    if (hoops.length === 0) continue; // empty port → emit nothing

    const segments: OutputSegment[] = [];
    let current: OutputSegment | null = null;

    for (const { drumId, hoop } of hoops) {
      if (
        current !== null &&
        current.drumId === drumId &&
        hoop === current.hoopEnd + 1
      ) {
        current.hoopEnd = hoop; // extend the ascending-contiguous run
      } else {
        current = { drumId, hoopStart: hoop, hoopEnd: hoop };
        segments.push(current);
      }
    }

    configs.push({
      id: output.id,
      startUniverse: output.startUniverse,
      channelsPerPixel: output.channelsPerPixel,
      segments,
    });
  }

  return configs;
}

/**
 * Inverse of `patchToOutputs`: expand `OutputConfig[]` back into a `PatchRouting`.
 *
 * Each segment expands to its `hoopStart..hoopEnd` (ascending) hoops; the per-output
 * hoop stream is then re-chunked into data lines of `hoopsPerDataLine` hoops each
 * (default {@link DEFAULT_HOOPS_PER_DATALINE}). Dataline boundaries deliberately need
 * NOT match the original routing — only pixel/transmit order round-trips. Data line
 * ids are derived as `${output.id}:dl${n}` so they are stable for a given output.
 */
export function outputsToPatch(
  outputs: OutputConfig[],
  opts?: { hoopsPerDataLine?: number },
): PatchRouting {
  const size =
    opts?.hoopsPerDataLine && opts.hoopsPerDataLine > 0
      ? Math.floor(opts.hoopsPerDataLine)
      : DEFAULT_HOOPS_PER_DATALINE;

  const patchOutputs: PatchOutput[] = outputs.map((output) => {
    const hoops: HoopRef[] = [];
    for (const seg of output.segments) {
      for (let h = seg.hoopStart; h <= seg.hoopEnd; h++) {
        hoops.push({ drumId: seg.drumId, hoop: h });
      }
    }

    const dataLines: DataLine[] = [];
    for (let i = 0; i < hoops.length; i += size) {
      dataLines.push({
        id: `${output.id}:dl${dataLines.length}`,
        hoops: hoops.slice(i, i + size),
      });
    }

    return {
      id: output.id,
      startUniverse: output.startUniverse,
      channelsPerPixel: output.channelsPerPixel,
      dataLines,
    };
  });

  return { outputs: patchOutputs };
}

/**
 * Derive the first/last GLOBAL pixel index covered by each data line and each
 * output, sweeping the routing in transmit order (outputs → datalines → hoops) and
 * accumulating a running global pixel cursor. `pixelsForHoop` supplies each hoop's
 * literal pixel count. Feeds the Inspector's "first & last pixel" read-outs.
 *
 * Groups that carry zero pixels (empty datalines / outputs) are OMITTED from the
 * returned records rather than reported as a sentinel span.
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
