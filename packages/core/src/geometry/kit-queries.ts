// Pure DERIVED QUERIES over an already-parsed KitConfig. Types-only dependency on
// ./kit-schema, so this module never participates in parsing or validation.
import type { KitConfig, DrumConfig, OutputConfig } from './kit-schema';

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
 * Appended `OutputConfig.id`s are the strings `output:<n>` — a naming legacy of the old
 * positional grammar, not a reference to it (the patch graph's flow-node id for any output is
 * `output:` + the config id, i.e. `output:output:<n>` for appended ports, minted and decoded by
 * apps/web's patch-node-id.ts). Each is minted as the LOWEST unused `output:<n>` not already claimed by a kept output — so a sparse
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
