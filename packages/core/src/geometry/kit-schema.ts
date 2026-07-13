import { z } from 'zod';
import { eulerXYZApply } from './euler';

/** A 3D vector in millimetres (kit space). */
export const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const drumSchema = z.object({
  id: z.string().min(1),
  label: z.string().default(''),
  color: z.string().default('#ffffff'),
  diameterIn: z.number().positive(),
  /** Vertical gap between adjacent hoops, mm. */
  hoopSpacingMm: z.number().positive(),
  /** Per-drum override of the global hoop count. */
  hoopCount: z.number().int().positive().optional(),
  /** Per-drum override of the global LED density (px/m). */
  ledDensityPxPerM: z.number().positive().optional(),
  /** Literal pixels per hoop. When set, overrides the density computation entirely. */
  pixelsPerHoop: z.number().int().positive().optional(),
  /** Rotates where pixel index 0 sits around the hoop. */
  localSpinDeg: z.number().default(0),
  startAngleDeg: z.number().default(0),
  /** Physically flip the drum: a geometry-only reflection along its local Z (skins swap)
   * with the angular sweep negated so chase/wind direction reads correctly. Pixel index
   * order + DMX bytes are unchanged — flip never re-patches hardware (see buildPixelModel). */
  flip: z.boolean().optional(),
  /** Drum position in world space (mm): the drum's GEOMETRIC CENTRE — the midpoint of the
   * hoop stack (B3). Flip rotates the drum about this point in place, so `origin` (hence the
   * drum's world position) is invariant to flip; only orientation changes. Pre-B3 kits stored
   * `origin` at the first hoop and are shifted to this convention by {@link migrateKit}. The
   * radial/3D effect (hit) origin is derived separately as the first-hoop centre in
   * {@link buildPixelModel} — it is NOT this point. */
  origin: vec3Schema,
  rotation: vec3Schema,
});

/** An ordered run of hoops on a drum, carried on a single data line, in patch order.
 *  Hoop indices are **1-based** (A1): the first hoop of a drum is hoop 1. Pre-A1 project
 *  files stored 0-based ranges and are shifted +1 by {@link migrateKit} on load. */
export const outputSegmentSchema = z.object({
  drumId: z.string().min(1),
  /** Inclusive hoop range carried on this segment (1-based), in patch order. */
  hoopStart: z.number().int().positive(),
  hoopEnd: z.number().int().positive(),
});

/**
 * One physical data line out of a controller port (e.g. a PixLite output drives two
 * data lines — Data + repurposed Clock). An ordered run of hoop segments; pixels pack
 * channel-dense within it. An optional `startUniverse` snaps this line to that
 * universe's channel 0 — a deliberate gap; absent → it continues dense from the cursor.
 */
export const dataLineSchema = z.object({
  id: z.string().min(1),
  startUniverse: z.number().int().nonnegative().optional(),
  segments: z.array(outputSegmentSchema).min(1),
});

/** Inner object schema for a physical controller output (one PixLite port): ordered
    data lines. `startUniverse` (optional) snaps the whole port to a universe boundary;
    absent → it packs dense/contiguous with the preceding output. */
const outputObjectSchema = z.object({
  id: z.string().min(1),
  startUniverse: z.number().int().nonnegative().optional(),
  channelsPerPixel: z.number().int().positive().default(3),
  dataLines: z.array(dataLineSchema).min(1),
});

/**
 * A physical controller output. Back-compat: a legacy output carrying bare `segments`
 * (the pre-data-line shape that live persistence may have written) is transparently
 * wrapped as a single implicit data line `${id}:dl0` so old saved projects never crash.
 */
export const outputSchema = z.preprocess((raw) => {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    !('dataLines' in raw) &&
    'segments' in raw
  ) {
    const { segments, ...rest } = raw as Record<string, unknown>;
    const id = typeof (rest as { id?: unknown }).id === 'string' ? (rest as { id: string }).id : 'output';
    return { ...rest, dataLines: [{ id: `${id}:dl0`, segments }] };
  }
  return raw;
}, outputObjectSchema);

