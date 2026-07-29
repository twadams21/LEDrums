import { eulerXYZApply } from './euler';

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
