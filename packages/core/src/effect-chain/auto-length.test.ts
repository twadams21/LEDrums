/* Sustain "Until dots end" (Tim, 2026-10-05): the brightness envelope and Dot's Life section
   doubled up — the envelope ended the hit (default ~0.8 s) however long Lifespan was. With amp
   length `auto` the hit lasts until the Generator's content ends: Dot's last dot. */
import { describe, expect, it } from 'vitest';
import { effectPlayAction, supportsAutoLength } from './resolver';
import { parseEffect } from './types';

const ctx = { velocity: 1, sourceDrumId: 'kick', bpm: 120, layerOrder: 0 };
const dot = (params: Record<string, number | string>, extra: Record<string, unknown> = {}) =>
  effectPlayAction(
    parseEffect({ id: 'd', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'dot', style: 'dot', params }, amp: { attackMs: 0, length: 'auto' }, ...extra }),
    ctx,
  )!;

describe('Sustain "Until dots end" (amp length auto)', () => {
  it('only a Generator that can say when it ends offers it', () => {
    expect(supportsAutoLength({ kind: 'dot', style: 'dot', params: {} })).toBe(true);
    expect(supportsAutoLength({ kind: 'wave', style: '', params: {} })).toBe(false);
  });

  it('together: the hit lasts one Lifespan', () => {
    const a = dot({ life: 3000 });
    expect(a.mode).toBe('oneshot');
    expect(a.sustainMs).toBe(3000);
  });

  it('stagger: until the last dot, spawned last, ends', () => {
    expect(dot({ life: 1000, spawn: 'stagger', count: 3, interval: 100 }).sustainMs).toBe(1200);
  });

  it('a Lifespan in beats resolves at the fire\'s tempo', () => {
    expect(dot({ life: 3000, 'life:beats': 4 }).sustainMs).toBe(2000); // 4 beats at 120 bpm
  });

  it('dots that never end on their own (Stream, Lifespan 0) loop', () => {
    expect(dot({ spawn: 'stream' }).mode).toBe('loop');
    expect(dot({ life: 0 }).mode).toBe('loop');
  });

  it('a Generator that cannot say plays the default time', () => {
    const a = effectPlayAction(
      parseEffect({ id: 'w', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'wave', style: '' }, amp: { attackMs: 0, length: 'auto' } }),
      ctx,
    )!;
    expect(a.mode).toBe('oneshot');
    expect(a.sustainMs).toBe(500);
  });
});
