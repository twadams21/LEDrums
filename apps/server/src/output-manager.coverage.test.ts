import { describe, expect, it } from 'vitest';
import type { DmxMap, OutputSettings } from '@ledrums/core';
import type { PixelOutput, PixelSendCallback } from '@ledrums/io';
import type { MonitorEvent } from './ws-protocol';
import { OutputManager } from './output-manager';

const settings: OutputSettings = {
  state: 'armed', protocol: 'artnet', host: '127.0.0.1', broadcast: false, rgbOrder: 'RGB', fps: 44, priority: 100,
};
/** A real red pixel at the beginning of each literal channel span. */
function map(...coverage: Array<[number, number]>): DmxMap {
  return { perPixel: [], universes: coverage.map(([universe, channelCount]) => ({
    universe, channelCount, pixels: [{ id: 0, channel: universe * 512, channelsPerPixel: 3 }],
  })) };
}
const red = new Float32Array([1, 0, 0, 1]);
class FakeOutput implements PixelOutput {
  events: Array<{ universe: number; bytes: number[] } | 'close'> = [];
  failUniverse?: number;
  failClose = false;
  nextFrame(): void {}
  send(universe: number, channels: Uint8Array): boolean | void {
    this.events.push({ universe, bytes: Array.from(channels) });
    if (this.failUniverse === universe) throw new Error(`U${universe} failed`);
  }
  close(): void {
    this.events.push('close');
    if (this.failClose) throw new Error('close failed');
  }
}

class DeferredOutput extends FakeOutput {
  callbacks: PixelSendCallback[] = [];
  override send(universe: number, channels: Uint8Array, done?: PixelSendCallback): boolean {
    super.send(universe, channels);
    this.callbacks.push(done!);
    return true;
  }
}