export const kitGlobalSchema = z.object({
  ledDensityPxPerM: z.number().positive().default(60),
  hoopCount: z.number().int().positive().default(4),
  defaultHoopSpacingMm: z.number().positive().default(50),
  /** Max pixels a single physical output may carry (Advatek PixLite ≈ 304). */
  maxPixelsPerOutput: z.number().int().positive().default(304),
  /** Kit-wide mirror: a geometry-only FINAL world-space reflection applied to every pixel
   * (positions + tangents/normals) in buildPixelModel. 'x' negates world X, 'y' negates
   * world Y, 'none' is identity. Drums keep their identities — only coordinates reflect.
   * Pixel index order + DMX bytes are unchanged; a mirror never re-patches hardware. */
  mirror: z.enum(['none', 'x', 'y']).default('none'),
  /** Advatek PixLite **expanded output mode** (B2). OFF = normal: the {@link
   * PIXLITE_PHYSICAL_OUTPUTS} physical ports ARE the logical outputs. ON = expanded: each
   * physical port n exposes two logical outputs (2n-1 and 2n), for double the count — see
   * {@link logicalOutputCount} / {@link logicalOutputsForPhysical}. Purely hardware config,
   * so it lives beside {@link kitGlobalSchema.maxPixelsPerOutput} (also Advatek), NOT on the
   * network-adoption `controller` record. New kits default OFF; kits predating this flag
   * (version < 3) migrate to ON so an established rig keeps its expanded wiring. */
  expanded: z.boolean().default(false),
});

/**
 * Current kit schema version. History:
 *  - 1 → 2 (A1): hoop indexing became 1-based; a v1/version-absent kit stores 0-based hoop
 *    ranges and is shifted +1 by {@link migrateKit} before parse.
 *  - 2 → 3 (B2): the Advatek `expanded` output flag was added; a kit predating it (v < 3)
 *    is an established rig and migrates to `expanded: true`. New kits are written at this
 *    version with `expanded: false`.
 *  - 3 → 4 (B3): `DrumConfig.origin` became the drum's GEOMETRIC CENTRE (midpoint of the hoop
 *    stack) instead of the first hoop. A kit predating this (v < 4) has each drum's stored
 *    `origin` shifted along its local Z by half the hoop-stack height so the drum does NOT move
 *    on screen — the origin convention changes, not the geometry (migrate the data, not the drums).
 */
export const CURRENT_KIT_VERSION = 4;

export const kitSchema = z.object({
  version: z.number().int().default(CURRENT_KIT_VERSION),
  units: z.literal('mm').default('mm'),
  global: kitGlobalSchema,
  drums: z.array(drumSchema).min(1),
  /** Physical-output topology. Optional: when absent, a flat single-output map is derived. */
  outputs: z.array(outputSchema).default([]),
});

export type Vec3Config = z.infer<typeof vec3Schema>;
export type DrumConfig = z.infer<typeof drumSchema>;
export type OutputConfig = z.infer<typeof outputSchema>;
export type DataLineConfig = z.infer<typeof dataLineSchema>;
export type OutputSegment = z.infer<typeof outputSegmentSchema>;
export type KitGlobalConfig = z.infer<typeof kitGlobalSchema>;
export type KitConfig = z.infer<typeof kitSchema>;

/**
 * Shift one raw output object's hoop ranges +1, handling BOTH the current
 * (`dataLines[].segments[]`) and the legacy (`segments[]`) shapes. Pure on a shallow
 * clone; unknown/foreign shapes pass through untouched so a malformed file still reaches
 * the schema (which reports it) rather than throwing here.
 */
