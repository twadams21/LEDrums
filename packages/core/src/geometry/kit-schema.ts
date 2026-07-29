import { z } from 'zod';
import { CURRENT_KIT_VERSION, assertKitVersion } from './kit-migrations';

/** A 3D vector in millimetres (kit space). */
export const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

/**
 * One hoop on a drum, FIRST-CLASS (B4): its own literal pixel count and a `reverse` flag.
 * `pixelCount` is authoritative for that hoop (hoops within a drum MAY differ). `reverse` flips
 * the pixel INDEX→angular-position mapping WITHIN this hoop only — the correction for a strip
 * wired backwards (data enters the far end); pixel ids/DMX order are untouched, only which
 * physical position each emitted pixel occupies (see buildPixelModel). Defaults `reverse: false`.
 */
export const hoopConfigSchema = z.object({
  pixelCount: z.number().int().positive(),
  reverse: z.boolean().default(false),
});

export const drumSchema = z.object({
  id: z.string().min(1),
  label: z.string().default(''),
  color: z.string().default('#ffffff'),
  diameterIn: z.number().positive(),
  /** Vertical gap between adjacent hoops, mm. */
  hoopSpacingMm: z.number().positive(),
  /**
   * Per-hoop configuration (B4) — the SINGLE SOURCE OF TRUTH per hoop when present: each entry
   * carries its own {@link hoopConfigSchema.pixelCount} + `reverse`, and the array length IS the
   * drum's hoop count (overriding `hoopCount`/density resolution). Every hoop is a first-class
   * object (matching the v2 patch graph where a hoop is a selectable node) — NOT a sparse
   * override map. Optional: a drum without `hoops` resolves the uniform way
   * (`pixelsPerHoop`/density × `hoopCount`) — still a supported authoring shape, not a legacy
   * one, since the v<5 expander was deleted with the ladder (see {@link CURRENT_KIT_VERSION}). */
  hoops: z.array(hoopConfigSchema).min(1).optional(),
  /** Per-drum override of the global hoop count. Ignored when `hoops` is set (its length wins). */
  hoopCount: z.number().int().positive().optional(),
  /** Per-drum override of the global LED density (px/m). Ignored when `hoops` is set. */
  ledDensityPxPerM: z.number().positive().optional(),
  /** Uniform pixels-per-hoop. When set (and `hoops` absent), overrides the density
   *  computation entirely. Superseded by per-hoop `hoops[].pixelCount`, which wins whenever
   *  both are present; kept because a uniform drum is still a valid authoring shape. */
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
   * drum's world position) is invariant to flip; only orientation changes. Pre-B3 (v<4) kits
   * stored `origin` at the first hoop; such a file is now REJECTED at load, not shifted. The
   * radial/3D effect (hit) origin is derived separately as the first-hoop centre in
   * {@link buildPixelModel} — it is NOT this point. */
  origin: vec3Schema,
  rotation: vec3Schema,
}).superRefine((drum, ctx) => {
  // (b) hoops[] is the authoritative hoop count (see {@link drumHoopCount}). When a drum ALSO
  // carries the legacy `hoopCount`, the two must AGREE — a divergent pair is a latent stored
  // inconsistency (resolution is unambiguous, `hoops.length` wins, but the data lies). This is
  // VALIDATION ONLY: it never resizes `hoops[]` nor rewrites `hoopCount`. The *editing* rule
  // (does changing `hoopCount` resize `hoops[]`?) is a separate decision made where the mutation
  // happens, NOT here. A drum with only one of the two (or neither) is always accepted.
  if (drum.hoops && drum.hoopCount !== undefined && drum.hoopCount !== drum.hoops.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['hoopCount'],
      message: `hoopCount (${drum.hoopCount}) must equal hoops.length (${drum.hoops.length}) when both are set`,
    });
  }
});

/** A maximal run of *consecutive* hoops on one drum within an output's chain, in chain
 *  (transmit) order — the RANGE-COMPRESSED form of the explicit `Output → Hoop → Hoop …`
 *  daisy-chain (D1): a run extends while the next wired hoop is the same drum's very next
 *  hoop, and breaks (new segment) on any drum change or non-`+1` step. So `segments` in
 *  order, each expanded `hoopStart..hoopEnd` ASCENDING, reconstitutes the exact wired chain.
 *  Hoop indices are **1-based** (A1): the first hoop of a drum is hoop 1. Pre-A1 (v1) files
 *  stored 0-based ranges; such a file is now REJECTED at load, not shifted. */
export const outputSegmentSchema = z.object({
  drumId: z.string().min(1),
  /** Inclusive hoop range carried on this segment (1-based), in chain order. */
  hoopStart: z.number().int().positive(),
  hoopEnd: z.number().int().positive(),
});

/**
 * Wiring order of the R/G/B channels for a strip (e.g. `GRB` for WS2812). The SINGLE SOURCE
 * OF TRUTH for these six permutations (project-schema re-imports this). Lives in the geometry
 * layer because it is now a PER-OUTPUT attribute (B5) carried on {@link outputObjectSchema}.
 */
export const rgbOrderSchema = z.enum(['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR']);
export type RgbOrder = z.infer<typeof rgbOrderSchema>;

/** Inner object schema for a physical controller output = **exactly one data run** (D1: the
    intermediate Data Line was removed — an Output now carries its hoop chain directly as an
    ordered `segments` list, the range-compressed `Output → Hoop → Hoop …` wire chain).
    `startUniverse` (optional) snaps this run to a universe boundary; absent → it packs
    dense/contiguous with the preceding output. */