describe('OutputManager retired transmitted coverage', () => {
  it('coalesces repeated blackout-retry diagnostics while preserving retries before frames', () => {
    const fake = new FakeOutput();
    let now = 0;
    const manager = new OutputManager(() => fake, { now: () => now });
    const events: Array<Omit<MonitorEvent, 'id' | 'time'>> = [];
    manager.onMonitor = (event) => events.push(event);
    manager.applySettings(settings, map([1, 3], [2, 3]));
    manager.sendFrame(red, map([1, 3], [2, 3]));
    fake.failUniverse = 2;
    for (let i = 0; i < 60; i++) {
      now = i * 16;
      manager.sendFrame(red, map([1, 3]));
    }
    expect(events.filter((event) => event.label === 'Blackout requested')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(fake.events.filter((event) => event !== 'close' && event.universe === 2)).toHaveLength(61);
  });

  it('clears the OLD full prefix when a universe shrinks, before the short live frame', () => {
    const fake = new FakeOutput();
    const manager = new OutputManager(() => fake);
    const old = map([1, 6]);
    manager.applySettings(settings, old);
    manager.sendFrame(red, old);
    fake.events = [];
    // Mutating the same map object must not erase the manager's old-coverage knowledge.
    old.universes[0]!.channelCount = 3;
    manager.sendFrame(red, old);
    expect(fake.events).toEqual([
      { universe: 1, bytes: [0, 0, 0, 0, 0, 0] },
      { universe: 1, bytes: [255, 0, 0] },
    ]);
    fake.events = [];
    manager.sendFrame(red, old);
    expect(fake.events).toEqual([{ universe: 1, bytes: [255, 0, 0] }]);
  });

  it('blackouts the OLD destination and coverage before closing when destination and topology change together', () => {
    const oldOutput = new FakeOutput();
    const newOutput = new FakeOutput();
    let builds = 0;
    const manager = new OutputManager(() => builds++ === 0 ? oldOutput : newOutput);
    const old = map([1, 6], [2, 3]);
    const next = map([1, 3]);
    manager.applySettings(settings, old);
    manager.sendFrame(red, old);
    oldOutput.events = [];
    manager.applySettings({ ...settings, host: '127.0.0.2' }, next);
    manager.sendFrame(red, next);
    expect(oldOutput.events).toEqual([
      { universe: 1, bytes: [0, 0, 0, 0, 0, 0] },
      { universe: 2, bytes: [0, 0, 0] }, 'close',
    ]);
    expect(newOutput.events).toEqual([{ universe: 1, bytes: [255, 0, 0] }]);
  });

  it('continues old-universe cleanup and replacement despite old send and close failures, without hiding them', () => {
    const oldOutput = new FakeOutput();
    const newOutput = new FakeOutput();
    let builds = 0;
    const manager = new OutputManager(() => builds++ === 0 ? oldOutput : newOutput);
    const old = map([1, 3], [2, 3]);
    manager.applySettings(settings, old);
    manager.sendFrame(red, old);
    oldOutput.events = [];
    oldOutput.failUniverse = 1;
    oldOutput.failClose = true;
    expect(() => manager.applySettings({ ...settings, host: '127.0.0.2' }, map([1, 3]))).not.toThrow();
    expect(oldOutput.events).toEqual([
      { universe: 1, bytes: [0, 0, 0] },
      { universe: 2, bytes: [0, 0, 0] }, 'close',
    ]);
    expect(manager.status().lastError).toContain('127.0.0.1');
    expect(manager.status().lastError).toContain('close failed');
    manager.sendFrame(red, map([1, 3]));
    expect(newOutput.events).toHaveLength(1);
    expect(manager.status().lastError).not.toBeNull();
  });

  it('retries a failed retired blackout before a later frame, never from its late callback', () => {
    const fake = new DeferredOutput();
    const manager = new OutputManager(() => fake);
    const old = map([1, 6]);
    const next = map([1, 3]);
    manager.applySettings(settings, old);
    manager.sendFrame(red, old);
    fake.callbacks.shift()!(null);
    manager.applySettings(settings, next);
    manager.sendFrame(red, next);
    fake.events = [];
    fake.callbacks.shift()!(new Error('blackout lost'));
    expect(fake.events).toEqual([]); // no late zero can overwrite the new live frame
    manager.sendFrame(red, next);
    expect(fake.events).toEqual([
      { universe: 1, bytes: [0, 0, 0, 0, 0, 0] },
      { universe: 1, bytes: [255, 0, 0] },
    ]);
  });

  it('close blackouts a live frame submitted AFTER a still-pending retirement', () => {
    const fake = new DeferredOutput();
    const manager = new OutputManager(() => fake);
    manager.applySettings(settings, map([1, 6]));
    manager.sendFrame(red, map([1, 6]));
    manager.applySettings(settings, map([1, 3])); // pending old-prefix zero
    manager.sendFrame(red, map([1, 3])); // new light after that zero
    fake.events = [];
    manager.close();
    expect(fake.events).toEqual([{ universe: 1, bytes: [0, 0, 0, 0, 0, 0] }, 'close']);
  });

  it('does not blackout configured coverage that was never transmitted', () => {
    const fake = new FakeOutput();
    const manager = new OutputManager(() => fake);
    manager.applySettings(settings, map([1, 512], [2, 512]));
    manager.applySettings({ ...settings, state: 'disabled' }, map([3, 512]));
    expect(fake.events).toEqual(['close']);
  });

  it('disabling with an empty incoming map still clears old coverage', () => {
    const fake = new FakeOutput();
    const manager = new OutputManager(() => fake);
    manager.applySettings(settings, map([2, 3]));
    manager.sendFrame(red, map([2, 3]));
    fake.events = [];
    manager.applySettings({ ...settings, state: 'disabled' }, map());
    expect(fake.events).toEqual([{ universe: 2, bytes: [0, 0, 0] }, 'close']);
  });

  it('blackouts removed U2 before transmitting the next U1 frame at the same destination', () => {
    const fake = new FakeOutput();
    const manager = new OutputManager(() => fake);
    const old = map([1, 3], [2, 3]);
    const next = map([1, 3]);
    manager.applySettings(settings, old);
    manager.sendFrame(red, old);
    fake.events = [];
    manager.applySettings(settings, next);
    manager.sendFrame(red, next);
    expect(fake.events).toEqual([
      { universe: 2, bytes: [0, 0, 0] },
      { universe: 1, bytes: [255, 0, 0] },
    ]);
  });
});
