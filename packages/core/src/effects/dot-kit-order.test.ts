import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext } from '../engine/render-context';
import { defaultParams } from './types';
import { dot } from './impl/dot';
/* Four drums whose kit order (kick, snare, tom1, tom2) isn't their nearest order along x. */
const xs = { kick: 0, snare: 900, tom1: 300, tom2: 600 } as Record<string, number>;
const M = buildPixelModel(parseKit({
  global: { ledDensityPxPerM: 40, hoopCount: 2, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
  drums: Object.keys(xs).map((id) => ({ id, diameterIn: 12, hoopSpacingMm: 50, pixelsPerHoop: 20, origin: { x: xs[id]!, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } })),
}));
/** The drums the first dot visits, in turn. */
function seq(params: Record<string, unknown>, targets?: string[]) {
  const p = { ...defaultParams(dot.paramSpec), fade: 0, count: 1, speed: 400, life: 0, through: 'kit', ...params } as never;
  const state = dot.createState!(M, 7) as { dots: { drum: number }[] };
  const out: string[] = [];
  for (let t = 0; t <= 1500; t += 10) {
    const fb = new Framebuffer(M.pixelCount);
    const ctx: RenderContext = { model: M, timeMs: t, dt: t ? 10 : 0, transport: { timeMs: t, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true },
      triggers: [{ seq: 1, hit: 0, drumId: 'kick', targetDrums: targets, note: 100, velocity: 1, timeMs: 0, ageMs: t }] };
    dot.render(ctx, p, fb, state as never);
    const d = M.drums[state.dots[0]?.drum ?? 0]!.drumId;
    if (out[out.length - 1] !== d) out.push(d);
  }
  return out.join('>');
}
const first = (walk: string, n = 5) => walk.split('>').slice(0, n).join('>');

// Tim, 2026-10-07: "the drum order gets mirrored when direction is reversed … 'nearest' and
// 'random' don't work at all. they just do the same thing as 'kit'". A dot through the kit begins on
// ONE drum and walks the Kit order — over the Target's drums only; Reverse turns it round on each
// drum, never the order.
describe('Dot through the kit: the Kit order', () => {
  const at = (params: Record<string, unknown>, targets?: string[]) => first(seq(params, targets));

  it('Kit: the kit\'s own order, from its first drum — Reverse keeps it', () => {
    expect(at({ kitOrder: 'kit' })).toBe('kick>snare>tom1>tom2>kick');
    expect(at({ kitOrder: 'kit', direction: 'reverse' })).toBe('kick>snare>tom1>tom2>kick');
  });

  it('Nearest: the closest drum next, from the drum you hit', () => {
    expect(at({ kitOrder: 'nearest' })).toBe('kick>tom1>tom2>snare>kick');
    expect(at({ kitOrder: 'nearest', direction: 'reverse' })).toBe('kick>tom1>tom2>snare>kick');
  });

  it('Random: not the kit\'s order, and never the same drum twice running', () => {
    const walk = seq({ kitOrder: 'random' }).split('>');
    expect(walk.slice(0, 5).join('>')).not.toBe('kick>snare>tom1>tom2>kick');
    expect(walk.every((d, i) => i === 0 || d !== walk[i - 1])).toBe(true);
  });

  it('Custom: the dragged order, from its first — Reverse keeps it', () => {
    expect(at({ kitOrder: 'custom', kitList: 'tom2,kick,snare,tom1' })).toBe('tom2>kick>snare>tom1>tom2');
    expect(at({ kitOrder: 'custom', kitList: 'tom2,kick,snare,tom1', direction: 'reverse' })).toBe('tom2>kick>snare>tom1>tom2');
  });

  it('walks only the Target\'s drums', () => {
    expect(at({ kitOrder: 'kit' }, ['snare', 'tom2'])).toBe('snare>tom2>snare>tom2>snare');
  });
});
