import { z } from 'zod';

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
  origin: vec3Schema,
  rotation: vec3Schema,
  /** Origin (local mm) used by radial/3D effects; defaults to drum centre. */
  effectOriginLocal: vec3Schema.default({ x: 0, y: 0, z: 0 }),
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
});

/**
 * Current kit schema version. Bumped 1 → 2 by A1 when hoop indexing became 1-based:
 * a version-1 (or version-absent) kit stores 0-based hoop ranges and is shifted +1 by
 * {@link migrateKit} before parse. New kits are written at this version.
 */
export const CURRENT_KIT_VERSION = 2;

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

/**
 * Migrate a RAW (pre-parse) kit object across schema versions. Currently the only step is
 * the A1 hoop-index canonicalization: a kit at version < 2 (or with no version) stores
 * **0-based** hoop ranges, so every `OutputSegment.hoopStart/hoopEnd` is shifted **+1** to
 * the new 1-based convention and the version stamped to {@link CURRENT_KIT_VERSION}.
 * Idempotent — a kit already at the current version is returned untouched. Runs BEFORE the
 * schema parse (which now requires 1-based `positive()` ranges), so pre-A1 files still load.
 */
export function migrateKit(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const kit = raw as Record<string, unknown>;
  const version = typeof kit.version === 'number' ? kit.version : 1;
  if (version >= CURRENT_KIT_VERSION) return raw;
  const migrated: Record<string, unknown> = { ...kit, version: CURRENT_KIT_VERSION };
  if (Array.isArray(kit.outputs)) migrated.outputs = kit.outputs.map(shiftOutputHoops);
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
