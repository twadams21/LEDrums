import { describe, expect, it } from 'vitest';
import {
  buildDmxMap,
  buildPixelModel,
  Framebuffer,
  parseKit,
  type DmxMap,
  type OutputSettings,
} from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { applyRgbOrder, frameToUniverseBytes, OutputManager } from './output-manager';

class FakeOutput implements PixelOutput {
  sends: { universe: number; bytes: number[] }[] = [];
  closed = false;
  throwing = false;
  nextFrame(): void {}
  send(universe: number, channels: Uint8Array): void {
    if (this.throwing) throw new Error('net down');
    this.sends.push({ universe, bytes: Array.from(channels) });
  }
  close(): void {
    this.closed = true;
  }
}

function fixture(): { dmxMap: DmxMap; fb: Framebuffer } {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 1, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
    drums: [{ id: 'd', diameterIn: 4, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  const model = buildPixelModel(kit);
  const fb = new Framebuffer(model.pixelCount);
  fb.set(0, 1, 0, 0); // pixel 0 = red
  return { dmxMap: buildDmxMap(kit, model), fb };
}

function settings(state: OutputSettings['state'], rgbOrder: OutputSettings['rgbOrder'] = 'RGB'): OutputSettings {
  return { state, protocol: 'artnet', host: '127.0.0.1', broadcast: false, rgbOrder, fps: 44, priority: 100 };
}

describe('output pure helpers', () => {
  it('applyRgbOrder reorders channels', () => {
    expect(applyRgbOrder('GRB', 10, 20, 30)).toEqual([20, 10, 30]);
    expect(applyRgbOrder('RGB', 10, 20, 30)).toEqual([10, 20, 30]);
  });

  it('frameToUniverseBytes packs patch-order bytes with RGB ordering', () => {
    const { dmxMap, fb } = fixture();
    const bytes = frameToUniverseBytes(fb.rgba, dmxMap.universes[0]!, 'RGB');
    expect(bytes[0]).toBe(255); // pixel 0 red
    expect(bytes[1]).toBe(0);
    expect(bytes[2]).toBe(0);
  });
});

describe('OutputManager state machine', () => {
  it('disabled emits nothing', () => {
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake);
    const { dmxMap, fb } = fixture();
    m.applySettings(settings('disabled'), dmxMap);
    m.sendFrame(fb.rgba, dmxMap);
    expect(fake.sends).toHaveLength(0);
  });

  it('dry-run forms packets (counts) but does not transmit', () => {
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake);
    const { dmxMap, fb } = fixture();
    m.applySettings(settings('dry-run'), dmxMap);
    m.sendFrame(fb.rgba, dmxMap);
    expect(fake.sends).toHaveLength(0);
    expect(m.status().packetsSent).toBeGreaterThan(0);
  });

  it('armed transmits one packet per universe', () => {
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake);
    const { dmxMap, fb } = fixture();
    m.applySettings(settings('armed'), dmxMap);
    m.sendFrame(fb.rgba, dmxMap);
    expect(fake.sends).toHaveLength(dmxMap.universes.length);
    expect(fake.sends[0]!.bytes[0]).toBe(255);
  });

  it('blacks out the rig when transitioning armed -> disabled', () => {
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake);
    const { dmxMap, fb } = fixture();
    m.applySettings(settings('armed'), dmxMap);
    m.sendFrame(fb.rgba, dmxMap);
    const before = fake.sends.length;
    m.applySettings(settings('disabled'), dmxMap);
    const blackout = fake.sends[fake.sends.length - 1]!;
    expect(fake.sends.length).toBeGreaterThan(before);
    expect(blackout.bytes.every((b) => b === 0)).toBe(true);
    expect(fake.closed).toBe(true);
  });

  it('records a send error without crashing', () => {
    const fake = new FakeOutput();
    fake.throwing = true;
    const m = new OutputManager(() => fake);
    const { dmxMap, fb } = fixture();
    m.applySettings(settings('armed'), dmxMap);
    expect(() => m.sendFrame(fb.rgba, dmxMap)).not.toThrow();
    expect(m.status().lastError).toContain('net down');
  });

  it('passes priority / port / iface through to the sender factory (S5c)', () => {
    let captured: OutputSettings | null = null;
    const m = new OutputManager((s) => {
      captured = s;
      return new FakeOutput();
    });
    const { dmxMap } = fixture();
    m.applySettings({ ...settings('armed'), protocol: 'sacn', priority: 175, port: 5569, iface: '10.0.0.9' }, dmxMap);
    expect(captured).toMatchObject({ priority: 175, port: 5569, iface: '10.0.0.9' });
  });

  it('re-creates the sender when only priority or iface changes (baked in at construction)', () => {
    let builds = 0;
    const m = new OutputManager(() => {
      builds++;
      return new FakeOutput();
    });
    const { dmxMap } = fixture();
    const base = { ...settings('armed'), protocol: 'sacn' as const };
    m.applySettings({ ...base, priority: 100 }, dmxMap);
    m.applySettings({ ...base, priority: 200 }, dmxMap); // priority change → new transport
    m.applySettings({ ...base, priority: 200, iface: '10.0.0.5' }, dmxMap); // iface change → new transport
    expect(builds).toBe(3);
  });
});
