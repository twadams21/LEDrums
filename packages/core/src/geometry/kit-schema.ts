import { z } from 'zod';
import { CURRENT_KIT_VERSION, migrateKit } from './kit-migrations';

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
   * override map. Optional for back-compat: a drum without `hoops` resolves the legacy uniform
   * way (`pixelsPerHoop`/density × `hoopCount`). The v<5 migrator expands legacy drums into an
   * explicit `hoops[]`. */
  hoops: z.array(hoopConfigSchema).min(1).optional(),
  /** Per-drum override of the global hoop count. Ignored when `hoops` is set (its length wins). */
  hoopCount: z.number().int().positive().optional(),
  /** Per-drum override of the global LED density (px/m). Ignored when `hoops` is set. */
  ledDensityPxPerM: z.number().positive().optional(),
  /** Legacy uniform pixels-per-hoop. When set (and `hoops` absent), overrides the density
   *  computation entirely. Superseded by per-hoop `hoops[].pixelCount`; kept for back-compat +
   *  as the migrator's input. */
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
 *  Hoop indices are **1-based** (A1): the first hoop of a drum is hoop 1. Pre-A1 project
 *  files stored 0-based ranges and are shifted +1 by {@link migrateKit} on load. */
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
   * control). Moved off the controller so different data runs may differ; the v<6 project
   * migrator seeds each existing output with the controller-level order it inherited. */
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
 * A physical controller output. Back-compat: a legacy output carrying the pre-D1
 * `dataLines: [{ segments }]` shape (that reached the schema un-migrated) is transparently
 * flattened — its data lines' segments concatenated in order into one `segments` chain — so
 * old saved payloads never crash. (The real v6→7 migration in {@link migrateKit} SPLITS a
 * multi-line output into one output per line, preserving output count; this preprocess is the
 * defensive single-output fallback for any stray un-migrated payload.)
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
   * (version < 3) migrate to ON so an established rig keeps its expanded wiring. */
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
 * rather than in per-show authored state. Absent is always valid (no migrator transform needed).
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

/** Parse + validate raw kit JSON, applying version migrations + defaults. Throws ZodError
 *  on invalid input. */
export function parseKit(raw: unknown): KitConfig {
  return kitSchema.parse(migrateKit(raw));
}

/** Resolve the effective hoop count for a drum. When `hoops[]` is present it is AUTHORITATIVE
 *  (B4 — `hoops.length` is the count the pixel model builds and `buildDmxMap` range-checks), so it
 *  wins over `hoopCount`/global; otherwise fall back to the per-drum override, then the kit global.
 *  Keeping this aligned with `buildPixelModel` is what makes routing-integrity's "a routing that
 *  passes here never throws in buildDmxMap" contract hold for first-class (divergent) drums. */
export function drumHoopCount(kit: KitConfig, drum: DrumConfig): number {
  return drum.hoops?.length ?? drum.hoopCount ?? kit.global.hoopCount;
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

/**
 * Force `kit.outputs` to be EXACTLY {@link logicalOutputCount} entries — the number of physical
 * controller ports the `expanded` mode exposes (4 normal / 8 expanded). Outputs are a static rig
 * shape driven solely by the controller toggle, NOT freely add/delete-able; this is the single
 * function that enforces the count so `kit.outputs.length` can never drift from the canonical
 * count (the drummer's 3-in-expanded corruption). Pure + deterministic (no id/rng):
 *
 * - **grow**: keep every existing output in order, then append empty ports (`segments: []`) with
 *   stable ids until the count is reached. An empty port is inert (buildDmxMap emits nothing) and
 *   shows as an "unwired" node — the user wires it, never creates it.
 * - **shrink**: keep the first `count` outputs in order, trim the surplus.
 * - **identity**: already the right length → returned unchanged (same array ref).
 *
 * Appended port ids are `output:<n>`, matching the patch graph's `outputId(index)` grammar and
 * minted as the LOWEST unused `output:<n>` not already claimed by a kept output — so a sparse
 * survivor set (e.g. `output:1,2,8` grown to 8) can never mint a duplicate id and stick the count
 * below target (the id-collision stuck-state defect). A pre-existing id is never rewritten (order +
 * identity of kept outputs preserved); every id in the returned kit is unique when the survivors are.
 */
export function reconcileOutputs(kit: KitConfig): KitConfig {
  const target = logicalOutputCount(kit);
  const current = kit.outputs;
  if (current.length === target) return kit;

  let outputs: OutputConfig[];
  if (current.length > target) {
    outputs = current.slice(0, target);
  } else {
    // Grow: append empty ports with the lowest unused `output:<n>` ids, skipping any id a kept
    // output already holds — deterministic (no rng/clock) and collision-free for sparse survivors.
    const taken = new Set(current.map((o) => o.id));
    const appended: OutputConfig[] = [];
    for (let n = 1; appended.length < target - current.length; n++) {
      const id = `output:${n}`;
      if (taken.has(id)) continue;
      taken.add(id);
      appended.push({ id, channelsPerPixel: 3, segments: [] });
    }
    outputs = [...current, ...appended];
  }

  return { ...kit, outputs };
}
