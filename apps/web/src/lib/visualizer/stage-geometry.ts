import type { SerializedModel } from '../ws/protocol-types';

export type Vec3Tuple = [number, number, number];
export const SCENE_SCALE = 100;
/** Presentation-only budget. The diagnostic pixels are never culled by this limit. */
export const MAX_STAGE_DRUMS = 32;

export interface StageDrum {
  id: string;
  pixelStart: number;
  pixelCount: number;
  center: Vec3Tuple;
  axis: Vec3Tuple;
  radius: number;
  depth: number;
  hoopCenters: Vec3Tuple[];
  /** Framing estimate only; never used to generate or scale a Stage body. */
  estimatedDepth: boolean;
}
export interface StageLayout {
  drums: StageDrum[];
  center: Vec3Tuple;
  size: number;
  halfExtents: Vec3Tuple;
  floorY: number;
  omittedDrums: number;
}

/** Same handedness conversion as Pixels: world Z-up mm → Three Y-up units. */
export function sceneVector(values: number[], i: number, scale = 1): Vec3Tuple {
  return [values[i * 3]! / scale, values[i * 3 + 2]! / scale, values[i * 3 + 1]! / scale];
}
function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalize(v: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(...v);
  return length > 1e-8 ? v.map((x) => x / length) as Vec3Tuple : [0, 1, 0];
}

/**
 * Reconstruct circular camera bounds from the actual wire geometry, NOT drum ids or default-kit
 * transforms. Axial projection splits hoops independent of pixel density/reverse/flip/mirror.
 * A hoop's count × arc length gives its radius even at ONE pixel per hoop. Averaging hoop
 * centres equally (not their pixels) avoids shifting mixed-density drums off their origin.
 * Reserve 12mm beyond the end LEDs for camera framing. These estimates do not render shells:
 * Stage bodies come only from a dimension-matched asset and the shared serialized body pose.
 */
export function buildStageLayout(model: SerializedModel | null): StageLayout {
  const drums: StageDrum[] = [];
  const min: Vec3Tuple = [Infinity, Infinity, Infinity];
  const max: Vec3Tuple = [-Infinity, -Infinity, -Infinity];
  for (const drum of model?.drums ?? []) {
    if (!model || drum.pixelCount === 0) continue;
    const start = drum.pixelStart;
    const end = Math.min(start + drum.pixelCount, model.count);
    if (end <= start) continue;
    const n = sceneVector(model.normals, start);
    const t = sceneVector(model.tangents, start);
    const axis = normalize([
      t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0],
    ]);
    const hoops: { start: number; end: number }[] = [];
    let hoopStart = start;
    let plane = dot(sceneVector(model.positions, start), axis);
    for (let i = start + 1; i < end; i++) {
      const next = dot(sceneVector(model.positions, i), axis);
      if (Math.abs(next - plane) > 0.001) {
        hoops.push({ start: hoopStart, end: i });
        hoopStart = i;
        plane = next;
      }
    }
    hoops.push({ start: hoopStart, end });
    const first = hoops[0]!;
    const radius = (model.segmentLengths[start]! * (first.end - first.start)) / (2 * Math.PI * SCENE_SCALE);
    if (!Number.isFinite(radius) || radius <= 0) continue;
    const hoopCenters = hoops.map((hoop): Vec3Tuple => {
      const p = sceneVector(model.positions, hoop.start, SCENE_SCALE);
      const normal = normalize(sceneVector(model.normals, hoop.start));
      return [p[0] - normal[0] * radius, p[1] - normal[1] * radius, p[2] - normal[2] * radius];
    });
    const center: Vec3Tuple = [0, 0, 0];
    for (const point of hoopCenters) for (let k = 0; k < 3; k++) center[k]! += point[k]! / hoops.length;
    const span = Math.max(...hoopCenters.map((p) => dot(p, axis))) - Math.min(...hoopCenters.map((p) => dot(p, axis)));
    const estimatedDepth = span < 1e-5;
    const depth = estimatedDepth ? Math.max(0.24, radius * 0.6) : span + 0.24;
    if (![...center, depth].every(Number.isFinite)) continue;
    // Analytic cylinder bounds, not sparse sampled points. The extra 35 mm encloses the
    // sourced rim/hardware beyond the tape, verified against the bundled GLB (framing only).
    for (let k = 0; k < 3; k++) {
      const extent = Math.abs(axis[k]!) * depth / 2 + radius * Math.sqrt(Math.max(0, 1 - axis[k]! ** 2)) + 0.35;
      min[k] = Math.min(min[k]!, center[k]! - extent);
      max[k] = Math.max(max[k]!, center[k]! + extent);
    }
    drums.push({ id: drum.id, pixelStart: start, pixelCount: end - start, center, axis, radius, depth, hoopCenters, estimatedDepth });
  }
  if (!drums.length) return { drums: [], center: [0, 0, 0], size: 10, halfExtents: [5, 5, 5], floorY: -1, omittedDrums: 0 };
  return {
    drums: drums.slice(0, MAX_STAGE_DRUMS),
    center: min.map((x, k) => (x + max[k]!) / 2) as Vec3Tuple,
    size: Math.max(...min.map((x, k) => max[k]! - x), 1),
    halfExtents: min.map((x, k) => (max[k]! - x) / 2) as Vec3Tuple,
    floorY: min[1] - 0.04,
    omittedDrums: Math.max(0, drums.length - MAX_STAGE_DRUMS),
  };
}
