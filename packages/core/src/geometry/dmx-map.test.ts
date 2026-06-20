import { describe, expect, it } from 'vitest';
import { parseKit } from './kit-schema';
import { buildPixelModel } from './pixel-model';
import { buildDmxMap } from './dmx-map';

// A drum sized so a hoop has a known small pixel count for assertions.
// diameter 6" -> circumference ~0.479 m, at 100 px/m -> ~48 px/hoop.
function kit(outputs: unknown[] = [], global: Record<string, unknown> = {}) {
  return parseKit({
    global: { ledDensityPxPerM: 100, hoopCount: 2, defaultHoopSpacingMm: 50, ...global },
    drums: [
      { id: 'a', diameterIn: 6, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      { id: 'b', diameterIn: 6, hoopSpacingMm: 50, origin: { x: 500, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ],
    outputs,
  });
}

describe('buildDmxMap', () => {
  it('derives a flat single-output map when no topology is declared', () => {
    const k = kit([], { maxPixelsPerOutput: 100000 });
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    // Every pixel is patched exactly once.
    expect(map.perPixel.filter(Boolean)).toHaveLength(model.pixelCount);
  });

  it('lays out pixels in output patch order, rolling to the next universe at capacity', () => {
    const k = kit(
      [{ id: 'o1', startUniverse: 0, channelsPerPixel: 3, segments: [{ drumId: 'a', hoopStart: 0, hoopEnd: 1 }] }],
      { maxPixelsPerOutput: 100000 },
    );
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    expect(map.pixelsPerUniverse).toBe(170);
    // channelStart is monotonic within a universe, resetting to 0 on roll-over.
    const drumA = model.drumById.get('a')!;
    for (let i = 0; i < drumA.pixelCount; i++) {
      const dmx = map.perPixel[drumA.pixelStart + i]!;
      expect(dmx.channelStart).toBeLessThanOrEqual(509);
      const expectedUniverse = Math.floor(i / 170);
      expect(dmx.universe).toBe(expectedUniverse);
      expect(dmx.channelStart).toBe((i % 170) * 3);
    }
  });

  it('keeps each output on its own universe range (output b after output a)', () => {
    const k = kit(
      [
        { id: 'o1', startUniverse: 0, channelsPerPixel: 3, segments: [{ drumId: 'a', hoopStart: 0, hoopEnd: 1 }] },
        { id: 'o2', startUniverse: 10, channelsPerPixel: 3, segments: [{ drumId: 'b', hoopStart: 0, hoopEnd: 1 }] },
      ],
      { maxPixelsPerOutput: 100000 },
    );
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    const drumB = model.drumById.get('b')!;
    expect(map.perPixel[drumB.pixelStart]!.universe).toBe(10);
  });

  it('rejects an output that exceeds the per-output pixel limit', () => {
    const k = kit(
      [{ id: 'o1', startUniverse: 0, channelsPerPixel: 3, segments: [{ drumId: 'a', hoopStart: 0, hoopEnd: 1 }] }],
      { maxPixelsPerOutput: 4 },
    );
    const model = buildPixelModel(k);
    expect(() => buildDmxMap(k, model)).toThrow(/exceeding/);
  });

  it('rejects a segment referencing an unknown drum or out-of-range hoop', () => {
    const model = buildPixelModel(kit([], { maxPixelsPerOutput: 100000 }));
    const badDrum = kit([{ id: 'o1', segments: [{ drumId: 'zzz', hoopStart: 0, hoopEnd: 0 }] }], { maxPixelsPerOutput: 100000 });
    expect(() => buildDmxMap(badDrum, buildPixelModel(badDrum))).toThrow(/unknown drum/);
    const badHoop = kit([{ id: 'o1', segments: [{ drumId: 'a', hoopStart: 0, hoopEnd: 9 }] }], { maxPixelsPerOutput: 100000 });
    expect(() => buildDmxMap(badHoop, buildPixelModel(badHoop))).toThrow(/invalid hoop range/);
    expect(model.pixelCount).toBeGreaterThan(0);
  });
});