const outputObjectSchema = z.object({
  id: z.string().min(1),
  startUniverse: z.number().int().nonnegative().optional(),
  channelsPerPixel: z.number().int().positive().default(3),
  /** Wiring RGB order for THIS output's strips (B5). Optional: absent → the packer falls back
   * to a sensible default (the controller-level order today, until C4 makes it a per-output
   * control). Moved off the controller so different data runs may differ; the v<6 project-layer
   * seeder that back-filled it was deleted with the ladder. */
  rgbOrder: rgbOrderSchema.optional(),
  /** The output's ordered hoop chain, range-compressed (D1). May be EMPTY: outputs are a fixed
   *  set of physical controller ports (4 normal / 8 expanded, {@link logicalOutputCount}), so an
   *  unwired port is a first-class, persisted output awaiting wiring — {@link reconcileOutputs}
   *  grows/shrinks the port count to the controller mode, seeding new ports empty. An empty
   *  output is inert downstream (buildDmxMap emits nothing for it; the patch graph shows it as an
   *  "unwired" node), never a crash. */
  segments: z.array(outputSegmentSchema),
});

/**
 * A physical controller output. DEFENCE IN DEPTH: an output carrying the pre-D1
 * `dataLines: [{ segments }]` shape is transparently flattened — its data lines' segments
 * concatenated in order into one `segments` chain — so such a payload never crashes.
 *
 * This is no longer a migration path. A genuine v<7 file is REJECTED before parse (the v7
 * floor, {@link assertKitVersion}), so the only payload that can reach this preprocess is one
 * CLAIMING v7 while carrying the old shape — i.e. hand-edited or corrupt. Note the fallback
 * concatenates into ONE output where the deleted v6→7 migration SPLIT into one output per
 * line, so the recovered wiring is not what a real v6 file would have produced; it is a crash
 * guard, not a fidelity guarantee.
 */
export const outputSchema = z.preprocess((raw) => {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    !('segments' in raw) &&
    Array.isArray((raw as { dataLines?: unknown }).dataLines)
  ) {
    const { dataLines, ...rest } = raw as Record<string, unknown>;
    const segments = (dataLines as unknown[]).flatMap((dl) =>
      dl && typeof dl === 'object' && Array.isArray((dl as { segments?: unknown }).segments)
        ? ((dl as { segments: unknown[] }).segments)
        : [],
    );
    return { ...rest, segments };
  }
  return raw;
}, outputObjectSchema);

export const kitGlobalSchema = z.object({
  ledDensityPxPerM: z.number().positive().default(60),
  hoopCount: z.number().int().positive().default(4),
  defaultHoopSpacingMm: z.number().positive().default(50),
  /** Max pixels a single physical output may carry (Advatek PixLite ≈ 304). */
  maxPixelsPerOutput: z.number().int().positive().default(304),
  /** Advatek PixLite **expanded output mode** (B2). OFF = normal: the {@link
   * PIXLITE_PHYSICAL_OUTPUTS} physical ports ARE the logical outputs. ON = expanded: each
   * physical port n exposes two logical outputs (2n-1 and 2n), for double the count — see
   * {@link logicalOutputCount} / {@link logicalOutputsForPhysical}. Purely hardware config,
   * so it lives beside {@link kitGlobalSchema.maxPixelsPerOutput} (also Advatek), NOT on the
   * network-adoption `controller` record. New kits default OFF; kits predating this flag
   * (version < 3) predate the flag entirely and are now rejected at load rather than
   * defaulted ON. */
  expanded: z.boolean().default(false),
});

/** A 2D point in patch-graph canvas space (px). */
export const vec2Schema = z.object({ x: z.number(), y: z.number() });

/**
 * Manual patch-graph node layout (D1): a canonical `nodeId → {x,y}` arrangement of the graph
 * canvas, a property of the PHYSICAL kit graph (server-authoritative, one arrangement stable
 * across shows + synced across clients). Auto-layout was dropped — the graph never re-flows on
 * its own; positions are user-controlled and persisted here. Optional/sparse: a node absent from
 * the map gets a one-time DETERMINISTIC seed position from the editor, then is frozen (written
 * back here). Keyed by patch-graph node id (`output:*`, `hoop:*`, `drum:*`, `trigger:*`, zone
 * container ids) — a superset of the kit's own ids, so it lives on the kit (travels with a patch)
 * rather than in per-show authored state. Absent is always valid.
 */
export const nodeLayoutSchema = z.record(z.string(), vec2Schema);

export const kitSchema = z.object({
  version: z.number().int().default(CURRENT_KIT_VERSION),
  units: z.literal('mm').default('mm'),
  global: kitGlobalSchema,
  drums: z.array(drumSchema).min(1),
  /** Physical-output topology. Optional: when absent, a flat single-output map is derived. */
  outputs: z.array(outputSchema).default([]),
  /** Manual patch-graph canvas layout (D1) — see {@link nodeLayoutSchema}. Optional; sparse. */
  nodeLayout: nodeLayoutSchema.optional(),
});

export type Vec3Config = z.infer<typeof vec3Schema>;
export type Vec2Config = z.infer<typeof vec2Schema>;
export type NodeLayout = z.infer<typeof nodeLayoutSchema>;
export type HoopConfig = z.infer<typeof hoopConfigSchema>;
export type DrumConfig = z.infer<typeof drumSchema>;
export type OutputConfig = z.infer<typeof outputSchema>;
export type OutputSegment = z.infer<typeof outputSegmentSchema>;
export type KitGlobalConfig = z.infer<typeof kitGlobalSchema>;
export type KitConfig = z.infer<typeof kitSchema>;

/** Parse + validate raw kit JSON, applying schema defaults. Throws ZodError on invalid input,
 *  and a plain Error on a kit older than the v7 floor — see {@link assertKitVersion}. */
export function parseKit(raw: unknown): KitConfig {
  return kitSchema.parse(assertKitVersion(raw));
}
