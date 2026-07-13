import { describe, expect, it } from 'vitest';
import { CURRENT_KIT_VERSION, parseKit, type OutputConfig } from './kit-schema';
import { buildPixelModel } from './pixel-model';
import { buildDmxMap } from './dmx-map';
import { parseProject, parseProjectPatch } from '../model/project-schema';

/* B5 golden suite — RGB wiring order is a PER-OUTPUT attribute (`OutputConfig.rgbOrder`) rather
   than a single controller-level value. buildDmxMap stamps each pixel with its owning output's
   order (byte-exact across a universe that spans two outputs of different orders). The v<6 PROJECT
   migrator seeds the existing controller-level order onto every output that lacks one — parity for
   unchanged data. The packer (output-manager) falls back to the controller order per pixel. */

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

describe('B5 — migration seeds the controller order onto every output (kit v<6)', () => {
  const legacyKit = {
    version: 5, // post-B4, pre-B5: outputs carry no rgbOrder
    global,
    drums: [drum('A', 0, 4), drum('B', 1, 4)],
    outputs: [out('o1', 'A'), out('o2', 'B')],
  };

  it('parseProject copies project.output.rgbOrder onto each output lacking one, bumping to v6', () => {
    const project = parseProject({ kit: legacyKit, output: { rgbOrder: 'GRB' } });
    expect(project.kit.version).toBe(CURRENT_KIT_VERSION);
    expect(project.kit.outputs.map((o) => o.rgbOrder)).toEqual(['GRB', 'GRB']);
    // The controller field itself is untouched (removed later by C1).
    expect(project.output.rgbOrder).toBe('GRB');
  });

  it('defaults the seed to RGB when the project omits an explicit controller order', () => {
    const project = parseProject({ kit: legacyKit });
    expect(project.kit.outputs.map((o) => o.rgbOrder)).toEqual(['RGB', 'RGB']);
  });

  it('an output that ALREADY declares an order keeps it (per-output wins over the controller)', () => {
    const mixed = { ...legacyKit, outputs: [out('o1', 'A', 'BGR'), out('o2', 'B')] };
    const project = parseProject({ kit: mixed, output: { rgbOrder: 'GRB' } });
    expect(project.kit.outputs.map((o) => o.rgbOrder)).toEqual(['BGR', 'GRB']);
  });

  it('a project patch is seeded the same way (device re-rig path)', () => {
    const patch = parseProjectPatch({ kit: legacyKit, output: { rgbOrder: 'RBG' } });
    expect(patch.kit.outputs.map((o) => o.rgbOrder)).toEqual(['RBG', 'RBG']);
  });

  it('parity: a v6 project is NOT re-seeded — explicit output orders survive untouched', () => {
    const v6 = {
      version: CURRENT_KIT_VERSION,
      global,
      drums: [drum('A', 0, 4)],
      outputs: [out('o1', 'A', 'BRG')],
    };
    const project = parseProject({ kit: v6, output: { rgbOrder: 'GRB' } });
    // Already v6 → the seed step is skipped; the authored per-output order stands.
    expect(project.kit.outputs[0]!.rgbOrder).toBe('BRG');
  });
});
