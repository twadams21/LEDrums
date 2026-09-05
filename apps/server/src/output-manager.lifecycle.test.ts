import { describe, expect, it } from 'vitest';
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
