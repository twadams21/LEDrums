import { describe, expect, it } from 'vitest';
import {
  buildDmxMap,
  buildPixelModel,
  CURRENT_KIT_VERSION,
  Framebuffer,
  parseKit,
  type DmxMap,
  type OutputSettings,
} from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { getHoopPixelRange } from '@ledrums/core';
import { applyRgbOrder, frameToUniverseBytes, OutputManager } from './output-manager';
import type { MonitorEvent } from './ws-protocol';

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

describe('OutputManager per-output RGB order (B5)', () => {
  /** Two single-hoop drums on two outputs of DIFFERENT wiring orders, packed dense into
   *  universe 0. `fallbackOrder` is the controller-level order used for any output lacking one. */
  function perOutputFixture(o1Order: string | undefined, o2Order: string) {
    const kit = parseKit({
      version: CURRENT_KIT_VERSION,
      global: { ledDensityPxPerM: 100, hoopCount: 1, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [
        { id: 'A', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 1, pixelsPerHoop: 2, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'B', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 1, pixelsPerHoop: 2, origin: { x: 500, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
      outputs: [
        { id: 'o1', channelsPerPixel: 3, ...(o1Order ? { rgbOrder: o1Order } : {}), dataLines: [{ id: 'o1:dl0', segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 1 }] }] },
        { id: 'o2', channelsPerPixel: 3, rgbOrder: o2Order, dataLines: [{ id: 'o2:dl0', segments: [{ drumId: 'B', hoopStart: 1, hoopEnd: 1 }] }] },
      ],
    });
    const model = buildPixelModel(kit);
    const fb = new Framebuffer(model.pixelCount);
    // Paint every pixel pure red so channel order is unambiguous: RGB→[255,0,0], GRB→[0,255,0].
    for (let p = 0; p < model.pixelCount; p++) fb.set(p, 1, 0, 0);
    return { dmxMap: buildDmxMap(kit, model), fb, model };
  }

  it('packs each output in ITS OWN order within a single frame (GRB vs GBR)', () => {
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake);
    // o1 = GRB, o2 = GBR; controller fallback is RGB (must NOT be used — both outputs declare orders).
    const { dmxMap, fb, model } = perOutputFixture('GRB', 'GBR');
    m.applySettings(settings('armed', 'RGB'), dmxMap);
    m.sendFrame(fb.rgba, dmxMap);

    const bytes = fake.sends[0]!.bytes; // universe 0, channel-dense
    const a0 = model.drumById.get('A')!.pixelStart; // channel a0*3
    const b0 = model.drumById.get('B')!.pixelStart;
    // Red under GRB (G,R,B) → the R lands in the second byte.
    expect(bytes.slice(a0 * 3, a0 * 3 + 3)).toEqual([0, 255, 0]);
    // Red under GBR (G,B,R) → the R lands in the third byte.
    expect(bytes.slice(b0 * 3, b0 * 3 + 3)).toEqual([0, 0, 255]);
  });

  it('falls back to the controller order for an output that declares none', () => {
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake);
    // o1 has NO order → uses the controller fallback GRB; o2 explicitly RGB.
    const { dmxMap, fb, model } = perOutputFixture(undefined, 'RGB');
    m.applySettings(settings('armed', 'GRB'), dmxMap);
    m.sendFrame(fb.rgba, dmxMap);

    const bytes = fake.sends[0]!.bytes;
    const a0 = model.drumById.get('A')!.pixelStart;
    const b0 = model.drumById.get('B')!.pixelStart;
    expect(bytes.slice(a0 * 3, a0 * 3 + 3)).toEqual([0, 255, 0]); // fallback GRB
    expect(bytes.slice(b0 * 3, b0 * 3 + 3)).toEqual([255, 0, 0]); // explicit RGB
  });
});

describe('OutputManager hoop identify (E1)', () => {
  /** A 2-hoop drum so a single hoop is a strict sub-range of the pixel stream (all in universe 0). */
  function identifyFixture() {
    const kit = parseKit({
      global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [{ id: 'd', diameterIn: 4, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
    });
    const model = buildPixelModel(kit);
    const fb = new Framebuffer(model.pixelCount);
    return { dmxMap: buildDmxMap(kit, model), fb, model };
  }

  it('drives the identified hoop full-on and leaves other pixels on the live frame', () => {
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake, { now: () => 0 });
    const { dmxMap, fb, model } = identifyFixture();
    const hoop1 = getHoopPixelRange(model, 'd', 1)!;
    m.applySettings(settings('armed'), dmxMap);

    m.setIdentify(hoop1, 500);
    expect(m.identifyRange()).toEqual(hoop1);
    m.sendFrame(fb.rgba, dmxMap);

    const bytes = fake.sends[0]!.bytes; // universe 0: channel-dense RGB
    // Hoop-1 pixels forced full-on white.
    for (let p = hoop1.start; p < hoop1.end; p++) {
      expect(bytes[p * 3]).toBe(255);
      expect(bytes[p * 3 + 1]).toBe(255);
      expect(bytes[p * 3 + 2]).toBe(255);
    }
    // Hoop-2 pixels untouched (live frame is all-zero here).
    const hoop2 = getHoopPixelRange(model, 'd', 2)!;
    expect(bytes[hoop2.start * 3]).toBe(0);
  });

  it('clears on expiry (bounded) and reverts to the live frame', () => {
    let now = 0;
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake, { now: () => now });
    const { dmxMap, fb, model } = identifyFixture();
    const hoop1 = getHoopPixelRange(model, 'd', 1)!;
    m.applySettings(settings('armed'), dmxMap);

    m.setIdentify(hoop1, 500);
    now = 600; // past expiry
    expect(m.identifyRange()).toBeNull();
    m.sendFrame(fb.rgba, dmxMap);
    expect(fake.sends[0]!.bytes[hoop1.start * 3]).toBe(0); // reverted to frame
  });

  it('an explicit clear (null / non-positive duration) disarms identify', () => {
    const m = new OutputManager(() => new FakeOutput(), { now: () => 0 });
    const { model } = identifyFixture();
    const hoop1 = getHoopPixelRange(model, 'd', 1)!;
    m.setIdentify(hoop1, 500);
    expect(m.identifyRange()).toEqual(hoop1);
    m.setIdentify(hoop1, 0); // duration <= 0 clears
    expect(m.identifyRange()).toBeNull();
    m.setIdentify(hoop1, 500);
    m.setIdentify(null, 500); // null range clears
    expect(m.identifyRange()).toBeNull();
  });

  it('does not mutate the caller frame buffer', () => {
    const m = new OutputManager(() => new FakeOutput(), { now: () => 0 });
    const { dmxMap, fb, model } = identifyFixture();
    const hoop1 = getHoopPixelRange(model, 'd', 1)!;
    m.applySettings(settings('armed'), dmxMap);
    m.setIdentify(hoop1, 500);
    m.sendFrame(fb.rgba, dmxMap);
    expect(fb.rgba[hoop1.start * 4]).toBe(0); // engine framebuffer untouched
  });
});

