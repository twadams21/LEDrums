import { describe, expect, it } from 'vitest';
import { groupVoicesByBus, smoothBusLevels, smoothDockVoices, smoothingAlpha } from './dock-smoothing';
import type { DockVoice } from './dock-voices';

const dv = (id: string, busId: string, level: number): DockVoice => ({
  id, busId, effectId: 'fx', mode: 'oneshot', level, hue: 0, releasing: false, via: '',
});

describe('smoothingAlpha', () => {
  it('is frame-rate independent: two 16ms steps ≈ one 32ms step', () => {
    const a16 = smoothingAlpha(16);
    const a32 = smoothingAlpha(32);
    const two = 1 - (1 - a16) * (1 - a16);
    expect(two).toBeCloseTo(a32, 10);
  });
  it('clamps degenerate dt', () => {
    expect(smoothingAlpha(0)).toBe(0);
    expect(smoothingAlpha(-5)).toBe(0);
  });
});

describe('smoothBusLevels', () => {
  it('approaches the target and converges (snaps) instead of ringing forever', () => {
    let cur: Record<string, number> = { base: 0 };
    const target = { base: 1 };
    const a = smoothingAlpha(16);
    cur = smoothBusLevels(cur, target, a);
    expect(cur.base!).toBeGreaterThan(0);
    expect(cur.base!).toBeLessThan(0.2); // glides, no step
    for (let i = 0; i < 200; i++) cur = smoothBusLevels(cur, target, a);
    expect(cur.base).toBe(1); // snapped exactly
  });
  it('new keys start at the target; removed keys drop out; settled record is reused by reference', () => {
    const settled = smoothBusLevels({ base: 1 }, { base: 1 }, 0.1);
    expect(smoothBusLevels(settled, { base: 1 }, 0.1)).toBe(settled);
    const next = smoothBusLevels(settled, { lead: 0.5 }, 0.1);
    expect(next).toEqual({ lead: 0.5 });
  });
});

describe('smoothDockVoices', () => {
  it('glides voice levels toward the authoritative value and prunes dead voices', () => {
    const levels = new Map<string, number>();
    const a = smoothingAlpha(16);
    let out = smoothDockVoices(levels, [dv('v1', 'base', 1)], a);
    expect(out[0]!.level).toBe(1); // first sight: no ramp-in
    out = smoothDockVoices(levels, [dv('v1', 'base', 0)], a); // server says 0 now
    expect(out[0]!.level).toBeGreaterThan(0.8); // display glides down, no step
    smoothDockVoices(levels, [dv('v2', 'base', 1)], a);
    expect(levels.has('v1')).toBe(false); // dead voice pruned
  });
  it('returns settled voices by reference (zero churn once converged)', () => {
    const levels = new Map<string, number>();
    const v = dv('v1', 'base', 0.7);
    const out = smoothDockVoices(levels, [v], 0.1);
    expect(out[0]).toBe(v);
  });
});

describe('groupVoicesByBus', () => {
  it('groups in one pass preserving order', () => {
    const vs = [dv('a', 'base', 1), dv('b', 'lead', 1), dv('c', 'base', 0.5)];
    const g = groupVoicesByBus(vs);
    expect(g.get('base')!.map((v) => v.id)).toEqual(['a', 'c']);
    expect(g.get('lead')!.map((v) => v.id)).toEqual(['b']);
    expect(g.get('none')).toBeUndefined();
  });
});
