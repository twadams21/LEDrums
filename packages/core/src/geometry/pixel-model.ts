import { DEG2RAD, type Vec3 } from '../math';
import { eulerXYZApply, localToWorld } from './euler';
import {
  drumDensity,
  drumHoopCount,
  type DrumConfig,
  type HoopConfig,
  type KitConfig,
} from './kit-schema';

/** One hoop's resolved render attributes: its pixel count and whether the strip is reversed. */
interface ResolvedHoop {
  pixelCount: number;
  reverse: boolean;
}
import { classifyZone, type Zone } from './zones';

const MM_PER_INCH = 25.4;

/**
 * Kit-wide mirror (S11): a GEOMETRY-ONLY final reflection in WORLD space. 'x' negates the
 * world X component, 'y' negates world Y, 'none' is identity. Applied identically to positions
 * AND to direction vectors (tangent/normal) so orientation stays consistent under the mirror.
 * It composes cleanly on top of S10's per-drum flip (already baked into local→world) and never
 * touches pixel index order or the DMX byte stream — a mirror never re-patches hardware.
 */
function reflectWorld(v: Vec3, mirror: 'none' | 'x' | 'y'): Vec3 {
  if (mirror === 'x') return { x: -v.x, y: v.y, z: v.z };
  if (mirror === 'y') return { x: v.x, y: -v.y, z: v.z };
  return v;
}

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
  /** Pixels in the FIRST hoop — equals the uniform per-hoop count when all hoops match (B4:
   *  hoops MAY differ, so this is lossy for a mixed drum; use {@link hoopPixelCounts} for the
   *  authoritative per-hoop counts). Kept for back-compat with uniform-count consumers. */
  pixelsPerHoop: number;
  /** Authoritative per-hoop pixel counts (B4), one entry per hoop, length = {@link hoopCount}.
   *  Hoop ranges are the running prefix sum from {@link pixelStart} — see {@link drumHoopPixelRange}. */
  hoopPixelCounts: number[];
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
 * Resolve a drum's hoops (B4). First-class `hoops[]` is authoritative when present — each hoop
 * carries its own `pixelCount` + `reverse`, and the array length IS the hoop count. Otherwise
 * fall back to the legacy UNIFORM resolution: `drumHoopCount` hoops, each `pixelsPerHoop(kit,drum)`
 * pixels, none reversed. This is the single seam every count/reverse decision flows through.
 */
function resolveDrumHoops(kit: KitConfig, drum: DrumConfig): ResolvedHoop[] {
  if (drum.hoops && drum.hoops.length > 0) {
    return drum.hoops.map((h) => ({ pixelCount: h.pixelCount, reverse: h.reverse }));
  }
  const perHoop = pixelsPerHoop(kit, drum);
  return Array.from({ length: drumHoopCount(kit, drum) }, () => ({ pixelCount: perHoop, reverse: false }));
}

/**
 * SF1: materialize a drum's `hoops[]` as first-class {@link HoopConfig} objects, using the EXACT
 * per-hoop counts + reverse flags {@link buildPixelModel} already resolves via {@link resolveDrumHoops}
 * (the single render seam). A density-resolved drum (no stored `hoops[]`) yields `drumHoopCount`
 * hoops, each `{ pixelCount: pixelsPerHoop(kit,drum), reverse: false }` — identical to what the
 * renderer built, so stamping it onto the drum keeps the pixel model + DMX map BYTE-IDENTICAL. A
 * drum that already carries a non-empty `hoops[]` yields those hoops verbatim (idempotent).
 *
 * This is the shared helper the per-hoop write paths (client optimistic `applyHoopConfig`, server
 * `Engine.setHoopConfig` + `VoiceEngineHost.setHoopConfig`) lazily materialize through, so per-hoop
 * editing works on ANY reachable drum shape and all three paths materialize identically (mutation
 * parity — no client/server divergence).
 */
export function materializeHoops(kit: KitConfig, drum: DrumConfig): HoopConfig[] {
  return resolveDrumHoops(kit, drum);
}

/**
 * Build the full 3D pixel model from a validated kit config (plan U2).
 *
 * Pixels are emitted grouped by drum, then hoop, then angular index — a stable
 * order the frame buffer and DMX map both rely on. Hoops are circles in the drum's
 * local XY plane stacked along local Z, CENTRED on the origin (B3): the stack spans
 * [−halfStack, +halfStack] so the drum's `origin` is its geometric centre. World position
 * applies the drum's intrinsic XYZ rotation then its origin translation.
 */