function shiftOutputHoops(output: unknown): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output;
  const bumpSeg = (seg: unknown): unknown => {
    if (!seg || typeof seg !== 'object' || Array.isArray(seg)) return seg;
    const s = seg as Record<string, unknown>;
    const next = { ...s };
    if (typeof s.hoopStart === 'number') next.hoopStart = s.hoopStart + 1;
    if (typeof s.hoopEnd === 'number') next.hoopEnd = s.hoopEnd + 1;
    return next;
  };
  const o = output as Record<string, unknown>;
  const next: Record<string, unknown> = { ...o };
  if (Array.isArray(o.dataLines)) {
    next.dataLines = o.dataLines.map((dl) => {
      if (!dl || typeof dl !== 'object' || Array.isArray(dl)) return dl;
      const line = dl as Record<string, unknown>;
      return Array.isArray(line.segments)
        ? { ...line, segments: line.segments.map(bumpSeg) }
        : line;
    });
  }
  if (Array.isArray(o.segments)) next.segments = o.segments.map(bumpSeg); // legacy bare-segments shape
  return next;
}

/** True when `v` is a plain `{x,y,z}` number triple (a raw pre-parse Vec3). */
function isRawVec3(v: unknown): v is { x: number; y: number; z: number } {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as { x?: unknown }).x === 'number' &&
    typeof (v as { y?: unknown }).y === 'number' &&
    typeof (v as { z?: unknown }).z === 'number'
  );
}

/**
 * B3 (v3 → v4): shift ONE raw drum's stored `origin` from the first-hoop convention to the
 * geometric-centre convention, keeping the drum's world position unchanged.
 *
 * The stack's half-height along local Z is `halfStack = (hoopCount - 1) * hoopSpacingMm / 2`.
 * Pre-B3, hoop 1 sat at the origin (local z = 0) and the stack extended +Z (flip: −Z); B3
 * re-centres the stack on the origin, so hoop 1 moves to local z = −halfStack (flip: +halfStack).
 * To keep every pixel's world position fixed, the origin must move by the world delta of that
 * re-centring: `+R·(0,0,halfStack)` unflipped, `−R·(0,0,halfStack)` flipped (R = the drum's
 * intrinsic-XYZ rotation). `hoopCount` falls back to the kit global (default 4) and rotation to
 * identity, exactly as the schema resolves them. A drum whose stack height isn't derivable
 * (no numeric `hoopSpacingMm`/`origin`) is returned untouched — schema validation then reports it.
 */
function shiftDrumOriginToCentre(drum: unknown, globalHoopCount: number): unknown {
  if (!drum || typeof drum !== 'object' || Array.isArray(drum)) return drum;
  const d = drum as Record<string, unknown>;
  if (!isRawVec3(d.origin) || typeof d.hoopSpacingMm !== 'number') return drum;
  const hoopCount = typeof d.hoopCount === 'number' ? d.hoopCount : globalHoopCount;
  const halfStack = ((hoopCount - 1) * d.hoopSpacingMm) / 2;
  const rotation = isRawVec3(d.rotation) ? d.rotation : { x: 0, y: 0, z: 0 };
  const sign = d.flip === true ? -1 : 1;
  const shift = eulerXYZApply({ x: 0, y: 0, z: sign * halfStack }, rotation);
  return {
    ...d,
    origin: { x: d.origin.x + shift.x, y: d.origin.y + shift.y, z: d.origin.z + shift.z },
  };
}

/**
 * Migrate a RAW (pre-parse) kit object across schema versions. Steps are CUMULATIVE — a kit
 * enters at its stored version and every later step runs in order:
 *  - **< 2 (A1):** 0-based hoop ranges are shifted **+1** to the 1-based convention (every
 *    `OutputSegment.hoopStart/hoopEnd`, in both the current and legacy bare-`segments` shape).
 *  - **< 3 (B2):** the kit predates the Advatek `expanded` flag → it's an established rig, so
 *    `global.expanded` defaults **ON** (an explicit value is respected). New kits, written at
 *    v3, carry `expanded: false`.
 *  - **< 4 (B3):** each drum's stored `origin` is shifted from the first-hoop convention to the
 *    geometric-centre convention ({@link shiftDrumOriginToCentre}) so the drum does **not** move on
 *    screen — only the origin's meaning changes.
 * The version is stamped to {@link CURRENT_KIT_VERSION} last. Idempotent — a kit already at the
 * current version is returned untouched (same reference). Runs BEFORE the schema parse, so
 * pre-migration files still load.
 */
