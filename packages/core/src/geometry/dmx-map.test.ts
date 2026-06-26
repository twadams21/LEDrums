import { describe, expect, it } from 'vitest';
import { parseKit } from './kit-schema';
import { buildPixelModel } from './pixel-model';
import { buildDmxMap, CHANNELS_PER_UNIVERSE } from './dmx-map';

/* Dense channel packing (S6): pixels pack channel-by-channel from universe 0 ch 0,
   contiguous across the whole output→dataline→segment→hoop chain. A pixel's channels
   MAY straddle a 512-channel universe boundary; an optional `startUniverse` on an output
   or a data line snaps the cursor to that universe's channel 0. The controller owns
   universe mapping — there is no hardcoded pixel cap. */

/** Build a kit whose drums have EXACT literal pixel counts, so channel math is byte-exact. */
function kit(
  drums: Array<{ id: string; pixelsPerHoop: number; hoopCount?: number }>,
  outputs: unknown[] = [],
) {
  return parseKit({
    global: { ledDensityPxPerM: 100, hoopCount: 1, defaultHoopSpacingMm: 50 },
    drums: drums.map((d, i) => ({
      id: d.id,
      diameterIn: 6,
      hoopSpacingMm: 50,
      hoopCount: d.hoopCount ?? 1,
      pixelsPerHoop: d.pixelsPerHoop,
      origin: { x: i * 500, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    })),
    outputs,
  });
}

const seg = (drumId: string, hoopStart = 0, hoopEnd = hoopStart) => ({ drumId, hoopStart, hoopEnd });
const dl = (id: string, segments: unknown[], startUniverse?: number) =>
  startUniverse === undefined ? { id, segments } : { id, startUniverse, segments };
const out = (id: string, dataLines: unknown[], startUniverse?: number) =>
  startUniverse === undefined
    ? { id, channelsPerPixel: 3, dataLines }
    : { id, channelsPerPixel: 3, startUniverse, dataLines };

describe('buildDmxMap — dense packing', () => {
  it('derives a flat single-output map when no topology is declared', () => {
    const k = kit([{ id: 'a', pixelsPerHoop: 30 }, { id: 'b', pixelsPerHoop: 20 }]);
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    // Every pixel is patched exactly once, dense from channel 0.
    expect(map.perPixel.filter(Boolean)).toHaveLength(model.pixelCount);
    expect(map.perPixel[0]!.channel).toBe(0);
    expect(map.perPixel[1]!.channel).toBe(3);
  });

  it('packs pixels channel-dense and straddles a universe boundary', () => {
    // One data line, one drum of 196 px → 588 channels → universes 0 and 1.
    const k = kit([{ id: 'A', pixelsPerHoop: 196 }], [out('o1', [dl('a', [seg('A')])])]);
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);

    // pixel i sits at global channel 3i; no padding to fit a universe.
    expect(map.perPixel[0]!.channel).toBe(0);
    expect(map.perPixel[170]!.channel).toBe(510); // 510,511 in universe 0; 512 → universe 1
    expect(map.perPixel[195]!.channel).toBe(585);

    expect(map.universes.map((u) => u.universe)).toEqual([0, 1]);
    const [u0, u1] = map.universes;
    expect(u0!.channelCount).toBe(CHANNELS_PER_UNIVERSE); // pixel 170 fills it to the brim
    expect(u1!.channelCount).toBe(588 - 512); // 76 channels into universe 1

    // The straddling pixel appears in BOTH universes, in transmit order.
    expect(u0!.pixels[u0!.pixels.length - 1]!.id).toBe(170);
    expect(u1!.pixels[0]!.id).toBe(170);
    expect(u1!.pixels[0]!.channel).toBe(510);
  });

  it('snaps to channel 0 of an output-level startUniverse (a deliberate boundary)', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10 }], [out('o1', [dl('a', [seg('A')])], 4)]);
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    expect(map.perPixel[0]!.channel).toBe(4 * CHANNELS_PER_UNIVERSE);
    expect(map.universes.map((u) => u.universe)).toEqual([4]);
  });

  it('snaps to a data-line-level startUniverse mid-output', () => {
    // dl0 packs dense from 0; dl1 jumps to universe 7's channel 0.
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10 }, { id: 'B', pixelsPerHoop: 10 }],
      [out('o1', [dl('a', [seg('A')]), dl('b', [seg('B')], 7)])],
    );
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    const bFirst = model.drumById.get('B')!.pixelStart;
    expect(map.perPixel[0]!.channel).toBe(0);
    expect(map.perPixel[bFirst]!.channel).toBe(7 * CHANNELS_PER_UNIVERSE);
    expect(map.universes.map((u) => u.universe)).toEqual([0, 7]);
  });

  it('packs two outputs contiguously (no gap) when neither declares a startUniverse', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 196 }, { id: 'B', pixelsPerHoop: 108 }],
      [out('o1', [dl('a', [seg('A')])]), out('o2', [dl('b', [seg('B')])])],
    );
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    const bFirst = model.drumById.get('B')!.pixelStart;
    // output 2 continues exactly where output 1 ended: 196 px × 3 ch = channel 588.
    expect(map.perPixel[bFirst]!.channel).toBe(588);
    expect(map.universes.map((u) => u.universe)).toEqual([0, 1]); // 304 px × 3 = 912 ch → 2 universes
  });

  it('imposes no hardcoded per-output pixel cap', () => {
    // 2000 px on one output (well past the legacy 304 limit) must build without throwing.
    const k = kit([{ id: 'A', pixelsPerHoop: 2000 }], [out('o1', [dl('a', [seg('A')])])]);
    const model = buildPixelModel(k);
    expect(() => buildDmxMap(k, model)).not.toThrow();
  });

  it('rejects a segment referencing an unknown drum or out-of-range hoop', () => {
    const badDrum = kit([{ id: 'A', pixelsPerHoop: 10 }], [out('o1', [dl('a', [seg('zzz')])])]);
    expect(() => buildDmxMap(badDrum, buildPixelModel(badDrum))).toThrow(/unknown drum/);
    const badHoop = kit([{ id: 'A', pixelsPerHoop: 10 }], [out('o1', [dl('a', [seg('A', 0, 9)])])]);
    expect(() => buildDmxMap(badHoop, buildPixelModel(badHoop))).toThrow(/invalid hoop range/);
  });

  it('accepts a legacy output carrying bare `segments` (wraps it as one data line)', () => {
    // Pre-data-line persisted shape — must parse + build, not crash.
    const k = kit([{ id: 'A', pixelsPerHoop: 10 }], [{ id: 'o1', segments: [seg('A')] }]);
    expect(k.outputs[0]!.dataLines).toHaveLength(1);
    expect(k.outputs[0]!.dataLines[0]!.id).toBe('o1:dl0');
    const map = buildDmxMap(k, buildPixelModel(k));
    expect(map.perPixel[0]!.channel).toBe(0);
    expect(map.universes.map((u) => u.universe)).toEqual([0]);
  });
});
