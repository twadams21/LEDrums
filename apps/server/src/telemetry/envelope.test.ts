import { describe, expect, it } from 'vitest';
import { capReport, dedupKey, isTelemetryEnabled, topStackFrame, type Breadcrumb } from './envelope';

describe('isTelemetryEnabled (#122)', () => {
  it('defaults to on when serving the built web root (packaged/prod)', () => {
    expect(isTelemetryEnabled({}, { servingBuiltWeb: true })).toBe(true);
  });
  it('defaults to off under the dev proxy', () => {
    expect(isTelemetryEnabled({}, { servingBuiltWeb: false })).toBe(false);
  });
  it('LEDRUMS_TELEMETRY=on forces on even in dev', () => {
    expect(isTelemetryEnabled({ LEDRUMS_TELEMETRY: 'on' }, { servingBuiltWeb: false })).toBe(true);
  });
  it('LEDRUMS_TELEMETRY=off forces off even when packaged', () => {
    expect(isTelemetryEnabled({ LEDRUMS_TELEMETRY: 'off' }, { servingBuiltWeb: true })).toBe(false);
  });
  it('is case/space tolerant on the override', () => {
    expect(isTelemetryEnabled({ LEDRUMS_TELEMETRY: '  OFF ' }, { servingBuiltWeb: true })).toBe(false);
  });
});

describe('topStackFrame', () => {
  it('returns the first "at …" frame, ignoring the message line', () => {
    const stack = 'Error: boom\n    at render (bundle.js:10:5)\n    at tick (bundle.js:2:1)';
    expect(topStackFrame(stack)).toBe('at render (bundle.js:10:5)');
  });
  it('is empty for a missing or frameless stack', () => {
    expect(topStackFrame(undefined)).toBe('');
    expect(topStackFrame('just a message')).toBe('');
  });
});

describe('dedupKey', () => {
  it('collapses identical origin+message+top-frame; distinguishes different throw sites', () => {
    const a = dedupKey({ origin: 'web', message: 'x', stack: 'Error: x\n    at f (a.js:1:1)' });
    const b = dedupKey({ origin: 'web', message: 'x', stack: 'Error: x\n    at f (a.js:1:1)' });
    const c = dedupKey({ origin: 'web', message: 'x', stack: 'Error: x\n    at g (b.js:2:2)' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('separates web vs server origin', () => {
    expect(dedupKey({ origin: 'web', message: 'x' })).not.toBe(dedupKey({ origin: 'server', message: 'x' }));
  });
});

describe('capReport', () => {
  const crumb = (i: number): Breadcrumb => ({ time: i, type: 'system', source: 's', label: `e${i}` });
  it('caps message + stack length and keeps only the last 20 breadcrumbs', () => {
    const record = {
      message: 'm'.repeat(10_000),
      stack: 's'.repeat(40_000),
      breadcrumbs: Array.from({ length: 50 }, (_, i) => crumb(i)),
    };
    const out = capReport(record);
    expect(out.message.length).toBeLessThanOrEqual(4_001);
    expect(out.stack!.length).toBeLessThanOrEqual(16_001);
    expect(out.breadcrumbs).toHaveLength(20);
    expect(out.breadcrumbs[0]!.label).toBe('e30'); // last 20 → e30..e49
  });
  it('leaves a small report untouched (no stack ok)', () => {
    const record = { message: 'tiny', stack: undefined, breadcrumbs: [crumb(1)] };
    expect(capReport(record)).toEqual(record);
  });
});
