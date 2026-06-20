import type { KitConfig } from './kit-schema';
import type { DrumInfo, PixelModel } from './pixel-model';

export interface PixelDmx {
  universe: number;
  /** Zero-based channel offset within the universe where this pixel's data starts. */
  channelStart: number;
}

export interface UniversePatch {
  universe: number;
  channelsPerPixel: number;
  /** Pixel ids carried by this universe, in transmit order. */
  pixelIds: number[];
}

export interface DmxMap {
  /** Indexed by pixel id; undefined for pixels not patched to any output. */
  perPixel: (PixelDmx | undefined)[];
  universes: UniversePatch[];
  pixelsPerUniverse: number;
}

function hoopPixelIds(drum: DrumInfo, hoop: number): number[] {
  const start = drum.pixelStart + hoop * drum.pixelsPerHoop;
  const ids: number[] = [];
  for (let i = 0; i < drum.pixelsPerHoop; i++) ids.push(start + i);
  return ids;
}

/**
 * Build the pixel → (universe, channel) map from the kit's physical-output topology
 * (plan U2/R8). The map is **output-major**: pixels are laid out in each output's
 * patch order so universes land on the physically-wired pixels — not a flat pixel
 * sweep. When the kit declares no outputs, a single flat output over all pixels is
 * derived (visualizer / loopback target).
 *
 * Throws on topology errors: unknown drum, out-of-range hoop, or an output exceeding
 * the kit's `maxPixelsPerOutput` budget.
 */
export function buildDmxMap(kit: KitConfig, model: PixelModel): DmxMap {
  const perPixel: (PixelDmx | undefined)[] = new Array(model.pixelCount).fill(undefined);
  const universes: UniversePatch[] = [];
  const maxPerOutput = kit.global.maxPixelsPerOutput;

  const outputs =
    kit.outputs.length > 0 ? kit.outputs : deriveFlatOutputs(kit, model);

  // channelsPerPixel is consistent across an output; universe capacity follows from it.
  const firstChannelsPerPixel = outputs[0]?.channelsPerPixel ?? 3;
  const pixelsPerUniverse = Math.floor(512 / firstChannelsPerPixel);

  for (const output of outputs) {
    const cpp = output.channelsPerPixel;
    const perUni = Math.floor(512 / cpp);
    let universe = output.startUniverse;
    let current: UniversePatch = { universe, channelsPerPixel: cpp, pixelIds: [] };
    let outputPixelCount = 0;

    const pushUniverse = () => {
      if (current.pixelIds.length > 0) universes.push(current);
    };

    for (const seg of output.segments) {
      const drum = model.drumById.get(seg.drumId);
      if (!drum) {
        throw new Error(
          `Output "${output.id}" references unknown drum "${seg.drumId}".`,
        );
      }
      if (seg.hoopStart < 0 || seg.hoopEnd >= drum.hoopCount || seg.hoopStart > seg.hoopEnd) {
        throw new Error(
          `Output "${output.id}" segment for "${seg.drumId}" has invalid hoop range ` +
            `${seg.hoopStart}..${seg.hoopEnd} (drum has ${drum.hoopCount} hoops).`,
        );
      }
      for (let h = seg.hoopStart; h <= seg.hoopEnd; h++) {
        for (const pid of hoopPixelIds(drum, h)) {
          if (current.pixelIds.length >= perUni) {
            pushUniverse();
            universe++;
            current = { universe, channelsPerPixel: cpp, pixelIds: [] };
          }
          perPixel[pid] = {
            universe: current.universe,
            channelStart: current.pixelIds.length * cpp,
          };
          current.pixelIds.push(pid);
          outputPixelCount++;
        }
      }
    }
    pushUniverse();

    if (outputPixelCount > maxPerOutput) {
      throw new Error(
        `Output "${output.id}" carries ${outputPixelCount} pixels, exceeding the ` +
          `${maxPerOutput}px-per-output limit.`,
      );
    }
  }

  return { perPixel, universes, pixelsPerUniverse };
}

/** Derive a single flat output covering every pixel, in pixel-id order. */
function deriveFlatOutputs(kit: KitConfig, model: PixelModel) {
  return [
    {
      id: 'flat',
      startUniverse: 0,
      channelsPerPixel: 3,
      segments: model.drums.map((d) => ({
        drumId: d.drumId,
        hoopStart: 0,
        hoopEnd: d.hoopCount - 1,
      })),
    },
  ];
}
