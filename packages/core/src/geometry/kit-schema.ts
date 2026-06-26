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
  origin: vec3Schema,
  rotation: vec3Schema,
  /** Origin (local mm) used by radial/3D effects; defaults to drum centre. */
  effectOriginLocal: vec3Schema.default({ x: 0, y: 0, z: 0 }),
});

/** One physical controller output (PixLite port): an ordered run of hoop segments. */
export const outputSegmentSchema = z.object({
  drumId: z.string().min(1),
  /** Inclusive hoop range carried on this output, in patch order. */
  hoopStart: z.number().int().nonnegative(),
  hoopEnd: z.number().int().nonnegative(),
});

export const outputSchema = z.object({
  id: z.string().min(1),
  /** First DMX universe this output occupies. */
  startUniverse: z.number().int().nonnegative().default(0),
  channelsPerPixel: z.number().int().positive().default(3),
  segments: z.array(outputSegmentSchema).min(1),
});

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
