import type { DrumInfo, PixelModel } from '../geometry/pixel-model';

/** One model revision and ONE source-distance table per generator state, never a global
 * model/drum Map. Normal voices see their own single hit; additional source drums in a
 * legacy trigger-stream host use direct distances instead of growing a pixels×sources cache.
 * Float64 retains the original JS arithmetic exactly before the final Float32 framebuffer.
 */
export interface SpatialGeometry {
  model: PixelModel | null;
  normalized: Float64Array;
  distances: Float64Array;
  sourceId: string | null;
  ox: number;
  oy: number;
  oz: number;
}

export function createSpatialGeometry(): SpatialGeometry {
  return {
    model: null, normalized: new Float64Array(0), distances: new Float64Array(0),
    sourceId: null, ox: 0, oy: 0, oz: 0,
  };
}

/** Dirty-table bits returned by prepareSpatialGeometry; no additional retained buffers. */
export const SPATIAL_COORDINATES = 1;
export const SPATIAL_DISTANCES = 2;

/** Allocate/invalidate only. The neutral traversal fills dirty tables as it renders;
 * the general sampler calls fillSpatialGeometry before reading them. Consume the returned
 * bits in this same render: they are frame-local work, not retained/checkpointed state.
 *
 * Model objects are immutable geometry revisions (voice/geometry-state.ts). Equal pixel
 * counts do NOT imply equal geometry; resize, transform, bounds and reorder all invalidate.
 * No authored parameters enter this cache, so a scale/twist/Audio edit cannot stale it.
 * In-place edits to an existing PixelModel are outside that engine contract. */
export function prepareSpatialGeometry(cache: SpatialGeometry, model: PixelModel, source?: DrumInfo): number {
  const coordinatesChanged = cache.model !== model;
  if (coordinatesChanged) {
    cache.model = model;
    cache.normalized = new Float64Array(model.pixels.length * 3);
    // Drop (don't retain a high-water pool for) the prior model's source distances.
    cache.distances = new Float64Array(0);
    cache.sourceId = null;
  }
  // Store scalar origins, not a drum-object reference that checkpoints would deep-clone.
  let distancesChanged = false;
  if (source) {
    const origin = source.effectOriginWorld;
    distancesChanged = cache.sourceId !== source.drumId ||
      cache.ox !== origin.x || cache.oy !== origin.y || cache.oz !== origin.z;
    if (distancesChanged) {
      if (cache.distances.length !== model.pixels.length) cache.distances = new Float64Array(model.pixels.length);
      cache.sourceId = source.drumId;
      cache.ox = origin.x;
      cache.oy = origin.y;
      cache.oz = origin.z;
    }
  }
  return (coordinatesChanged ? SPATIAL_COORDINATES : 0) | (distancesChanged ? SPATIAL_DISTANCES : 0);
}

/** Eager fill for the general (warped/detail/multi-wave) traversal. */
export function fillSpatialGeometry(cache: SpatialGeometry, updates: number): void {
  if (!updates) return;
  const model = cache.model!;
  const coordinatesChanged = updates & SPATIAL_COORDINATES;
  const distancesChanged = updates & SPATIAL_DISTANCES;
  const size = model.bounds.size;
  const invScale = 1 / (Number.isFinite(size) && size > 1 ? size * 0.5 : 1);
  const centre = model.bounds.center;
  const normalized = cache.normalized, distances = cache.distances;
  const { ox, oy, oz } = cache;
  // One cold traversal builds both tables; a warm own-hit does not traverse at all.
  for (let i = 0; i < model.pixels.length; i++) {
    const world = model.pixels[i]!.world;
    if (coordinatesChanged) {
      normalized[i * 3] = (world.x - centre.x) * invScale;
      normalized[i * 3 + 1] = (world.y - centre.y) * invScale;
      normalized[i * 3 + 2] = (world.z - centre.z) * invScale;
    }
    if (distancesChanged) {
      const dx = world.x - ox;
      const dy = world.y - oy;
      const dz = world.z - oz;
      distances[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
}
