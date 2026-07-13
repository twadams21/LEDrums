import { z } from 'zod';
import { eulerXYZApply } from './euler';

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
  /** The output's ordered hoop chain, range-compressed (D1). Min 1 — an output with no chain
   *  is not persisted (it is inert / awaiting wiring, dropped by the editor at commit). */
  segments: z.array(outputSegmentSchema).min(1),
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
 *  - 4 → 5 (B4): hoops became FIRST-CLASS — each drum gains an explicit `hoops[]` array (per-hoop
 *    `pixelCount` + `reverse`). A kit predating this (v < 5) has each drum's uniform per-hoop count
 *    ({@link shiftDrumToHoops}) expanded into an explicit `hoops[]` of that length, every hoop
 *    `reverse: false` — byte-identical output (a drum with no derivable uniform count keeps `hoops`
 *    absent and resolves via density, unchanged).
 *  - 5 → 6 (B5): RGB wiring order became a PER-OUTPUT attribute ({@link outputObjectSchema.rgbOrder})
 *    instead of a single controller-level value. The seed of the existing controller order onto each
 *    output happens at the PROJECT layer ({@link migrateProjectKit}), because the controller order
 *    lives on `project.output` — a field the kit alone (this migrator) cannot see. Here the bump is
 *    purely the schema gaining an optional `OutputConfig.rgbOrder`; no kit-only data transform.
 *  - 6 → 7 (D1): the intermediate **Data Line was removed** — an Output now carries its hoop chain
 *    directly (`OutputConfig.segments`) instead of `dataLines[].segments`, so **Output = exactly one
 *    data run**. A kit predating this (v < 7) has each output SPLIT into one output per data line
 *    ({@link splitOutputDataLines}) — expanded mode's 4 outputs × 2 lines become 8 outputs, matching
 *    the v2 patch graph's 8 Output nodes. The split lifts each line's `startUniverse` (first line
 *    inherits the output's) so the DMX byte stream is **identical** (the compile cursor was already a
 *    single monotonic walk over lines; splitting the wrapper changes nothing it packs).
 */
export const CURRENT_KIT_VERSION = 7;

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
 * D1 (v6 → v7): SPLIT one raw output's `dataLines[]` into an array of new outputs — one per
 * data line — each carrying that line's `segments` directly (the intermediate Data Line is
 * gone; Output = exactly one data run). An output already in the new shape (bare `segments`,
 * no `dataLines`) passes through as a single-element array; a foreign/malformed output passes
 * through untouched (schema then reports it).
 *
 * **DMX parity by construction:** `buildDmxMap` already walked outputs → dataLines → segments
 * with ONE monotonic channel cursor, snapping on `output.startUniverse` then `dataLine.startUniverse`.
 * Splitting preserves that walk exactly if each new output inherits `channelsPerPixel`/`rgbOrder`
 * and takes the effective start-universe the old walk would have snapped to at that line's entry:
 *   - the FIRST line inherits `dataLine.startUniverse ?? output.startUniverse` (the old walk
 *     applied the output snap, then the line snap overrode it);
 *   - later lines take only their own `dataLine.startUniverse` (the output snap fired once, before
 *     line 0 — it must NOT re-apply between lines).
 * So the split emits byte-identical channels. New output id = the data line's id (unique + stable);
 * a line without its own id falls back to `${outputId}:${index}`.
 */