describe('OutputManager monitor diagnostics', () => {
  it('coalesces armed packet diagnostics instead of emitting per frame/universe', () => {
    let now = 0;
    const events: Array<Omit<MonitorEvent, 'id' | 'time'>> = [];
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake, { now: () => now, monitorWindowMs: 1000 });
    m.onMonitor = (event) => events.push(event);

    const { dmxMap, fb } = fixture();
    m.applySettings(settings('armed'), dmxMap);

    for (let i = 0; i < 60; i++) {
      now += 16;
      m.sendFrame(fb.rgba, dmxMap);
    }

    expect(fake.sends.length).toBe(60 * dmxMap.universes.length);
    expect(events.filter((e) => e.type === 'output' && e.label.includes('summary'))).toHaveLength(0);
    expect(events.length).toBeLessThan(fake.sends.length);

    now += 1000;
    m.sendFrame(fb.rgba, dmxMap);
    const summary = events.find((e) => e.type === 'output' && e.label.includes('summary'));
    expect(summary?.detail).toContain(`packets=${61 * dmxMap.universes.length}`);
    expect(summary?.destination).toContain('artnet:127.0.0.1:');
  });

  it('coalesces dry-run diagnostics instead of emitting once per frame', () => {
    let now = 0;
    const events: Array<Omit<MonitorEvent, 'id' | 'time'>> = [];
    const m = new OutputManager(() => new FakeOutput(), { now: () => now, monitorWindowMs: 100 });
    m.onMonitor = (event) => events.push(event);

    const { dmxMap, fb } = fixture();
    m.applySettings(settings('dry-run'), dmxMap);
    for (let i = 0; i < 11; i++) {
      now += 10;
      m.sendFrame(fb.rgba, dmxMap);
    }

    const summaries = events.filter((e) => e.type === 'output' && e.label.includes('dry-run summary'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.detail).toContain(`packets=${11 * dmxMap.universes.length}`);
  });

  it('emits one immediate blackout event for the operation', () => {
    const events: Array<Omit<MonitorEvent, 'id' | 'time'>> = [];
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake);
    m.onMonitor = (event) => events.push(event);

    const { dmxMap } = fixture();
    m.applySettings(settings('armed'), dmxMap);
    m.blackout(dmxMap);

    const blackouts = events.filter((e) => e.label === 'Blackout sent');
    expect(blackouts).toHaveLength(1);
    expect(blackouts[0]).toMatchObject({ type: 'output', source: 'server' });
    expect(blackouts[0]!.detail).toContain(`packets=${dmxMap.universes.length}`);
  });

  it('emits setup errors and sets lastError when sender construction fails', () => {
    const events: Array<Omit<MonitorEvent, 'id' | 'time'>> = [];
    const m = new OutputManager(() => {
      throw new Error('factory down');
    });
    m.onMonitor = (event) => events.push(event);

    const { dmxMap } = fixture();
    m.applySettings(settings('armed'), dmxMap);

    expect(m.status().lastError).toContain('factory down');
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', source: 'server/output', label: 'Output setup failed' }));
  });

  it('emits send errors, sets lastError, and still attempts blackout safely', () => {
    const events: Array<Omit<MonitorEvent, 'id' | 'time'>> = [];
    const fake = new FakeOutput();
    const m = new OutputManager(() => fake);
    m.onMonitor = (event) => events.push(event);

    const { dmxMap, fb } = fixture();
    m.applySettings(settings('armed'), dmxMap);
    fake.throwing = true;

    expect(() => m.sendFrame(fb.rgba, dmxMap)).not.toThrow();
    expect(m.status().lastError).toContain('net down');
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', source: 'server/output', label: 'Output send failed' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', source: 'server/output', label: 'Output blackout failed' }));
  });

  it('keeps output monitor destination and source fields filterable', () => {
    const events: Array<Omit<MonitorEvent, 'id' | 'time'>> = [];
    const m = new OutputManager(() => new FakeOutput());
    m.onMonitor = (event) => events.push(event);
    const { dmxMap } = fixture();

    m.applySettings({ ...settings('armed'), protocol: 'sacn', broadcast: true, port: 5568 }, dmxMap);

    expect(events[0]).toMatchObject({
      type: 'output',
      source: 'server',
      destination: 'sacn:broadcast:5568',
    });
  });
});
