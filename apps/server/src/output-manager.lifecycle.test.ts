import { describe, expect, it } from 'vitest';
import type { MonitorEvent } from './ws-protocol';
import type { DmxMap, OutputSettings } from '@ledrums/core';
import type { PixelOutput, PixelOutputStatus, PixelSendCallback } from '@ledrums/io';
import { OutputManager } from './output-manager';

class AsyncOutput implements PixelOutput {
  state: PixelOutputStatus = { state: 'binding' };
  listeners = new Set<(status: PixelOutputStatus) => void>();
  sends: Array<{ universe: number; bytes: number[]; done?: PixelSendCallback }> = [];
  onStatus(listener: (status: PixelOutputStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }
  emit(state: PixelOutputStatus): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
  nextFrame(): void {}
  send(universe: number, channels: Uint8Array, done?: PixelSendCallback): boolean {
    if (this.state.state === 'binding') return false;
    this.sends.push({ universe, bytes: Array.from(channels), done });
    return true;
  }
  close(): void {}
}

const settings: OutputSettings = {
  state: 'armed', protocol: 'artnet', host: '127.0.0.1', broadcast: false, rgbOrder: 'RGB', fps: 44, priority: 100,
};
const map: DmxMap = { universes: [{ universe: 1, channelCount: 3, pixels: [] }], perPixel: [] };

describe('OutputManager asynchronous lifecycle', () => {
  it('surfaces recovery without flooding Monitor when a socket repeatedly fails and recovers', () => {
    const fake = new AsyncOutput();
    let now = 0;
    const manager = new OutputManager(() => fake, { now: () => now });
    const events: Array<Omit<MonitorEvent, 'id' | 'time'>> = [];
    manager.onMonitor = (event) => events.push(event);
    manager.applySettings(settings, map);
    fake.emit({ state: 'ready' });
    for (let i = 0; i < 60; i++) {
      now = i * 16;
      fake.emit({ state: 'error', phase: 'socket', message: 'intermittent' });
      fake.emit({ state: 'ready' });
    }
    expect(events.filter((event) => event.type === 'output').length).toBeLessThanOrEqual(4);
    expect(events.some((event) => event.label === 'Output recovered')).toBe(true);
    expect(manager.status().lastError).toBeNull();
  });

  it('defers async-error failsafe zeros until BEFORE the next live frame, never inside a late callback', () => {
    const fake = new AsyncOutput();
    const manager = new OutputManager(() => fake);
    const redMap: DmxMap = { perPixel: [], universes: [{ universe: 1, channelCount: 3,
      pixels: [{ id: 0, channel: 512, channelsPerPixel: 3 }] }] };
    const red = new Float32Array([1, 0, 0, 1]);
    manager.applySettings(settings, redMap);
    fake.emit({ state: 'ready' });
    manager.sendFrame(red, redMap);
    fake.sends[0]!.done!(new Error('late send failure'));
    expect(fake.sends).toHaveLength(1);
    manager.sendFrame(red, redMap);
    expect(fake.sends.slice(1).map((send) => send.bytes)).toEqual([[0, 0, 0], [255, 0, 0]]);
  });

  it('coalesces repeated async errors and keeps no false healthy packet summary', () => {
    const fake = new AsyncOutput();
    let now = 0;
    const manager = new OutputManager(() => fake, { now: () => now, monitorWindowMs: 1000 });
    const events: Array<Omit<MonitorEvent, 'id' | 'time'>> = [];
    manager.onMonitor = (event) => events.push(event);
    manager.applySettings(settings, map);
    fake.emit({ state: 'ready' });
    for (let i = 0; i < 60; i++) {
      now = i * 16;
      manager.sendFrame(new Float32Array(), map);
      fake.emit({ state: 'error', phase: 'send', message: 'ENETUNREACH' });
      fake.sends.at(-1)!.done!(new Error('ENETUNREACH'));
    }
    expect(manager.status().packetsSent).toBe(0);
    expect(events.filter((e) => e.type === 'error').length).toBeLessThanOrEqual(2);
    now = 1100;
    manager.sendFrame(new Float32Array(), map);
    const summary = events.find((e) => e.label.includes('summary'))!;
    expect(summary.detail).toContain('locallyAccepted=0');
    expect(summary.detail).toContain('attempts=121'); // 61 live + 60 deferred failsafes
    fake.emit({ state: 'ready' });
    fake.sends.at(-1)!.done!(null);
    expect(manager.status().lastError).toBeNull();
  });

  it('detaches status subscriptions and fences late callbacks across reconfigure and close', () => {
    const old = new AsyncOutput();
    const fresh = new AsyncOutput();
    let builds = 0;
    const manager = new OutputManager(() => builds++ === 0 ? old : fresh);
    manager.applySettings(settings, map);
    old.emit({ state: 'ready' });
    manager.sendFrame(new Float32Array(), map);
    const late = old.sends[0]!.done!;
    manager.applySettings({ ...settings, host: '127.0.0.2' }, map);
    expect(old.listeners.size).toBe(0);
    fresh.emit({ state: 'ready' });
    old.emit({ state: 'error', phase: 'send', message: 'stale error' });
    late(new Error('stale send'));
    late(null);
    expect(manager.status()).toMatchObject({ packetsSent: 0, lastError: null, host: '127.0.0.2' });
    manager.sendFrame(new Float32Array(), map);
    const afterClose = fresh.sends[0]!.done!;
    manager.close();
    afterClose(null);
    expect(fresh.listeners.size).toBe(0);
    expect(manager.status().packetsSent).toBe(0);
    expect(manager.status().readiness).toBe('closed');
  });

  it('does not let earlier accepted packets make an unexpectedly closed output look healthy', () => {
    const fake = new AsyncOutput();
    const manager = new OutputManager(() => fake);
    manager.applySettings(settings, map);
    fake.emit({ state: 'ready' });
    manager.sendFrame(new Float32Array(), map);
    fake.sends[0]!.done!(null);
    fake.emit({ state: 'closed' });
    expect(manager.status().packetsSent).toBe(1);
    expect(manager.status().lastError).toContain('closed');
  });

  it('retries a failed bind when settings are explicitly reapplied, even if the destination is unchanged', () => {
    const old = new AsyncOutput();
    const fresh = new AsyncOutput();
    let builds = 0;
    const manager = new OutputManager(() => builds++ === 0 ? old : fresh);
    manager.applySettings(settings, map);
    old.emit({ state: 'error', phase: 'bind', message: 'EADDRNOTAVAIL' });
    manager.applySettings(settings, map);
    expect(builds).toBe(2);
    expect(old.listeners.size).toBe(0);
    fresh.emit({ state: 'ready' });
    manager.sendFrame(new Float32Array(), map);
    fresh.sends[0]!.done!(null);
    expect(manager.status()).toMatchObject({ readiness: 'ready', lastError: null, packetsSent: 1 });
  });

  it('can recover from a failed factory without pretending it was ready', () => {
    const fake = new AsyncOutput();
    let attempts = 0;
    const manager = new OutputManager(() => {
      if (attempts++ === 0) throw new Error('factory failed');
      return fake;
    });
    manager.applySettings(settings, map);
    expect(manager.status()).toMatchObject({ readiness: 'error', packetsSent: 0 });
    manager.applySettings(settings, map);
    fake.emit({ state: 'ready' });
    expect(manager.status()).toMatchObject({ readiness: 'ready', lastError: null });
  });

  it('never attributes a previous dry-run window to a new destination', () => {
    let now = 0;
    const manager = new OutputManager(() => new AsyncOutput(), { now: () => now });
    const events: Array<Omit<MonitorEvent, 'id' | 'time'>> = [];
    manager.onMonitor = (event) => events.push(event);
    manager.applySettings({ ...settings, state: 'dry-run' }, map);
    manager.sendFrame(new Float32Array(), map);
    now = 500;
    manager.applySettings({ ...settings, state: 'dry-run', host: '127.0.0.2' }, map);
    manager.sendFrame(new Float32Array(), map);
    now = 1100;
    manager.sendFrame(new Float32Array(), map);
    expect(events.filter((event) => event.label.includes('summary'))).toHaveLength(0);
    now = 1500;
    manager.sendFrame(new Float32Array(), map);
    const summary = events.find((event) => event.label.includes('summary'))!;
    expect(summary.destination).toContain('127.0.0.2');
    expect(summary.detail).toContain('simulated=3');
  });

  it('reports void legacy sends as unconfirmed, but never hides their synchronous errors', () => {
    let broken = false;
    const fake: PixelOutput = {
      nextFrame() {}, close() {}, send() { if (broken) throw new Error('legacy failed'); },
    };
    const manager = new OutputManager(() => fake);
    manager.applySettings(settings, map);
    manager.sendFrame(new Float32Array(), map);
    expect(manager.status()).toMatchObject({ readiness: 'unobservable', packetsSent: 0, packetsUnconfirmed: 1 });
    broken = true;
    manager.sendFrame(new Float32Array(), map);
    expect(manager.status().lastError).toContain('legacy failed');
  });

  it('counts attempts separately from local acceptance, and surfaces bind/send failure and recovery', () => {
    const fake = new AsyncOutput();
    const manager = new OutputManager(() => fake);
    manager.applySettings(settings, map);
    manager.sendFrame(new Float32Array(), map);
    expect(manager.status()).toMatchObject({ packetsSent: 0, packetsAttempted: 1, packetsSkipped: 1, readiness: 'binding' });
    fake.emit({ state: 'error', phase: 'bind', message: 'EADDRNOTAVAIL' });
    expect(manager.status().lastError).toContain('EADDRNOTAVAIL');
    fake.emit({ state: 'ready' });
    manager.sendFrame(new Float32Array(), map);
    expect(manager.status().packetsSent).toBe(0); // queued isn't accepted
    fake.emit({ state: 'error', phase: 'send', message: 'ENETUNREACH' });
    fake.sends[0]!.done!(new Error('ENETUNREACH'));
    expect(manager.status().lastError).toContain('ENETUNREACH');
    expect(manager.status().packetsSent).toBe(0);
    manager.sendFrame(new Float32Array(), map);
    fake.emit({ state: 'ready' });
    fake.sends.at(-1)!.done!(null);
    expect(manager.status()).toMatchObject({ packetsSent: 1, packetsAccepted: 1, readiness: 'ready', lastError: null });
  });
});
