import { describe, expect, it } from 'vitest';
import { buildPixelModel, parseKit, projectSchema } from '@ledrums/core';
import { serializePixelModel, serverMessageSchema } from '@ledrums/protocol';
import {
  decodeClient,
  effectSpecs,
  encodeServer,
  frameToRgbBytes,
  serializeModel,
  type ClientMessage,
  type ServerMessage,
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

  it('keeps serializeModel as the exact shared serializer export', () => {
    expect(serializeModel).toBe(serializePixelModel);
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

  it('preserves optional Stage metadata through state encoding and schema decoding', () => {
    const project = projectSchema.parse({ name: 'Stage', kit: {
      global: { mirror: 'x' },
      drums: [{ id: 'd', label: 'Body', color: '#abcdef', diameterIn: 8, hoopSpacingMm: 50,
        hoops: [{ pixelCount: 3, reverse: true }, { pixelCount: 7 }, { pixelCount: 2 }],
        origin: { x: 120, y: -80, z: 230 }, rotation: { x: 23, y: -31, z: 47 }, flip: true,
        startAngleDeg: 73, localSpinDeg: -19 }],
    } });
    const model = serializeModel(buildPixelModel(project.kit));
    expect(model.drums[0]!.stage?.hoopPixelCounts).toEqual([3, 7, 2]);
    const state: ServerMessage = {
      t: 'state', project, model, effects: [], projects: [],
      output: { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 },
      showLibrary: null, songLibrary: null, tunnel: null,
      osc: { status: 'listening', port: 9000, hosts: [] },
      showRevision: 0, activeSongId: null, activeSectionId: null, recallSequence: 0, sessionId: 'serialization-test',
    };
    const encoded = encodeServer(state);
    expect(serverMessageSchema.parse(JSON.parse(encoded))).toStrictEqual(JSON.parse(encoded));
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
