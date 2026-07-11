import { describe, expect, it } from 'vitest';
import { buildPixelModel, parseKit } from '@ledrums/core';
import {
  decodeClient,
  effectSpecs,
  frameToRgbBytes,
  serializeModel,
  type ClientMessage,
} from './ws-protocol';

const samples: ClientMessage[] = [
  { t: 'midi', note: 38, velocity: 100, on: true },
  { t: 'cc', controller: 0, value: 5 },
  { t: 'programChange', value: 2 },
  { t: 'osc', address: '/ledrums/volume', value: 0.5 },
  { t: 'setParam', layerId: 'base', clipId: 'swirl', key: 'hue', value: 200 },
  { t: 'setLayer', layerId: 'base', opacity: 0.5, activeClipId: 'swirl' },
  { t: 'removeLayer', layerId: 'x' },
  { t: 'removeClip', layerId: 'x', clipId: 'y' },
  { t: 'setTransport', bpm: 128, playing: false },
  { t: 'setKitTransform', drumId: 'kick', localSpinDeg: 90 },
  { t: 'setOutput', state: 'armed', host: '10.0.0.5' },
  { t: 'takeover' },
  { t: 'loadProject', name: 'default' },
  { t: 'saveProject', name: 'show1' },
  { t: 'listProjects' },
];

describe('ws-protocol', () => {
  it('round-trips every client message type', () => {
    for (const msg of samples) {
      expect(decodeClient(JSON.stringify(msg))).toEqual(msg);
    }
  });

  it('rejects an unknown message type', () => {
    expect(() => decodeClient(JSON.stringify({ t: 'bogus' }))).toThrow(/Unknown client message/);
    expect(decodeClient(JSON.stringify({ t: 'tunnel', action: 'start' }))).toEqual({ t: 'tunnel', action: 'start' });
    expect(() => decodeClient('{}')).toThrow();
  });

  it('rejects a known type carrying a malformed payload (schema validation)', () => {
    // Wrong field type — decodeClient now schema-validates every payload, not just the `t` tag.
    expect(() => decodeClient(JSON.stringify({ t: 'midi', note: 'x', velocity: 1, on: true }))).toThrow(/Invalid midi/);
    // Missing required field.
    expect(() => decodeClient(JSON.stringify({ t: 'adoptController' }))).toThrow(/Invalid adoptController/);
    // A bad transport value is rejected rather than cast through.
    expect(() => decodeClient(JSON.stringify({ t: 'tunnel', action: 'nope' }))).toThrow(/Invalid tunnel/);
  });

  it('serializes the model with positions = count * 3', () => {
    const model = buildPixelModel(
      parseKit({ global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 }, drums: [{ id: 'd', diameterIn: 8, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }] }),
    );
    const ser = serializeModel(model);
    expect(ser.count).toBe(model.pixelCount);
    expect(ser.positions).toHaveLength(model.pixelCount * 3);
    expect(ser.drums[0]!.id).toBe('d');
  });

  it('quantizes a frame to RGB bytes of the right length', () => {
    const rgba = new Float32Array([1, 0, 0, 1, 0, 0.5, 1, 1]);
    const bytes = frameToRgbBytes(rgba, 2);
    expect(bytes).toHaveLength(6);
    expect(Array.from(bytes)).toEqual([255, 0, 0, 0, 128, 255]);
  });

  it('exposes every effect spec for the UI', () => {
    const specs = effectSpecs();
    expect(specs.length).toBeGreaterThanOrEqual(11);
    expect(specs.every((s) => Array.isArray(s.paramSpec))).toBe(true);
  });
});