export function buildPixelModel(kit: KitConfig): PixelModel {
  const pixels: Pixel[] = [];
  const drums: DrumInfo[] = [];
  const drumById = new Map<string, DrumInfo>();

  // Kit-global mirror is a FINAL world-space reflection (S11), applied to every pixel's world
  // position + direction vectors after localToWorld. Read once — it's the same for all drums.
  const mirror = kit.global.mirror;

  let id = 0;
  for (const drum of kit.drums) {
    const hoops = resolveDrumHoops(kit, drum);
    const hoopCount = hoops.length;
    const radiusMm = (drum.diameterIn * MM_PER_INCH) / 2;
    const spacing = drum.hoopSpacingMm;
    // Half the hoop-stack height along local Z. The stack is centred on the origin (B3), so
    // hoop h sits at `h*spacing - halfStack` — hoop 1 at −halfStack, the last hoop at +halfStack.
    const halfStack = ((hoopCount - 1) * spacing) / 2;
    const pixelStart = id;

    for (let h = 0; h < hoopCount; h++) {
      const perHoop = hoops[h]!.pixelCount;
      const reverse = hoops[h]!.reverse;
      // Flip is a GEOMETRY-ONLY transform that ROTATES the drum in place about its centre: it
      // reflects the centred hoop stack along local Z (skins swap) and negates the intrinsic
      // angular sweep (chase/wind direction) BELOW. Because the stack is centred, the drum's
      // world footprint (and its origin) is invariant to flip — only orientation changes. Hoop
      // indices and pixel INDEX order are untouched, so the frame buffer and DMX map stay
      // byte-identical with flip on/off; a flip never re-patches hardware.
      const baseZ = h * spacing - halfStack;
      const localZ = drum.flip ? -baseZ : baseZ;
      const normHoop = hoopCount > 1 ? h / (hoopCount - 1) : 0;
      const zone = classifyZone(normHoop);
      const segLen = (Math.PI * 2 * radiusMm) / perHoop;
      for (let i = 0; i < perHoop; i++) {
        // Per-hoop reverse (B4): a backward-wired strip enters data at the FAR end, so emission
        // slot i (its id / indexInHoop, and hence its DMX byte position) maps to the angular
        // position of slot (perHoop-1-i). Only the index→position mapping flips — ids stay
        // contiguous, so DMX packing and hoop ranges are untouched. reverse:false ⇒ slot === i
        // ⇒ byte-identical output (parity). Independent of `flip` (which negates winding sense).
        const slot = reverse ? perHoop - 1 - i : i;
        // Negate the angular sweep BEFORE the start/spin offsets so a physically-flipped
        // drum winds the opposite way while pixel 0 stays put.
        const sweepDeg = (360 * slot) / perHoop;
        const angleDeg =
          drum.startAngleDeg + drum.localSpinDeg + (drum.flip ? -sweepDeg : sweepDeg);
        const a = angleDeg * DEG2RAD;
        const local: Vec3 = {
          x: radiusMm * Math.cos(a),
          y: radiusMm * Math.sin(a),
          z: localZ,
        };
        // Position in world space, then the kit mirror's final world-space reflection.
        const world = reflectWorld(localToWorld(local, drum.rotation, drum.origin), mirror);
        // Tangent (along hoop) and outward radial normal, rotated into world space then
        // reflected identically so orientation stays consistent under the mirror.
        const tangent = reflectWorld(
          eulerXYZApply({ x: -Math.sin(a), y: Math.cos(a), z: 0 }, drum.rotation),
          mirror,
        );
        const normal = reflectWorld(
          eulerXYZApply({ x: Math.cos(a), y: Math.sin(a), z: 0 }, drum.rotation),
          mirror,
        );
        const wrappedAngle = ((angleDeg % 360) + 360) % 360;
        pixels.push({
          id,
          drumId: drum.id,
          // Hoop + pixel-within-hoop labels are 1-based (A1): first hoop = 1, first pixel = 1.
          // The loop vars h/i stay 0-based offsets above so geometry is byte-identical.
          hoopIndex: h + 1,
          indexInHoop: i + 1,
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

    const hoopPixelCounts = hoops.map((h) => h.pixelCount);
    const info: DrumInfo = {
      drumId: drum.id,
      label: drum.label,
      color: drum.color,
      pixelStart,
      pixelCount: id - pixelStart,
      // First hoop's count — the uniform value when all hoops match; authoritative per-hoop
      // counts live in `hoopPixelCounts` (B4). Empty drum can't occur (hoops.min(1)).
      pixelsPerHoop: hoopPixelCounts[0] ?? 0,
      hoopPixelCounts,
      hoopCount,
      radiusMm,
      // Effect/hit origin = the CENTRE OF THE FIRST HOOP (the skin) — where radial/3D effects
      // emanate from (B3). In the centred local frame the first hoop sits at local z = −halfStack
      // (flip: +halfStack), so the skin follows the drum when it's flipped. Reflected identically
      // to the pixel world positions so it stays consistent under the kit mirror.
      effectOriginWorld: reflectWorld(
        localToWorld(
          { x: 0, y: 0, z: drum.flip ? halfStack : -halfStack },
          drum.rotation,
          drum.origin,
        ),
        mirror,
      ),
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
 * Half-open `[start, end)` pixel-id range for one hoop on a drum, or `null` when the hoop is
 * out of range. Ranges are the running PREFIX SUM of {@link DrumInfo.hoopPixelCounts} from
 * `pixelStart` — correct for mixed per-hoop counts (B4), not just uniform drums. `hoopIndex` is
 * **1-based** (A1). The seam both {@link getHoopPixelRange} and the DMX map compute offsets from.
 */
export function drumHoopPixelRange(
  drum: DrumInfo,
  hoopIndex: number,
): { start: number; end: number } | null {
  if (hoopIndex < 1 || hoopIndex > drum.hoopCount) return null;
  let start = drum.pixelStart;
  for (let h = 0; h < hoopIndex - 1; h++) start += drum.hoopPixelCounts[h]!;
  return { start, end: start + drum.hoopPixelCounts[hoopIndex - 1]! };
}

/**
 * Return the contiguous pixel range for one hoop on a drum, or `null` when the
 * drum/hoop doesn't exist in the model (dangling targetId → caller renders nothing).
 *
 * Range is half-open: `[start, end)` — the same convention the compositor uses.
 * `hoopIndex` is **1-based** (A1): hoop 1 is the first hoop, matching {@link Pixel.hoopIndex}.
 */
export function getHoopPixelRange(
  model: PixelModel,
  drumId: string,
  hoopIndex: number,
): { start: number; end: number } | null {
  const drum = model.drumById.get(drumId);
  if (!drum) return null;
  return drumHoopPixelRange(drum, hoopIndex);
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
