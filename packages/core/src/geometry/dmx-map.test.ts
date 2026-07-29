import { describe, expect, it } from 'vitest';
import { parseKit } from './kit-schema';
import { buildPixelModel } from './pixel-model';
import { buildDmxMap, CHANNELS_PER_UNIVERSE } from './dmx-map';

/* Dense channel packing (S6, D1): pixels pack channel-by-channel from universe 0 ch 0,
   contiguous across the whole output→segment→hoop chain (D1 removed the intermediate data
   line — an output carries its segments directly). A pixel's channels MAY straddle a
   512-channel universe boundary; an optional `startUniverse` on an output snaps the cursor
   to that universe's channel 0. The controller owns universe mapping — no hardcoded pixel cap. */

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

// Hoop indices are 1-based (A1); fixtures are authored that way directly, since the v1→2
// shift died with the v7 floor.
const seg = (drumId: string, hoopStart = 1, hoopEnd = hoopStart) => ({ drumId, hoopStart, hoopEnd });
// D1: an output carries its `segments` directly (no data-line wrapper).
const out = (id: string, segments: unknown[], startUniverse?: number) =>
  startUniverse === undefined
    ? { id, channelsPerPixel: 3, segments }
    : { id, channelsPerPixel: 3, startUniverse, segments };

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

  it('derives the flat map when the port set exists but is entirely UNWIRED (all empty segments)', () => {
    // #112: outputs are now a fixed 4/8 port set seeded empty; an unwired rig (every port has no
    // segments) must still light via the flat fallback, exactly as an empty `outputs: []` array did —
    // otherwise reconciling []→N empty ports would silently dark the rig.
    const k = kit(
      [{ id: 'a', pixelsPerHoop: 30 }, { id: 'b', pixelsPerHoop: 20 }],
      [out('o1', []), out('o2', []), out('o3', []), out('o4', [])],
    );
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    expect(map.perPixel.filter(Boolean)).toHaveLength(model.pixelCount);
    expect(map.perPixel[0]!.channel).toBe(0);
    expect(map.perPixel[1]!.channel).toBe(3);
  });

  it('uses the authored ports (empty ones inert) once ANY port is wired — no flat fallback', () => {
    // A partially-wired set routes only the wired port; the empty ports contribute nothing (they do
    // NOT re-trigger the light-everything fallback).
    const k = kit([{ id: 'A', pixelsPerHoop: 10 }, { id: 'B', pixelsPerHoop: 10 }], [out('o1', [seg('A')]), out('o2', [])]);
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    // Only drum A's 10 pixels are patched; drum B (on no wired port) is dark.
    expect(map.perPixel.filter(Boolean)).toHaveLength(10);
  });

  it('packs pixels channel-dense and straddles a universe boundary', () => {
    // One output run, one drum of 196 px → 588 channels → universes 0 and 1.
    const k = kit([{ id: 'A', pixelsPerHoop: 196 }], [out('o1', [seg('A')])]);
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
    const k = kit([{ id: 'A', pixelsPerHoop: 10 }], [out('o1', [seg('A')], 4)]);
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    expect(map.perPixel[0]!.channel).toBe(4 * CHANNELS_PER_UNIVERSE);
    expect(map.universes.map((u) => u.universe)).toEqual([4]);
  });

  it('snaps a later output to its startUniverse (a mid-chain boundary)', () => {
    // o1 packs dense from 0; o2 jumps to universe 7's channel 0 (D1: what a per-data-line
    // startUniverse used to express is now a per-output run boundary).
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10 }, { id: 'B', pixelsPerHoop: 10 }],
      [out('o1', [seg('A')]), out('o2', [seg('B')], 7)],
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
      [out('o1', [seg('A')]), out('o2', [seg('B')])],
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
    const k = kit([{ id: 'A', pixelsPerHoop: 2000 }], [out('o1', [seg('A')])]);
    const model = buildPixelModel(k);
    expect(() => buildDmxMap(k, model)).not.toThrow();
  });

  it('rejects a segment referencing an unknown drum or out-of-range hoop', () => {
    const badDrum = kit([{ id: 'A', pixelsPerHoop: 10 }], [out('o1', [seg('zzz')])]);
    expect(() => buildDmxMap(badDrum, buildPixelModel(badDrum))).toThrow(/unknown drum/);
    const badHoop = kit([{ id: 'A', pixelsPerHoop: 10 }], [out('o1', [seg('A', 1, 10)])]);
    expect(() => buildDmxMap(badHoop, buildPixelModel(badHoop))).toThrow(/invalid hoop range/);
  });

  it('absorbs a stray pre-D1 `dataLines` output instead of crashing (defence in depth)', () => {
    // The v6→7 SPLIT died with the v7 floor: a genuine v<7 file is now rejected before parse, so
    // the only way this shape arrives is a payload CLAIMING v7 — hand-edited or corrupt. The
    // schema preprocess concatenates its lines into the one output rather than throwing; it is a
    // crash guard, not a fidelity guarantee (a real v6 file would have split into one per line).
    const k = kit([{ id: 'A', pixelsPerHoop: 10 }], [
      { id: 'o1', channelsPerPixel: 3, dataLines: [{ id: 'o1:dl0', segments: [seg('A')] }] },
    ]);
    expect(k.outputs).toHaveLength(1);
    expect(k.outputs[0]!.segments).toHaveLength(1);
    expect(k.outputs[0]!.id).toBe('o1');
    const map = buildDmxMap(k, buildPixelModel(k));
    expect(map.perPixel[0]!.channel).toBe(0);
    expect(map.universes.map((u) => u.universe)).toEqual([0]);
  });
});