export function migrateKit(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const kit = raw as Record<string, unknown>;
  const version = typeof kit.version === 'number' ? kit.version : 1;
  if (version >= CURRENT_KIT_VERSION) return raw;
  const migrated: Record<string, unknown> = { ...kit };

  // v1 → v2 (A1): shift 0-based hoop ranges to 1-based.
  if (version < 2 && Array.isArray(kit.outputs)) {
    migrated.outputs = kit.outputs.map(shiftOutputHoops);
  }

  // v2 → v3 (B2): an established rig defaults to Advatek expanded mode ON. Only injected into
  // an existing `global` object (a kit missing `global` stays invalid, as before).
  if (
    version < 3 &&
    migrated.global &&
    typeof migrated.global === 'object' &&
    !Array.isArray(migrated.global)
  ) {
    const global = migrated.global as Record<string, unknown>;
    if (global.expanded === undefined) migrated.global = { ...global, expanded: true };
  }

  // v3 → v4 (B3): re-anchor each drum's `origin` from the first hoop to the geometric centre,
  // preserving world position (migrate the data, not the drums). Global hoop-count fallback
  // matches the schema default so per-drum stack height resolves exactly as at parse time.
  if (version < 4 && Array.isArray(kit.drums)) {
    const g = migrated.global;
    const globalHoopCount =
      g && typeof g === 'object' && !Array.isArray(g) && typeof (g as Record<string, unknown>).hoopCount === 'number'
        ? ((g as Record<string, unknown>).hoopCount as number)
        : 4;
    migrated.drums = kit.drums.map((drum) => shiftDrumOriginToCentre(drum, globalHoopCount));
  }

  migrated.version = CURRENT_KIT_VERSION;
  return migrated;
}

/** Parse + validate raw kit JSON, applying version migrations + defaults. Throws ZodError
 *  on invalid input. */
export function parseKit(raw: unknown): KitConfig {
  return kitSchema.parse(migrateKit(raw));
}

/** Resolve the effective hoop count for a drum (per-drum override or global). */
export function drumHoopCount(kit: KitConfig, drum: DrumConfig): number {
  return drum.hoopCount ?? kit.global.hoopCount;
}

/** Resolve the effective LED density for a drum (per-drum override or global). */
export function drumDensity(kit: KitConfig, drum: DrumConfig): number {
  return drum.ledDensityPxPerM ?? kit.global.ledDensityPxPerM;
}

/**
 * Advatek PixLite A4 physical output ports. In normal mode these ARE the logical outputs; in
 * expanded mode each physical port n exposes two logical outputs (2n-1 and 2n) — see
 * {@link kitGlobalSchema.expanded}.
 */
export const PIXLITE_PHYSICAL_OUTPUTS = 4;

/**
 * How many logical outputs a controller exposes for this kit: {@link PIXLITE_PHYSICAL_OUTPUTS}
 * × 2 (= 8) when expanded, else the physical count (4). This is the Advatek device's port
 * ceiling, independent of how many `kit.outputs` are actually authored.
 */
export function logicalOutputCount(kit: KitConfig): number {
  return kit.global.expanded ? PIXLITE_PHYSICAL_OUTPUTS * 2 : PIXLITE_PHYSICAL_OUTPUTS;
}

/**
 * The logical output number(s) a **1-based** physical port maps to. Expanded (Advatek): port
 * n → `[2n-1, 2n]`; normal: port n → `[n]`. Pure — the canonical mapping for downstream
 * consumers (C1 inspector, routing) without embedding the rule at each call site.
 */
export function logicalOutputsForPhysical(physicalPort: number, expanded: boolean): number[] {
  return expanded ? [physicalPort * 2 - 1, physicalPort * 2] : [physicalPort];
}
