/* Builds a real 3D pixel model from a small lab kit (pure @ledrums/core, no
   engine/IO) and serialises it into the shape the visualiser's <Scene> wants.
   Throwaway — gives the Trigger Lab the same kit preview the app has. */

import { buildPixelModel, parseKit, type Vec3Config } from '@ledrums/core';
import type { SerializedModel } from '../ws/protocol-types';

function drum(id: string, label: string, color: string, diameterIn: number, origin: Vec3Config, rotation: Vec3Config) {
  return { id, label, color, diameterIn, hoopSpacingMm: 60, localSpinDeg: 270, startAngleDeg: 0, origin, rotation };
}

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
}

export function buildLabModel(): LabModel {
  // Drum ids MUST match fixtures.ts DRUMS so source-drum lighting lines up.
  const kit = parseKit({
    version: 1,
    units: 'mm',
    global: { ledDensityPxPerM: 30, hoopCount: 4, defaultHoopSpacingMm: 60, maxPixelsPerOutput: 8192 },
    drums: [
      drum('kick', 'Kick', '#5bbcff', 21, { x: 0, y: 430, z: 330 }, { x: 90, y: 0, z: 0 }),
      drum('snare', 'Snare', '#72d572', 12, { x: -250, y: 0, z: 650 }, { x: 0, y: 0, z: 0 }),
      drum('tom1', 'Tom 1', '#ff8e72', 13, { x: -60, y: 300, z: 820 }, { x: 16, y: 0, z: 0 }),
      drum('tom2', 'Tom 2', '#d69cff', 15, { x: 340, y: 60, z: 660 }, { x: 6, y: 0, z: 0 }),
    ],
    outputs: [],
  });
  const pm = buildPixelModel(kit);

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

  return { model, attrs: { drumIndex, angle01, norm01, nx, ny, nz } };
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
