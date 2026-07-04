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

/** An ordered run of hoops on a drum, carried on a single data line, in patch order. */
export const outputSegmentSchema = z.object({
  drumId: z.string().min(1),
  /** Inclusive hoop range carried on this segment, in patch order. */
  hoopStart: z.number().int().nonnegative(),
  hoopEnd: z.number().int().nonnegative(),
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
});

export const kitSchema = z.object({
  version: z.number().int().default(1),
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
export type KitConfig = z.infer<typeof kitSchema>;

/** Parse + validate raw kit JSON, applying defaults. Throws ZodError on invalid input. */
export function parseKit(raw: unknown): KitConfig {
  return kitSchema.parse(raw);
}

/** Resolve the effective hoop count for a drum (per-drum override or global). */
export function drumHoopCount(kit: KitConfig, drum: DrumConfig): number {
  return drum.hoopCount ?? kit.global.hoopCount;
}

/** Resolve the effective LED density for a drum (per-drum override or global). */
export function drumDensity(kit: KitConfig, drum: DrumConfig): number {
  return drum.ledDensityPxPerM ?? kit.global.ledDensityPxPerM;
}
