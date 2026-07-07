/**
 * Slice — chops the active strip into pixel-count bands, jitters their widths, then shuffles
 * those bands into a stable per-voice remap. It is spatial only: pixels move, colours do not
 * change. State owns the remap and rebuilds only when params or the target range materially
 * change.
 */
import { pnum } from '../../effects/types';
import { hashString, mulberry32 } from '../../math';
import type { ModifierDef, PixelRange, ResolvedParams } from '../types';
import { makeScratch, rangeLen, snapshotRange, type ScratchState } from './strip';

interface SliceBand {
  start: number;
  width: number;
}

export interface SliceState extends ScratchState {
  signature: string;
  sourceByLocal: Int32Array;
  bands: SliceBand[];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function paramsOf(params: ResolvedParams): { width: number; jitter: number; seed: number } {
  const width = Math.max(1, Math.round(pnum(params, 'width', 8)));
  const jitter = clamp01(pnum(params, 'jitter', 0));
  const seed = Math.trunc(pnum(params, 'seed', 1)) >>> 0;
  return { width, jitter, seed };
}

function signature(range: PixelRange, width: number, jitter: number, seed: number): string {
  return `${range.start}:${range.end}:${width}:${jitter}:${seed}`;
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function jitteredWidth(rng: () => number, base: number, jitter: number, remaining: number): number {
  if (remaining <= base) return remaining;
  if (jitter <= 0) return Math.min(base, remaining);
  const spread = Math.max(0, Math.floor(base * jitter));
  if (spread <= 0) return Math.min(base, remaining);
  const min = Math.max(1, base - spread);
  const max = Math.max(min, base + spread);
  return Math.min(remaining, min + Math.floor(rng() * (max - min + 1)));
}

export function buildSliceMapping(len: number, width: number, jitter: number, seed: number): { sourceByLocal: Int32Array; bands: SliceBand[] } {
  const sourceByLocal = new Int32Array(Math.max(0, len));
  const bands: SliceBand[] = [];
  if (len <= 0) return { sourceByLocal, bands };

  const rng = mulberry32(hashString(`slice:${len}:${width}:${jitter}:${seed}`));
  for (let cursor = 0; cursor < len;) {
    const w = jitteredWidth(rng, width, jitter, len - cursor);
    bands.push({ start: cursor, width: w });
    cursor += w;
  }

  const shuffled = shuffle(bands, hashString(`slice-order:${len}:${width}:${jitter}:${seed}`));
  let dst = 0;
  for (const band of shuffled) {
    for (let i = 0; i < band.width && dst < len; i++) sourceByLocal[dst++] = band.start + i;
  }
  return { sourceByLocal, bands };
}

export const slice: ModifierDef<SliceState> = {
  id: 'slice',
  name: 'Slice',
  category: 'spatial',
  paramSpec: [
    { key: 'width', label: 'Band', type: 'number', default: 8, min: 1, max: 256, step: 1, unit: 'px' },
    { key: 'jitter', label: 'Jitter', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'seed', label: 'Seed', type: 'number', default: 1, min: 0, max: 9999, step: 1 },
  ],
  createState(model): SliceState {
    return { ...makeScratch(model), signature: '', sourceByLocal: new Int32Array(0), bands: [] };
  },

  apply(_ctx, params, fb, range, state): void {
    const len = rangeLen(range);
    if (len <= 1) return;
    const { width, jitter, seed } = paramsOf(params);
    const sig = signature(range, width, jitter, seed);
    if (state.signature !== sig || state.sourceByLocal.length !== len) {
      const next = buildSliceMapping(len, width, jitter, seed);
      state.signature = sig;
      state.sourceByLocal = next.sourceByLocal;
      state.bands = next.bands;
    }

    snapshotRange(fb, range, state.scratch);
    const src = state.scratch;
    const dst = fb.rgba;
    for (let local = 0; local < len; local++) {
      const from = (range.start + state.sourceByLocal[local]!) * 4;
      const to = (range.start + local) * 4;
      dst[to] = src[from]!;
      dst[to + 1] = src[from + 1]!;
      dst[to + 2] = src[from + 2]!;
      dst[to + 3] = src[from + 3]!;
    }
  },
};
