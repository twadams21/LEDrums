/**
 * The ONE definition of "valid routing" — the physical-output topology (PixLite chain)
 * checked against the kit it patches. Pure + platform-agnostic (no Node/DOM/IO), so the
 * server (gating a `setKitOutputs` edit, loading a persisted project) and the web (the S11
 * patch editor) validate authored topology against the SAME kit the renderer patches from.
 *
 * It joins {@link assertProjectIntegrity} (that guard covers input-map / setlist drum refs;
 * this one covers the OUTPUT topology's refs + structure) and shares its named-error
 * precedent. Two surfaces: {@link checkRoutingIntegrity} returns structured, named issues
 * (so a gate can reply with the first and the editor can list them all), and
 * {@link assertRoutingIntegrity} throws {@link RoutingIntegrityError} for callers that want
 * a loud fail.
 *
 * The referential rules mirror {@link buildDmxMap}'s own throws EXACTLY (unknown drum,
 * out-of-range/backwards hoop range), so a routing that passes here never throws there —
 * "valid routings pass untouched". The structural fan-out rule catches what buildDmxMap does
 * NOT: the same physical hoop assigned on two data lines silently OVERWRITES its channel there
 * (last write wins, earlier pixels lost), a corruption that "succeeds" into a wrong map.
 *
 * Those are all `error`-severity — they BLOCK the write. B1 adds one `warning`-severity class,
 * `hoop-uncovered`: a structurally-valid topology that simply doesn't route every kit hoop. That
 * is not a corruption (the hoop just stays dark), so the server ACCEPTS it and the editor surfaces
 * it as an indicator. Write-gates split the two via {@link blockingRoutingIssues}.
 */

import { drumHoopCount, kitSchema, type KitConfig, type OutputConfig } from '../geometry/kit-schema';
import { kitDrumIds } from './integrity';

/**
 * The distinct routing problem classes a topology can carry:
 * - `schema` — malformed shape (fails the kit output schema); located by {@link RoutingIssue.path}.
 * - `unknown-drum` / `hoop-out-of-range` / `hoop-fan-out` — referential + structural, located by
 *   the output/data-line/drum ids.
 * - `hoop-uncovered` — a kit hoop carried on NO data line (a warning, B1; see {@link RoutingIssueSeverity}).
 */
export type RoutingIssueCode = 'schema' | 'unknown-drum' | 'hoop-out-of-range' | 'hoop-fan-out' | 'hoop-uncovered';

/**
 * How severe a routing issue is:
 * - `error` — a CORRUPTION that must block the write: buildDmxMap would throw (unknown-drum,
 *   out-of-range) or silently overwrite pixels (fan-out), so the server rejects it.
 * - `warning` — a valid-but-INCOMPLETE topology the server ACCEPTS: an uncovered hoop just stays
 *   dark, so it's surfaced as an editor indicator ("indicators, not restrictions"), never rejected.
 * Every write-gate filters through {@link blockingRoutingIssues} so this split is applied once.
 */
export type RoutingIssueSeverity = 'error' | 'warning';

/** One named routing problem. Locators are populated by class: a `schema` issue carries {@link path}
 *  (the zod dot-path into the payload); the referential/structural classes carry the id triple. */
export interface RoutingIssue {
  code: RoutingIssueCode;
  /** `error` blocks the write; `warning` is advisory (accepted, surfaced as an indicator). */
  severity: RoutingIssueSeverity;
  /** Human-readable, names the offending reference (mirrors buildDmxMap's throw text). */
  message: string;
  /** Dot-path into the outputs payload — present for `schema` issues. */
  path?: string;
  outputId?: string;
  dataLineId?: string;
  drumId?: string;
}

/** The schema that defines a well-formed output topology — reused from the kit schema so
 *  "valid shape" has ONE definition across parse, gate, and this module. */
const outputsSchema = kitSchema.shape.outputs;

/** Thrown by {@link assertRoutingIntegrity}; carries every {@link RoutingIssue} found. */
export class RoutingIntegrityError extends Error {
  readonly issues: RoutingIssue[];
  constructor(issues: RoutingIssue[]) {
    super(
      `Invalid routing topology:\n  - ${issues.map((i) => i.message).join('\n  - ')}`,
    );
    this.name = 'RoutingIntegrityError';
    this.issues = issues;
  }
}

/**
 * Collect every referential + structural problem in an output topology, validated against
 * `kit`'s drums (defaults to the kit's own `outputs`). Returns them in walk order — an empty
 * array means the routing is valid and {@link buildDmxMap} will patch it without throwing.
 * Assumes `outputs` is already schema-valid (see `kitSchema.shape.outputs`); this layer is the
 * referential/structural half that a schema parse cannot express.
 */