describe('buildDmxMap — protocol-aware universe numbering (Decision 7)', () => {
  it('defaults to Art-Net numbering: explicit artnet is deep-equal to the historical default', () => {
    const k = kit([{ id: 'a', pixelsPerHoop: 200 }, { id: 'b', pixelsPerHoop: 200 }]);
    const model = buildPixelModel(k);
    expect(buildDmxMap(k, model, undefined, 'artnet')).toEqual(buildDmxMap(k, model));
  });

  it('sACN packs from universe 1 — universe 0 never appears', () => {
    const k = kit([{ id: 'a', pixelsPerHoop: 200 }, { id: 'b', pixelsPerHoop: 200 }]);
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model, undefined, 'sacn');
    expect(map.universes.every((u) => u.universe >= 1)).toBe(true);
    expect(map.universes[0]!.universe).toBe(1);
    expect(map.perPixel[0]!.channel).toBe(CHANNELS_PER_UNIVERSE); // universe 1, channel 0
  });

  it('a sACN map is the Art-Net map shifted by exactly one universe, byte-structure intact', () => {
    // 400 px * 3ch = 1200 channels -> straddles universes; the shift must preserve every
    // per-universe channelCount and per-pixel offset WITHIN its universe.
    const k = kit([{ id: 'a', pixelsPerHoop: 200 }, { id: 'b', pixelsPerHoop: 200 }]);
    const model = buildPixelModel(k);
    const art = buildDmxMap(k, model);
    const sacn = buildDmxMap(k, model, undefined, 'sacn');
    expect(sacn.universes.map((u) => u.universe)).toEqual(art.universes.map((u) => u.universe + 1));
    expect(sacn.universes.map((u) => u.channelCount)).toEqual(art.universes.map((u) => u.channelCount));
    for (let p = 0; p < model.pixelCount; p++) {
      expect(sacn.perPixel[p]!.channel).toBe(art.perPixel[p]!.channel + CHANNELS_PER_UNIVERSE);
    }
  });

  it('an authored startUniverse stays ABSOLUTE under sACN (operator compensation survives)', () => {
    const k = kit([{ id: 'a', pixelsPerHoop: 10 }], [out('o1', [seg('a', 1)], 5)]);
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model, undefined, 'sacn');
    expect(map.universes.map((u) => u.universe)).toEqual([5]);
  });

  it('the flat (unwired) fallback is also protocol-aware', () => {
    const k = kit([{ id: 'a', pixelsPerHoop: 30 }]);
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model, undefined, 'sacn');
    expect(map.universes.map((u) => u.universe)).toEqual([1]);
  });
});
