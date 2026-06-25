/* Builds a real 3D pixel model from a small lab kit (pure @ledrums/core, no
   engine/IO) and serialises it into the shape the visualiser's <Scene> wants.
   Throwaway — gives the Trigger Lab the same kit preview the app has. */

import { buildPixelModel, DEFAULT_KIT, type PixelModel } from '@ledrums/core';
import type { SerializedModel } from '../ws/protocol-types';

/** Per-pixel attributes the pattern renderer samples (kept parallel to the frame). */
export interface PixelAttrs {
  drumIndex: Int16Array;
  /** 0..1 around the hoop. */
  angle01: Float32Array;
  /** 0..1 along the hoops, head → shell. */
  norm01: Float32Array;
  /** normalized world position within kit bounds, per axis 0..1. */
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
}

export interface LabModel {
  model: SerializedModel;
  attrs: PixelAttrs;
  /** The underlying core PixelModel (same pixel order/count as `model`). Kept so the
      offline renderer can run hosted core EffectGenerators (which need full 3D geometry,
      uv, hoop index, drum origins) for generator-backed effects. */
  pm: PixelModel;
}

export function buildLabModel(): LabModel {
  // Derive the offline preview model from the ONE canonical kit (`@ledrums/core`'s
  // DEFAULT_KIT) — the same kit `defaultProject()` uses — so the lab's drum ids +
  // geometry can never drift from the engine's (the prior `tom` vs `tom1` bug class).
  const pm = buildPixelModel(DEFAULT_KIT);

  const positions: number[] = [];
  const tangents: number[] = [];
  const normals: number[] = [];
  const segmentLengths: number[] = [];

  const count = pm.pixelCount;
  const drumIndex = new Int16Array(count);
  const angle01 = new Float32Array(count);
  const norm01 = new Float32Array(count);
  const nx = new Float32Array(count);
  const ny = new Float32Array(count);
  const nz = new Float32Array(count);

  const drumIdx = new Map(pm.drums.map((d, i) => [d.drumId, i] as const));
  const { min, max } = pm.bounds;
  const rx = max.x - min.x || 1;
  const ry = max.y - min.y || 1;
  const rz = max.z - min.z || 1;

  let i = 0;
  for (const p of pm.pixels) {
    positions.push(p.world.x, p.world.y, p.world.z);
    tangents.push(p.tangent.x, p.tangent.y, p.tangent.z);
    normals.push(p.normal.x, p.normal.y, p.normal.z);
    segmentLengths.push(p.segmentLengthMm);

    drumIndex[i] = drumIdx.get(p.drumId) ?? 0;
    angle01[i] = ((p.angleDeg % 360) + 360) % 360 / 360;
    norm01[i] = p.normHoop;
    nx[i] = (p.world.x - min.x) / rx;
    ny[i] = (p.world.y - min.y) / ry;
    nz[i] = (p.world.z - min.z) / rz;
    i++;
  }

  const model: SerializedModel = {
    count: pm.pixelCount,
    positions,
    tangents,
    normals,
    segmentLengths,
    drums: pm.drums.map((d) => ({
      id: d.drumId,
      label: d.label,
      color: d.color,
      pixelStart: d.pixelStart,
      pixelCount: d.pixelCount,
    })),
    bounds: {
      center: [pm.bounds.center.x, pm.bounds.center.y, pm.bounds.center.z],
      size: pm.bounds.size,
    },
  };

  return { model, attrs: { drumIndex, angle01, norm01, nx, ny, nz }, pm };
}

/** HSL-ish hue (deg) → sRGB 0..255, brightness scaled by `level` (additive on black). */
export function hueToRgb(hue: number, level: number): [number, number, number] {
  const s = 0.85;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((hue % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g] = [c, x];
  else if (hp < 2) [r, g] = [x, c];
  else if (hp < 3) [g, b] = [c, x];
  else if (hp < 4) [g, b] = [x, c];
  else if (hp < 5) [r, b] = [x, c];
  else [r, b] = [c, x];
  const m = l - c / 2;
  const k = Math.max(0, Math.min(1, level)) * 255;
  return [Math.round((r + m) * k), Math.round((g + m) * k), Math.round((b + m) * k)];
}
