import { DEG2RAD, type Vec3 } from '../math';
import { eulerXYZApply, localToWorld } from './euler';
import {
  drumDensity,
  drumHoopCount,
  type DrumConfig,
  type KitConfig,
} from './kit-schema';
import { classifyZone, type Zone } from './zones';

const MM_PER_INCH = 25.4;

export interface Pixel {
  /** Global, stable index into the frame buffer. */
  id: number;
  drumId: string;
  hoopIndex: number;
  indexInHoop: number;
  /** Angular position around the hoop, degrees. */
  angleDeg: number;
  /** Normalized hoop height, 0 (head side) .. 1 (shell side). */
  normHoop: number;
  zone: Zone;
  /** Per-drum cylindrical UV for 2D texture sampling: u = angle/360, v = normHoop. */
  uv: { u: number; v: number };
  /** Position in the drum's local frame, mm. */
  local: Vec3;
  /** Position in world (kit) space, mm. */
  world: Vec3;
  /** Unit world-space tangent (along the hoop) — orients tube segments. */
  tangent: Vec3;
  /** Unit world-space outward normal (radial, away from hoop centre). */
  normal: Vec3;
  /** Arc length this pixel occupies along the hoop, mm (segment length, no overlap). */
  segmentLengthMm: number;
}

export interface DrumInfo {
  drumId: string;
  label: string;
  color: string;
  pixelStart: number;
  pixelCount: number;
  pixelsPerHoop: number;
  hoopCount: number;
  radiusMm: number;
  /** Drum effect origin in world space (radial/3D effects sample distance from here). */
  effectOriginWorld: Vec3;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  /** Largest extent across any axis, mm — handy for visualizer framing. */
  size: number;
}

export interface PixelModel {
  pixels: Pixel[];
  drums: DrumInfo[];
  drumById: Map<string, DrumInfo>;
  bounds: Bounds;
  pixelCount: number;
}

function pixelsPerHoop(kit: KitConfig, drum: DrumConfig): number {
  // A literal per-drum count is authoritative — return it verbatim, ignoring density.
  if (drum.pixelsPerHoop !== undefined) return drum.pixelsPerHoop;
  const diameterMm = drum.diameterIn * MM_PER_INCH;
  const circumferenceM = (Math.PI * diameterMm) / 1000;
  return Math.max(1, Math.round(circumferenceM * drumDensity(kit, drum)));
}

/**
 * Build the full 3D pixel model from a validated kit config (plan U2).
 *
 * Pixels are emitted grouped by drum, then hoop, then angular index — a stable
 * order the frame buffer and DMX map both rely on. Hoops are circles in the drum's
 * local XY plane stacked along local +Z; world position applies the drum's intrinsic
 * XYZ rotation then its origin translation.
 */
export function buildPixelModel(kit: KitConfig): PixelModel {
  const pixels: Pixel[] = [];
  const drums: DrumInfo[] = [];
  const drumById = new Map<string, DrumInfo>();

  let id = 0;
  for (const drum of kit.drums) {
    const hoopCount = drumHoopCount(kit, drum);
    const perHoop = pixelsPerHoop(kit, drum);
    const radiusMm = (drum.diameterIn * MM_PER_INCH) / 2;
    const spacing = drum.hoopSpacingMm;
    const pixelStart = id;

    for (let h = 0; h < hoopCount; h++) {
      const localZ = h * spacing;
      const normHoop = hoopCount > 1 ? h / (hoopCount - 1) : 0;
      const zone = classifyZone(normHoop);
      const segLen = (Math.PI * 2 * radiusMm) / perHoop;
      for (let i = 0; i < perHoop; i++) {
        const angleDeg = drum.startAngleDeg + drum.localSpinDeg + (360 * i) / perHoop;
        const a = angleDeg * DEG2RAD;
        const local: Vec3 = {
          x: radiusMm * Math.cos(a),
          y: radiusMm * Math.sin(a),
          z: localZ,
        };
        const world = localToWorld(local, drum.rotation, drum.origin);
        // Tangent (along hoop) and outward radial normal, rotated into world space.
        const tangent = eulerXYZApply({ x: -Math.sin(a), y: Math.cos(a), z: 0 }, drum.rotation);
        const normal = eulerXYZApply({ x: Math.cos(a), y: Math.sin(a), z: 0 }, drum.rotation);
        const wrappedAngle = ((angleDeg % 360) + 360) % 360;
        pixels.push({
          id,
          drumId: drum.id,
          hoopIndex: h,
          indexInHoop: i,
          angleDeg: wrappedAngle,
          normHoop,
          zone,
          uv: { u: wrappedAngle / 360, v: normHoop },
          local,
          world,
          tangent,
          normal,
          segmentLengthMm: segLen,
        });
        id++;
      }
    }

    const info: DrumInfo = {
      drumId: drum.id,
      label: drum.label,
      color: drum.color,
      pixelStart,
      pixelCount: id - pixelStart,
      pixelsPerHoop: perHoop,
      hoopCount,
      radiusMm,
      effectOriginWorld: localToWorld(drum.effectOriginLocal, drum.rotation, drum.origin),
    };
    drums.push(info);
    drumById.set(drum.id, info);
  }

  return {
    pixels,
    drums,
    drumById,
    bounds: computeBounds(pixels),
    pixelCount: pixels.length,
  };
}

/**
 * Return the contiguous pixel range for one hoop on a drum, or `null` when the
 * drum/hoop doesn't exist in the model (dangling targetId → caller renders nothing).
 *
 * Range is half-open: `[start, end)` — the same convention the compositor uses.
 * Hoops are zero-indexed in build order (same as {@link buildPixelModel}'s inner loop).
 */
export function getHoopPixelRange(
  model: PixelModel,
  drumId: string,
  hoopIndex: number,
): { start: number; end: number } | null {
  const drum = model.drumById.get(drumId);
  if (!drum) return null;
  if (hoopIndex < 0 || hoopIndex >= drum.hoopCount) return null;
  const start = drum.pixelStart + hoopIndex * drum.pixelsPerHoop;
  return { start, end: start + drum.pixelsPerHoop };
}

function computeBounds(pixels: Pixel[]): Bounds {
  if (pixels.length === 0) {
    const zero = { x: 0, y: 0, z: 0 };
    return { min: zero, max: { ...zero }, center: { ...zero }, size: 0 };
  }
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pixels) {
    min.x = Math.min(min.x, p.world.x);
    min.y = Math.min(min.y, p.world.y);
    min.z = Math.min(min.z, p.world.z);
    max.x = Math.max(max.x, p.world.x);
    max.y = Math.max(max.y, p.world.y);
    max.z = Math.max(max.z, p.world.z);
  }
  const center: Vec3 = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
  return { min, max, center, size };
}
