import type { KitConfig, OutputConfig, RgbOrder } from './kit-schema';
import { drumHoopPixelRange, type DrumInfo, type PixelModel } from './pixel-model';

/** Where a pixel's channels land in the global, DENSE DMX stream. A pixel occupies
 *  `channelsPerPixel` consecutive global channels starting at {@link channel}; those
 *  channels MAY straddle a 512-channel universe boundary. universe = floor(channel / 512). */
export interface PixelDmx {
  /** Global channel index of this pixel's first channel. */
  channel: number;
}

/** One pixel's contribution to a universe: its id, its GLOBAL first channel, its
 *  channels-per-pixel, and its owning output's RGB wiring order — all carried per-pixel so a
 *  universe spanning two outputs of different `channelsPerPixel` OR different `rgbOrder` (B5)
 *  is still byte-exact. `rgbOrder` is `undefined` when the owning output declared none; the
 *  packer then falls back to a default (see {@link frameToUniverseBytes}). */
export interface UniversePixel {
  id: number;
  /** Global channel index of this pixel's first channel (universe = floor/512). */
  channel: number;
  channelsPerPixel: number;
  /** Wiring RGB order of the output that carries this pixel (B5); undefined → packer default. */
  rgbOrder?: RgbOrder;
}

/** One active DMX universe. Pixels are in transmit order; a pixel whose channels
 *  straddle this universe's top boundary appears in BOTH this universe and the next. */
export interface UniversePatch {
  universe: number;
  /** Channels used in this universe (1..512) — the byte length to emit for it. */
  channelCount: number;
  /** Pixels contributing ≥1 channel to this universe, in transmit order. */
  pixels: UniversePixel[];
}

export interface DmxMap {
  /** Indexed by pixel id; undefined for pixels not patched to any output. */
  perPixel: (PixelDmx | undefined)[];
  /** Active universes, ascending. */
  universes: UniversePatch[];
}

/** Channels in a single DMX universe. */
export const CHANNELS_PER_UNIVERSE = 512;

/** Global pixel ids for one hoop, in id order. `hoop` is **1-based** (A1). Uses the model's
 *  prefix-sum hoop range so mixed per-hoop counts (B4) pack correctly, not just uniform drums. */
function hoopPixelIds(drum: DrumInfo, hoop: number): number[] {
  const range = drumHoopPixelRange(drum, hoop);
  if (!range) return [];
  const ids: number[] = [];
  for (let pid = range.start; pid < range.end; pid++) ids.push(pid);
  return ids;
}

/**
 * Build the pixel → global-channel map from the kit's physical-output topology
 * (the PixLite chain). The chain is walked in transmit order —
 * **outputs → segments → hoops → pixelIds** (each output = one data run; each segment
 * expanded `hoopStart..hoopEnd` ASCENDING) — and pixels are packed CHANNEL-DENSE from a
 * single global cursor: pixel *i* occupies global channels `[cursor, cursor + cpp)`, then the
 * cursor advances by `cpp`. A pixel's channels MAY straddle a 512-channel universe
 * boundary (the controller owns universe mapping; the app only authors order + density).
 *
 * Optional universe jumps: when an output declares a `startUniverse`, the cursor snaps to that
 * universe's channel 0 on entry (a deliberate boundary/gap). Absent → the cursor stays
 * dense/contiguous (output 1 → output 2 …, no reset). The base starts at universe 0, channel 0.
 * There is NO hardcoded pixel cap — the controller enforces its own; `maxPixelsPerOutput` is
 * advisory only.
 *
 * When the kit declares no outputs, a single flat output over all pixels is derived
 * (visualizer / loopback target).
 *
 * Throws on topology errors: an unknown drum or an out-of-range hoop.
 */
export function buildDmxMap(kit: KitConfig, model: PixelModel): DmxMap {
  const perPixel: (PixelDmx | undefined)[] = new Array(model.pixelCount).fill(undefined);
  const outputs = kit.outputs.length > 0 ? kit.outputs : deriveFlatOutputs(model);

  // Universe number → its patch, built lazily as pixels land in each.
  const byUniverse = new Map<number, UniversePatch>();
  const universeFor = (u: number): UniversePatch => {
    let patch = byUniverse.get(u);
    if (!patch) {
      patch = { universe: u, channelCount: 0, pixels: [] };
      byUniverse.set(u, patch);
    }
    return patch;
  };

  let cursor = 0; // next global channel to assign
  for (const output of outputs) {
    const cpp = output.channelsPerPixel;
    if (output.startUniverse !== undefined) cursor = output.startUniverse * CHANNELS_PER_UNIVERSE;

    for (const seg of output.segments) {
      const drum = model.drumById.get(seg.drumId);
      if (!drum) {
        throw new Error(`Output "${output.id}" references unknown drum "${seg.drumId}".`);
      }
      if (seg.hoopStart < 1 || seg.hoopEnd > drum.hoopCount || seg.hoopStart > seg.hoopEnd) {
        throw new Error(
          `Output "${output.id}" segment for "${seg.drumId}" has invalid hoop range ` +
            `${seg.hoopStart}..${seg.hoopEnd} (drum has ${drum.hoopCount} hoops).`,
        );
      }
      for (let h = seg.hoopStart; h <= seg.hoopEnd; h++) {
        for (const pid of hoopPixelIds(drum, h)) {
          const start = cursor;
          perPixel[pid] = { channel: start };
          // Register the pixel into every universe its `cpp` channels touch (straddle).
          const firstU = Math.floor(start / CHANNELS_PER_UNIVERSE);
          const lastU = Math.floor((start + cpp - 1) / CHANNELS_PER_UNIVERSE);
          for (let u = firstU; u <= lastU; u++) {
            const patch = universeFor(u);
            patch.pixels.push({ id: pid, channel: start, channelsPerPixel: cpp, rgbOrder: output.rgbOrder });
            // Channels this pixel uses within universe u, clipped to its [0,512) window.
            const localEnd = Math.min(CHANNELS_PER_UNIVERSE, start + cpp - u * CHANNELS_PER_UNIVERSE);
            if (localEnd > patch.channelCount) patch.channelCount = localEnd;
          }
          cursor += cpp;
        }
      }
    }
  }

  const universes = [...byUniverse.values()].sort((a, b) => a.universe - b.universe);
  return { perPixel, universes };
}

/** Derive a single flat output (one data run) covering every pixel, in pixel-id order —
 *  dense from universe 0. */
function deriveFlatOutputs(model: PixelModel): OutputConfig[] {
  return [
    {
      id: 'flat',
      channelsPerPixel: 3,
      segments: model.drums.map((d) => ({
        drumId: d.drumId,
        hoopStart: 1,
        hoopEnd: d.hoopCount,
      })),
    },
  ];
}
