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
 */

import { drumHoopCount, kitSchema, type KitConfig, type OutputConfig } from '../geometry/kit-schema';
import { kitDrumIds } from './integrity';

/**
 * The distinct routing-corruption classes a topology can carry:
 * - `schema` — malformed shape (fails the kit output schema); located by {@link RoutingIssue.path}.
 * - `unknown-drum` / `hoop-out-of-range` / `hoop-fan-out` — referential + structural, located by
 *   the output/data-line/drum ids.
 */
export type RoutingIssueCode = 'schema' | 'unknown-drum' | 'hoop-out-of-range' | 'hoop-fan-out';

/** One named routing problem. Locators are populated by class: a `schema` issue carries {@link path}
 *  (the zod dot-path into the payload); the referential/structural classes carry the id triple. */
export interface RoutingIssue {
  code: RoutingIssueCode;
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
            message: `output "${output.id}" / dataLine "${dl.id}" segment → unknown drum "${seg.drumId}"`,
            ...where,
          });
          continue; // no hoops to range-check or claim against a phantom drum
        }
        const hoopCount = hoopCountOf.get(seg.drumId)!;
        if (seg.hoopStart < 1 || seg.hoopEnd > hoopCount || seg.hoopStart > seg.hoopEnd) {
          issues.push({
            code: 'hoop-out-of-range',
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

  return issues;
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
      return { code: 'schema' as const, message: `${path} — ${iss.message}`, path };
    });
  }
  return checkRoutingIntegrity(kit, parsed.data);
}

/**
 * Assert an output topology is valid routing, throwing {@link RoutingIntegrityError} naming
 * every offending reference. The loud counterpart of {@link checkRoutingIntegrity} — for
 * callers that want the same fail-loud shape as {@link assertProjectIntegrity}.
 */
export function assertRoutingIntegrity(
  kit: KitConfig,
  outputs: OutputConfig[] = kit.outputs,
): void {
  const issues = checkRoutingIntegrity(kit, outputs);
  if (issues.length) throw new RoutingIntegrityError(issues);
}
