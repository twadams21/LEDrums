// Kit VERSION GATE: raw `unknown` in, raw `unknown` out, no zod. Holds the v7 floor and is
// where a future migration ladder goes — nothing here knows the parsed KitConfig shape.
/**
 * Current — and MINIMUM — kit schema version.
 *
 * The cumulative v1→v7 migration ladder that used to live here was DELETED (Decision 6,
 * 2026-07-29). It matched zero files that exist: every kit on disk, live and in every backup,
 * is at v7. So the ladder was unreachable code carrying the highest consequence in this module
 * — a wrong migration silently corrupts a saved kit — and {@link assertKitVersion} now REJECTS
 * a pre-v7 kit instead of transforming it.
 *
 * Version history is retained as a record of the SHAPE each bump introduced (other doc comments
 * in this package refer to "pre-A1" / "pre-B3" files), NOT as transforms that still run:
 *  - **2 (A1):** hoop indexing became 1-based (`OutputSegment.hoopStart/hoopEnd`); v1 stored
 *    0-based ranges.
 *  - **3 (B2):** the Advatek `expanded` output flag was added to `kit.global`.
 *  - **4 (B3):** `DrumConfig.origin` became the drum's GEOMETRIC CENTRE (midpoint of the hoop
 *    stack) instead of the first hoop.
 *  - **5 (B4):** hoops became FIRST-CLASS — each drum carries an explicit `hoops[]` array of
 *    per-hoop `pixelCount` + `reverse`, instead of a uniform `pixelsPerHoop`.
 *  - **6 (B5):** RGB wiring order became a PER-OUTPUT attribute (`OutputConfig.rgbOrder`)
 *    instead of one controller-level value.
 *  - **7 (D1):** the intermediate Data Line was removed — an Output carries its hoop chain
 *    directly (`OutputConfig.segments`), so Output = exactly one data run.
 */
export const CURRENT_KIT_VERSION = 7;

/**
 * The pre-parse version gate — the v7 FLOOR (Decision 6). Runs BEFORE the schema parse, in
 * `parseKit`, and is the seam a future migration ladder plugs back into: it takes a raw
 * `unknown` and returns the raw object the schema should parse, so a later version bump adds
 * its transform here without touching any call site.
 *
 * - A kit at or above {@link CURRENT_KIT_VERSION} is returned **untouched** (same reference).
 *   A version ABOVE the current one passes through as it does today: this build reads it as
 *   v7-shaped rather than guessing at a newer shape it does not know (unchanged behaviour).
 * - A kit carrying a NUMERIC version below the floor **throws** — loudly, at load, naming the
 *   version — rather than being silently mis-read as v7-shaped.
 * - A kit with an absent or non-numeric `version` passes through, deliberately: `kitSchema`
 *   defaults an absent version to {@link CURRENT_KIT_VERSION} (a freshly authored kit object
 *   need not spell it out) and reports a non-numeric one with a proper field path. Treating
 *   "absent" as v1 here would reject every kit literal that omits the field.
 * - A foreign shape (non-object) passes through so the schema reports it, not this gate.
 */
export function assertKitVersion(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const version = (raw as Record<string, unknown>).version;
  if (typeof version === 'number' && version < CURRENT_KIT_VERSION) {
    throw new Error(
      `unsupported kit version ${version}: this build reads kit schema v${CURRENT_KIT_VERSION} only ` +
        `(the v1→v6 migration ladder was removed — no file at that version exists)`,
    );
  }
  return raw;
}