function splitOutputDataLines(output: unknown): unknown[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [output];
  const o = output as Record<string, unknown>;
  if (!Array.isArray(o.dataLines)) return [output]; // already chain-shaped (bare segments) or foreign
  const { dataLines, startUniverse: outputStartUniverse, ...rest } = o;
  const baseId = typeof o.id === 'string' ? o.id : 'output';
  return (dataLines as unknown[]).map((dl, i) => {
    if (!dl || typeof dl !== 'object' || Array.isArray(dl)) return dl;
    const line = dl as Record<string, unknown>;
    const lineUniverse = line.startUniverse;
    // First line inherits the output-level snap; later lines only their own (see doc above).
    const startUniverse =
      lineUniverse !== undefined ? lineUniverse : i === 0 ? outputStartUniverse : undefined;
    const next: Record<string, unknown> = {
      ...rest,
      id: typeof line.id === 'string' ? line.id : `${baseId}:${i}`,
      segments: line.segments,
    };
    if (startUniverse !== undefined) next.startUniverse = startUniverse;
    return next;
  });
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
 * B4 (v4 → v5): expand ONE raw drum's uniform per-hoop count into an explicit first-class
 * `hoops[]` array. Each entry is `{ pixelCount, reverse: false }`, so output is byte-identical —
 * the count that {@link buildPixelModel} resolved uniformly becomes the same count, per hoop.
 *
 * The hoop count is the drum's own `hoopCount` else the kit global (default 4), matching schema
 * resolution. The uniform pixel count comes ONLY from a stored literal `pixelsPerHoop`: a drum
 * whose count was density-derived (no literal) has no stored uniform value to bake in, so it is
 * left untouched and continues to resolve via density — expanding it would freeze a value that
 * should still track density. A drum that already carries `hoops` is returned untouched (idempotent).
 */
function shiftDrumToHoops(drum: unknown, globalHoopCount: number): unknown {
  if (!drum || typeof drum !== 'object' || Array.isArray(drum)) return drum;
  const d = drum as Record<string, unknown>;
  if (Array.isArray(d.hoops)) return drum; // already first-class
  if (typeof d.pixelsPerHoop !== 'number') return drum; // density-derived → keep resolving via density
  const hoopCount = typeof d.hoopCount === 'number' ? d.hoopCount : globalHoopCount;
  const hoops = Array.from({ length: hoopCount }, () => ({ pixelCount: d.pixelsPerHoop, reverse: false }));
  return { ...d, hoops };
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
 *  - **< 5 (B4):** each drum's uniform per-hoop count is expanded into a first-class `hoops[]`
 *    array ({@link shiftDrumToHoops}), every hoop `reverse: false` — byte-identical output.
 *  - **< 6 (B5):** RGB order moved to per-output. No kit-only transform here (the schema simply
 *    gained an optional `OutputConfig.rgbOrder`); the seed of the controller-level order onto each
 *    output is a project-scoped step ({@link migrateProjectKit}) since the source field lives on
 *    `project.output`, outside the kit. The version bump alone marks the kit as v6-shaped.
 *  - **< 7 (D1):** the intermediate Data Line is removed — each output's `dataLines[]` is SPLIT
 *    into one output per line ({@link splitOutputDataLines}), carrying `segments` directly, so
 *    Output = exactly one data run. Runs on the already-A1-shifted outputs; DMX byte-identical.
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

  // Global hoop-count fallback for the per-drum steps below; matches the schema default so
  // per-drum stack height / hoop-count resolves exactly as at parse time.
  const g = migrated.global;
  const globalHoopCount =
    g && typeof g === 'object' && !Array.isArray(g) && typeof (g as Record<string, unknown>).hoopCount === 'number'
      ? ((g as Record<string, unknown>).hoopCount as number)
      : 4;

  // v3 → v4 (B3): re-anchor each drum's `origin` from the first hoop to the geometric centre,
  // preserving world position (migrate the data, not the drums).
  if (version < 4 && Array.isArray(migrated.drums)) {
    migrated.drums = (migrated.drums as unknown[]).map((drum) =>
      shiftDrumOriginToCentre(drum, globalHoopCount),
    );
  }

  // v4 → v5 (B4): make hoops first-class — expand each drum's uniform per-hoop count into an
  // explicit `hoops[]` array (reverse:false). Runs on the already-migrated drums so it composes
  // cumulatively with the B3 origin shift above.
  if (version < 5 && Array.isArray(migrated.drums)) {
    migrated.drums = (migrated.drums as unknown[]).map((drum) =>
      shiftDrumToHoops(drum, globalHoopCount),
    );
  }

  // v6 → v7 (D1): remove the intermediate Data Line — split each output's `dataLines[]` into one
  // output per line, carrying `segments` directly (Output = exactly one data run). Runs on the
  // already-migrated outputs (composes with the A1 hoop shift above); DMX byte-identical.
  if (version < 7 && Array.isArray(migrated.outputs)) {
    migrated.outputs = (migrated.outputs as unknown[]).flatMap(splitOutputDataLines);
  }

  migrated.version = CURRENT_KIT_VERSION;
  return migrated;
}

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
