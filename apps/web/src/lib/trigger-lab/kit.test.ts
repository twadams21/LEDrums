import { describe, expect, it, vi } from 'vitest';
import * as protocol from '@ledrums/protocol';
import { buildLabModel } from './kit';

describe('buildLabModel serialization', () => {
  it('passes its actual PixelModel to the shared protocol serializer', () => {
    const serialize = vi.spyOn(protocol, 'serializePixelModel');
    try {
      const lab = buildLabModel();
      expect(serialize).toHaveBeenCalledTimes(1);
      expect(serialize).toHaveBeenCalledWith(lab.pm);
      expect(lab.model).toBe(serialize.mock.results[0]!.value);
      expect(lab.model).toStrictEqual(protocol.serializePixelModel(lab.pm));
    } finally {
      serialize.mockRestore();
    }
  });

  it('preserves all legacy preview fields and exposes Stage for supported drums', () => {
    const { model, pm } = buildLabModel();
    expect(model.count).toBe(pm.pixelCount);
    expect(model.positions).toStrictEqual(pm.pixels.flatMap((p) => [p.world.x, p.world.y, p.world.z]));
    expect(model.normals).toStrictEqual(pm.pixels.flatMap((p) => [p.normal.x, p.normal.y, p.normal.z]));
    expect(model.tangents).toStrictEqual(pm.pixels.flatMap((p) => [p.tangent.x, p.tangent.y, p.tangent.z]));
    expect(model.segmentLengths).toStrictEqual(pm.pixels.map((p) => p.segmentLengthMm));
    expect(model.bounds).toStrictEqual({ center: [pm.bounds.center.x, pm.bounds.center.y, pm.bounds.center.z], size: pm.bounds.size });
    // Derive expectations from the current core model; defaults are owned elsewhere.
    model.drums.forEach(({ stage, ...drum }, i) => {
      const source = pm.drums[i]!;
      expect(drum).toStrictEqual({ id: source.drumId, label: source.label, color: source.color,
        pixelStart: source.pixelStart, pixelCount: source.pixelCount });
      if (source.hoopCount >= 2) {
        expect(stage).toBeDefined();
        expect(stage?.hoopPixelCounts).toEqual(source.hoopPixelCounts);
        expect(stage?.radiusMm).toBe(source.radiusMm);
      } else {
        expect(stage).toBeUndefined();
      }
    });
  });
});
