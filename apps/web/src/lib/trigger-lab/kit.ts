/* Builds a real 3D pixel model from a small lab kit (pure @ledrums/core, no
   engine/IO) and serialises it into the shape the visualiser's <Scene> wants.
   Throwaway — gives the Trigger Lab the same kit preview the app has. */

import {
  buildPixelModel,
  classifyZone,
  DEFAULT_KIT,
  DEG2RAD,
  type Bounds,
  type DrumInfo,
  type Pixel,
  type PixelModel,
  type Vec3,
} from '@ledrums/core';
import type { SerializedModel } from '../ws/protocol-types';

export interface LabModel {
  model: SerializedModel;
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

  for (const p of pm.pixels) {
    positions.push(p.world.x, p.world.y, p.world.z);
    tangents.push(p.tangent.x, p.tangent.y, p.tangent.z);
    normals.push(p.normal.x, p.normal.y, p.normal.z);
    segmentLengths.push(p.segmentLengthMm);
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

  return { model, pm };
}

// ---- Thumbnail PixelModel (26×13 synthetic drum) ----------------------------

const THUMB_COLS = 26;
const THUMB_ROWS = 4;
/** Radius of the synthetic thumbnail drum, mm. */
const THUMB_RADIUS_MM = 100;
/** Spacing between hoops, mm. */
const THUMB_SPACING_MM = 40;

let _thumbPm: PixelModel | null = null;

/**
 * Return (and lazily build) a tiny synthetic PixelModel sized exactly to the
 * thumbnail grid: 26 columns (hoop angle) × 13 rows (hoop height) = 338 pixels.
 *
 * Pixel `r * 26 + c` maps 1:1 to grid cell (col=c, row=r), so generator output
 * indexes straight onto the canvas. Geometry matches the `attrs` arrays EffectThumb
 * already computes for the pattern path:
 *   angleDeg = (c/26)*360, normHoop = r/12, world xyz in a 100mm-radius cylinder.
 */
export function buildThumbPixelModel(): PixelModel {
  if (_thumbPm) return _thumbPm;

  const COLS = THUMB_COLS;
  const ROWS = THUMB_ROWS;
  const N = COLS * ROWS;
  const RADIUS = THUMB_RADIUS_MM;
  const SPACING = THUMB_SPACING_MM;
  const segLen = (2 * Math.PI * RADIUS) / COLS;

  const pixels: Pixel[] = [];

  for (let r = 0; r < ROWS; r++) {
    const normHoop = ROWS > 1 ? r / (ROWS - 1) : 0;
    const zone = classifyZone(normHoop);
    const localZ = r * SPACING;
    for (let c = 0; c < COLS; c++) {
      const angleDeg = (c / COLS) * 360;
      const a = angleDeg * DEG2RAD;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const world: Vec3 = { x: RADIUS * cosA, y: RADIUS * sinA, z: localZ };
      pixels.push({
        id: r * COLS + c,
        drumId: 'thumb',
        hoopIndex: r,
        indexInHoop: c,
        angleDeg,
        normHoop,
        zone,
        uv: { u: c / COLS, v: normHoop },
        local: { x: world.x, y: world.y, z: world.z },
        world,
        tangent: { x: -sinA, y: cosA, z: 0 },
        normal: { x: cosA, y: sinA, z: 0 },
        segmentLengthMm: segLen,
      });
    }
  }

  const halfZ = ((ROWS - 1) * SPACING) / 2;

  const thumbDrum: DrumInfo = {
    drumId: 'thumb',
    label: 'Thumbnail',
    color: '#ffffff',
    pixelStart: 0,
    pixelCount: N,
    pixelsPerHoop: COLS,
    hoopCount: ROWS,
    radiusMm: RADIUS,
    effectOriginWorld: { x: 0, y: 0, z: halfZ },
  };

  const bounds: Bounds = {
    min: { x: -RADIUS, y: -RADIUS, z: 0 },
    max: { x: RADIUS, y: RADIUS, z: (ROWS - 1) * SPACING },
    center: { x: 0, y: 0, z: halfZ },
    size: RADIUS * 2,
  };

  _thumbPm = {
    pixels,
    drums: [thumbDrum],
    drumById: new Map([['thumb', thumbDrum]]),
    bounds,
    pixelCount: N,
  };

  return _thumbPm;
}