export function checkRoutingIntegrity(
  kit: KitConfig,
  outputs: OutputConfig[] = kit.outputs,
): RoutingIssue[] {
  const ids = kitDrumIds(kit);
  const hoopCountOf = new Map(kit.drums.map((d) => [d.id, drumHoopCount(kit, d)]));
  const issues: RoutingIssue[] = [];

  // First data line to claim each (drum, hoop) — a second claim is a fan-out.
  const claimedBy = new Map<string, { outputId: string; dataLineId: string }>();

  for (const output of outputs) {
    for (const dl of output.dataLines) {
      for (const seg of dl.segments) {
        const where = { outputId: output.id, dataLineId: dl.id, drumId: seg.drumId };
        if (!ids.has(seg.drumId)) {
          issues.push({
            code: 'unknown-drum',
            severity: 'error',
            message: `output "${output.id}" / dataLine "${dl.id}" segment → unknown drum "${seg.drumId}"`,
            ...where,
          });
          continue; // no hoops to range-check or claim against a phantom drum
        }
        const hoopCount = hoopCountOf.get(seg.drumId)!;
        if (seg.hoopStart < 1 || seg.hoopEnd > hoopCount || seg.hoopStart > seg.hoopEnd) {
          issues.push({
            code: 'hoop-out-of-range',
            severity: 'error',
            message:
              `output "${output.id}" / dataLine "${dl.id}" segment for "${seg.drumId}" has invalid hoop range ` +
              `${seg.hoopStart}..${seg.hoopEnd} (drum has ${hoopCount} hoops)`,
            ...where,
          });
          continue; // range is nonsensical — don't expand it for fan-out
        }
        for (let h = seg.hoopStart; h <= seg.hoopEnd; h++) {
          const key = `${seg.drumId}#${h}`;
          const prev = claimedBy.get(key);
          if (prev) {
            issues.push({
              code: 'hoop-fan-out',
              severity: 'error',
              message:
                `hoop ${h} of drum "${seg.drumId}" is driven by more than one data line ` +
                `(output "${prev.outputId}" / dataLine "${prev.dataLineId}" and output "${output.id}" / dataLine "${dl.id}")`,
              ...where,
            });
            continue; // report the collision once; keep the first claim
          }
          claimedBy.set(key, { outputId: output.id, dataLineId: dl.id });
        }
      }
    }
  }

  // Completeness (WARNING, B1): once the topology is structurally sound and NON-EMPTY, every
  // physical hoop of the kit should be carried on exactly one line. An uncovered hoop is not a
  // corruption — buildDmxMap simply leaves it dark — so it's a `warning` the server ACCEPTS and the
  // editor surfaces as an indicator ("indicators, not restrictions"), never a hard reject. Skipped
  // when the topology is empty (the flat-map default already covers every pixel) and when any error
  // was found (the claim map is then unreliable, and a broken routing shouldn't also be nagged about
  // coverage). Walked in drum → hoop order so the warnings read top-to-bottom like the rig.
  if (outputs.length > 0 && issues.length === 0) {
    for (const drum of kit.drums) {
      const hoopCount = hoopCountOf.get(drum.id)!;
      for (let h = 1; h <= hoopCount; h++) {
        if (!claimedBy.has(`${drum.id}#${h}`)) {
          issues.push({
            code: 'hoop-uncovered',
            severity: 'warning',
            message: `hoop ${h} of drum "${drum.id}" is not carried on any data line (unrouted — it will stay dark)`,
            drumId: drum.id,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * The subset of `issues` that MUST block a write — the `error`-severity ones. `warning` issues
 * (an incomplete-but-valid topology, i.e. `hoop-uncovered`) are advisory: the server applies the
 * routing and the editor shows an indicator. Every write-gate (server `setProject` / `setKitOutputs`,
 * the runtime degradation namer) filters through this ONE predicate so the accept/reject split is
 * defined in exactly one place and can't drift between the two enforcement surfaces.
 */
export function blockingRoutingIssues(issues: RoutingIssue[]): RoutingIssue[] {
  return issues.filter((i) => i.severity === 'error');
}

/**
 * The full "define valid routing" entry: validate a RAW (untrusted) outputs payload — schema
 * FIRST (malformed shape → `schema` issues, named by their zod path), and only if it is
 * well-formed, the referential + structural checks against `kit`. Returns every named issue in
 * one array (empty = valid). This is the single call the web patch editor (S11) and the server
 * write-gate use so all four corruption classes surface through one module.
 */
export function validateRouting(kit: KitConfig, rawOutputs: unknown): RoutingIssue[] {
  const parsed = outputsSchema.safeParse(rawOutputs);
  if (!parsed.success) {
    return parsed.error.issues.map((iss) => {
      const path = iss.path.join('.') || 'outputs';
      return { code: 'schema' as const, severity: 'error' as const, message: `${path} — ${iss.message}`, path };
    });
  }
  return checkRoutingIntegrity(kit, parsed.data);
}

/**
 * Assert an output topology is valid routing, throwing {@link RoutingIntegrityError} naming
 * every offending reference. The loud counterpart of {@link checkRoutingIntegrity} — for
 * callers that want the same fail-loud shape as {@link assertProjectIntegrity}. Only `error`
 * issues throw ({@link blockingRoutingIssues}); an incomplete-but-valid routing (warnings only)
 * passes silently, matching the server's accept-on-warning contract.
 */
export function assertRoutingIntegrity(
  kit: KitConfig,
  outputs: OutputConfig[] = kit.outputs,
): void {
  const blocking = blockingRoutingIssues(checkRoutingIntegrity(kit, outputs));
  if (blocking.length) throw new RoutingIntegrityError(blocking);
}
