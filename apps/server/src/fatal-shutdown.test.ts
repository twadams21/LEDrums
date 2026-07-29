import { describe, expect, it } from 'vitest';
import { createFatalHandler } from './fatal-shutdown';

describe('createFatalHandler', () => {
  it('darkens BEFORE flushing reports (rig before telemetry)', () => {
    const order: string[] = [];
    const handler = createFatalHandler({
      darken: () => order.push('darken'),
      flushReports: () => order.push('flush'),
    });
    handler();
    expect(order).toEqual(['darken', 'flush']);
  });

  it('a throwing darken does not prevent the flush and does not rethrow', () => {
    const order: string[] = [];
    const logs: string[] = [];
    const handler = createFatalHandler({
      darken: () => {
        throw new Error('output gone');
      },
      flushReports: () => order.push('flush'),
      log: (m) => logs.push(m),
    });
    expect(() => handler()).not.toThrow();
    expect(order).toEqual(['flush']);
    expect(logs.some((m) => m.includes('darken failed'))).toBe(true);
  });

  it('a throwing flush does not rethrow (and the darken already happened)', () => {
    const order: string[] = [];
    const logs: string[] = [];
    const handler = createFatalHandler({
      darken: () => order.push('darken'),
      flushReports: () => {
        throw new Error('disk full');
      },
      log: (m) => logs.push(m),
    });
    expect(() => handler()).not.toThrow();
    expect(order).toEqual(['darken']);
    expect(logs.some((m) => m.includes('report flush failed'))).toBe(true);
  });
});
