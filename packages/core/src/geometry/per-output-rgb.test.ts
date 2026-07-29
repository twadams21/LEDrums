import { describe, expect, it } from 'vitest';
import { parseKit, type OutputConfig } from './kit-schema';
import { CURRENT_KIT_VERSION } from './kit-migrations';
import { buildPixelModel } from './pixel-model';
import { buildDmxMap } from './dmx-map';

/* B5 golden suite — RGB wiring order is a PER-OUTPUT attribute (`OutputConfig.rgbOrder`) rather
   than a single controller-level value. buildDmxMap stamps each pixel with its owning output's
   order (byte-exact across a universe that spans two outputs of different orders). An output that
   declares no order leaves its pixels unstamped and the packer (output-manager) falls back to the
   controller order per pixel. (The v<6 project-layer seeder that back-filled the order onto old
   files died with the v7 floor — see kit-migrations.ts.) */

const global = { ledDensityPxPerM: 100, hoopCount: 1, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000, expanded: false };
const drum = (id: string, i: number, pixelsPerHoop: number) => ({
  id,
  diameterIn: 6,
  hoopSpacingMm: 50,
  hoopCount: 1,
  pixelsPerHoop,
  origin: { x: i * 500, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
});
const out = (id: string, drumId: string, rgbOrder?: string): Record<string, unknown> => ({
  id,
  channelsPerPixel: 3,
  ...(rgbOrder ? { rgbOrder } : {}),
  dataLines: [{ id: `${id}:dl0`, segments: [{ drumId, hoopStart: 1, hoopEnd: 1 }] }],
});

/** A CURRENT-version kit with two single-hoop drums and the given outputs. */
function kit(outputs: Record<string, unknown>[]): ReturnType<typeof parseKit> {
  return parseKit({
    version: CURRENT_KIT_VERSION,
    global,
    drums: [drum('A', 0, 4), drum('B', 1, 4)],
    outputs,
  });
}

describe('B5 — buildDmxMap stamps each pixel with its output rgbOrder', () => {
  it('two outputs of different orders → each output owns its own per-pixel order', () => {
    const k = kit([out('o1', 'A', 'GRB'), out('o2', 'B', 'BGR')]);
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    const aStart = model.drumById.get('A')!.pixelStart;
    const bStart = model.drumById.get('B')!.pixelStart;
    const orderOf = (id: number) => map.universes[0]!.pixels.find((p) => p.id === id)!.rgbOrder;
    expect(orderOf(aStart)).toBe('GRB');
    expect(orderOf(bStart)).toBe('BGR');
  });

  it('an output that declares no order leaves its pixels rgbOrder undefined (packer default)', () => {
    const k = kit([out('o1', 'A'), out('o2', 'B', 'BGR')]);
    const model = buildPixelModel(k);
    const map = buildDmxMap(k, model);
    const aStart = model.drumById.get('A')!.pixelStart;
    const bStart = model.drumById.get('B')!.pixelStart;
    const px = (id: number) => map.universes[0]!.pixels.find((p) => p.id === id)!;
    expect(px(aStart).rgbOrder).toBeUndefined();
    expect(px(bStart).rgbOrder).toBe('BGR');
  });

  it('the schema accepts an optional per-output rgbOrder and defaults it absent', () => {
    const withOrder = kit([out('o1', 'A', 'GBR')]);
    const withoutOrder = kit([out('o1', 'A')]);
    expect((withOrder.outputs[0] as OutputConfig).rgbOrder).toBe('GBR');
    expect((withoutOrder.outputs[0] as OutputConfig).rgbOrder).toBeUndefined();
  });
});
