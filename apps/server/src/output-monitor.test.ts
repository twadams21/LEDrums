import { describe, expect, it } from 'vitest';
import type { OutputSettings } from '@ledrums/core';
import { createOutputMonitorCoalescer, outputDestination, universeRangeLabel } from './output-monitor';

function settings(): OutputSettings {
  return { state: 'armed', protocol: 'artnet', host: '127.0.0.1', broadcast: false, rgbOrder: 'RGB', fps: 44, priority: 100 };
}

describe('output monitor coalescer', () => {
  it('waits for the window threshold before emitting a summary', () => {
    const coalescer = createOutputMonitorCoalescer({ windowMs: 1000 });
    expect(coalescer.record({ settings: settings(), kind: 'packet', universe: 0, byteCount: 12, packets: 1, nowMs: 100 })).toBeNull();
    const event = coalescer.record({ settings: settings(), kind: 'packet', universe: 1, byteCount: 12, packets: 1, nowMs: 1100 });
    expect(event).toMatchObject({ type: 'output', source: 'server', label: 'artnet output summary' });
    expect(event?.detail).toContain('packets=2');
    expect(event?.detail).toContain('universes=U0..U1');
  });

  it('resets counters after flush', () => {
    const coalescer = createOutputMonitorCoalescer({ windowMs: 10 });
    coalescer.record({ settings: settings(), kind: 'packet', universe: 2, byteCount: 10, packets: 1, nowMs: 1 });
    coalescer.record({ settings: settings(), kind: 'packet', universe: 2, byteCount: 10, packets: 1, nowMs: 11 });
    coalescer.record({ settings: settings(), kind: 'packet', universe: 3, byteCount: 10, packets: 1, nowMs: 12 });
    const event = coalescer.flush(22);
    expect(event?.detail).toContain('packets=1');
    expect(event?.detail).toContain('universes=U3');
  });

  it('does not emit when there are no packets', () => {
    const coalescer = createOutputMonitorCoalescer({ windowMs: 10 });
    expect(coalescer.flush(100)).toBeNull();
  });

  it('formats universe ranges and destinations', () => {
    expect(universeRangeLabel([])).toBe('none');
    expect(universeRangeLabel([4])).toBe('U4');
    expect(universeRangeLabel([7, 5, 6])).toBe('U5..U7');
    expect(outputDestination({ ...settings(), protocol: 'sacn', broadcast: true, port: 5568 })).toBe('sacn:broadcast:5568');
  });
});
