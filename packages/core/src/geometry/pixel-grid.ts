import type { Vec3 } from '../math';
import { distance } from '../math';
import type { PixelModel } from './pixel-model';

/**
 * Uniform spatial hash over a model's (static) pixel world positions, so particle
 * effects can do radius / nearest-within-radius queries without scanning every pixel.
 *
 * Geometry is immutable per PixelModel, so a grid is built once (typically in an
 * effect's `createState`) and reused every frame. Queries are EXACT: any pixel within
 * the query radius lies in one of the visited cells, so results are identical to a
 * brute-force scan over `model.pixels` — just cheaper. Cells are a dense array over
 * the pixel-occupied bounding box (integer index math, no per-query allocation), and
 * queries clamp to that box — a point far outside the kit costs almost nothing.
 */
export interface PixelGrid {
  /** The model this grid indexes — callers must rebuild if `ctx.model` differs. */
  readonly model: PixelModel;
  readonly cellSize: number;
  /** Integer cell coords of the box's min corner. */
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  /** Cell counts per axis. */
  readonly dimX: number;
  readonly dimY: number;
  readonly dimZ: number;
  /** Dense cell array, x-major: index = cx + dimX*(cy + dimY*cz); null = empty cell. */
  readonly cells: ReadonlyArray<number[] | null>;
}

/**
 * Build the grid. Default cell size tracks the typical query radius used by particle
 * effects (a fraction of kit size) so a query visits a handful of cells.
 */
export function buildPixelGrid(model: PixelModel, cellSize?: number): PixelGrid {
  const cs = Math.max(1, cellSize ?? Math.max(40, model.bounds.size * 0.08));
  const { min, max } = model.bounds;
  const minX = Math.floor(min.x / cs);
  const minY = Math.floor(min.y / cs);
  const minZ = Math.floor(min.z / cs);
  const dimX = model.pixels.length === 0 ? 0 : Math.floor(max.x / cs) - minX + 1;
  const dimY = model.pixels.length === 0 ? 0 : Math.floor(max.y / cs) - minY + 1;
  const dimZ = model.pixels.length === 0 ? 0 : Math.floor(max.z / cs) - minZ + 1;
  const cells: Array<number[] | null> = new Array(dimX * dimY * dimZ).fill(null);
  for (const p of model.pixels) {
    const cx = Math.floor(p.world.x / cs) - minX;
    const cy = Math.floor(p.world.y / cs) - minY;
    const cz = Math.floor(p.world.z / cs) - minZ;
    const idx = cx + dimX * (cy + dimY * cz);
    (cells[idx] ??= []).push(p.id);
  }
  return { model, cellSize: cs, minX, minY, minZ, dimX, dimY, dimZ, cells };
}

/**
 * Visit every pixel within `radius` mm of `point` (inclusive, matching a `d > radius`
 * brute-force skip). Visit order is unspecified — callers must be order-independent.
 */
export function forEachPixelWithin(
  grid: PixelGrid,
  point: Vec3,
  radius: number,
  visit: (pixelId: number, dist: number) => void,
): void {
  const cs = grid.cellSize;
  // Clamp the query's cell range to the occupied box; disjoint ranges fall through.
  const x0 = Math.max(0, Math.floor((point.x - radius) / cs) - grid.minX);
  const x1 = Math.min(grid.dimX - 1, Math.floor((point.x + radius) / cs) - grid.minX);
  const y0 = Math.max(0, Math.floor((point.y - radius) / cs) - grid.minY);
  const y1 = Math.min(grid.dimY - 1, Math.floor((point.y + radius) / cs) - grid.minY);
  const z0 = Math.max(0, Math.floor((point.z - radius) / cs) - grid.minZ);
  const z1 = Math.min(grid.dimZ - 1, Math.floor((point.z + radius) / cs) - grid.minZ);
  const pixels = grid.model.pixels;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cy = y0; cy <= y1; cy++) {
      let idx = x0 + grid.dimX * (cy + grid.dimY * cz);
      for (let cx = x0; cx <= x1; cx++, idx++) {
        const bucket = grid.cells[idx];
        if (!bucket) continue;
        for (const id of bucket) {
          const d = distance(pixels[id]!.world, point);
          if (d <= radius) visit(id, d);
        }
      }
    }
  }
}

/**
 * Nearest pixel to `point` within `radius`, or -1 when none is in reach. Ties on
 * exact distance resolve to the lowest pixel id — the same winner a first-strictly-
 * closer brute-force scan over `model.pixels` (ascending id) picks. Allocation-free
 * (no closure, no result object) — safe on a per-particle-per-frame hot path; callers
 * needing the distance recompute it for the one winning pixel.
 */
export function nearestPixelIdWithin(grid: PixelGrid, point: Vec3, radius: number): number {
  const cs = grid.cellSize;
  const x0 = Math.max(0, Math.floor((point.x - radius) / cs) - grid.minX);
  const x1 = Math.min(grid.dimX - 1, Math.floor((point.x + radius) / cs) - grid.minX);
  const y0 = Math.max(0, Math.floor((point.y - radius) / cs) - grid.minY);
  const y1 = Math.min(grid.dimY - 1, Math.floor((point.y + radius) / cs) - grid.minY);
  const z0 = Math.max(0, Math.floor((point.z - radius) / cs) - grid.minZ);
  const z1 = Math.min(grid.dimZ - 1, Math.floor((point.z + radius) / cs) - grid.minZ);
  const pixels = grid.model.pixels;
  let bestId = -1;
  let bestDist = Infinity;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cy = y0; cy <= y1; cy++) {
      let idx = x0 + grid.dimX * (cy + grid.dimY * cz);
      for (let cx = x0; cx <= x1; cx++, idx++) {
        const bucket = grid.cells[idx];
        if (!bucket) continue;
        for (const id of bucket) {
          const d = distance(pixels[id]!.world, point);
          if (d <= radius && (d < bestDist || (d === bestDist && id < bestId))) {
            bestDist = d;
            bestId = id;
          }
        }
      }
    }
  }
  return bestId;
}

/** Object-returning convenience over {@link nearestPixelIdWithin}. */
export function nearestPixelWithin(
  grid: PixelGrid,
  point: Vec3,
  radius: number,
): { id: number; dist: number } | null {
  const id = nearestPixelIdWithin(grid, point, radius);
  if (id < 0) return null;
  return { id, dist: distance(grid.model.pixels[id]!.world, point) };
}
