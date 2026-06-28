/**
 * Referential integrity at the project/kit boundary. Pure + platform-agnostic
 * (no Node/DOM/IO) so both the web (when it builds a Show) and the server (when it
 * loads a project, #2) validate authored content against the SAME kit the renderer
 * runs. A dangling reference is the silent-misrender bug class — a drum-scoped voice
 * whose `sourceDrumId` isn't in the kit goes dark instead of erroring — so these
 * checks turn that into a loud, named throw at load/build time.
 */

import type { KitConfig } from '../geometry/kit-schema';
import type { Project } from './project-schema';

/** Thrown when an authored reference fails to resolve to a kit drum (or a graph). */
export class ReferentialIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferentialIntegrityError';
  }
}

/** The set of drum ids a kit defines — the source of truth every ref resolves against. */
export function kitDrumIds(kit: KitConfig): Set<string> {
  return new Set(kit.drums.map((d) => d.id));
}

/** The drum id encoded in a padKey `"drumId:zone"` (the raw key if it has no zone). */
export function drumIdOfPadKey(padKey: string): string {
  const i = padKey.indexOf(':');
  return i === -1 ? padKey : padKey.slice(0, i);
}

/**
 * Is this graph key an authored (non-pad) graph rather than a pad-bound one? Authored
 * graphs live in the `graph` namespace — `store.createGraph` mints them via `nid('graph')`
 * (`graph-<n>`; some content/docs use the `graph:<n>` form) — and are fired by their trigger
 * SOURCE (midi/osc, U3), not bound to a `drumId:zone` pad. They are valid standalone graphs,
 * so {@link assertShowIntegrity} must NOT try to resolve their key to a kit drum. Matching the
 * `graph` namespace (not "has no colon") keeps a genuinely-dangling padKey resolving and
 * throwing, and accepts both the `graph:` and `graph-` separators.
 */
export function isAuthoredGraphKey(key: string): boolean {
  return key.startsWith('graph:') || key.startsWith('graph-');
}

/**
 * Assert every drum reference in a core {@link Project} resolves to a drum in its
 * own kit: MIDI/OSC input maps and the setlist's per-section trigger bindings. The
 * server load path (#2) reuses this; `defaultProject()` self-validates with it.
 * Throws {@link ReferentialIntegrityError} naming every offending reference.
 */
export function assertProjectIntegrity(project: Project): void {
  const ids = kitDrumIds(project.kit);
  const bad: string[] = [];

  for (const m of project.inputMap.midiNotes)
    if (!ids.has(m.drumId)) bad.push(`inputMap.midiNotes note ${m.note} → drum "${m.drumId}"`);
  for (const o of project.inputMap.oscMap)
    if (!ids.has(o.drumId)) bad.push(`inputMap.oscMap "${o.address}" → drum "${o.drumId}"`);
  for (const song of project.setlist.songs)
    for (const sec of song.sections)
      for (const b of sec.bindings)
        if (!ids.has(b.drumId)) bad.push(`setlist "${song.id}"/"${sec.id}" binding → drum "${b.drumId}"`);

  if (bad.length) {
    throw new ReferentialIntegrityError(
      `Project "${project.name}" references drums not in its kit [${[...ids].join(', ')}]:\n  - ${bad.join('\n  - ')}`,
    );
  }
}

/** Inputs for validating the web's graph/slot authored content against a kit. */
export interface ShowIntegrityInput {
  /** Valid drum ids (from the canonical kit). */
  drumIds: Iterable<string>;
  /** Graph map keys: pad-bound keys ("drumId:zone") must resolve to a kit drum;
   *  authored graph keys (`graph:…`/`graph-…`, see {@link isAuthoredGraphKey}) are
   *  standalone graphs fired by their trigger source and are accepted as-is. */
  graphKeys: Iterable<string>;
  /** Optional setlist slot references — each must resolve to a graph key. */
  slotRefs?: Iterable<string>;
}

/**
 * Assert the web's authored Show resolves: every PAD-bound graph key's drum exists in
 * the kit (authored graph keys — see {@link isAuthoredGraphKey} — are standalone and
 * exempt), and every setlist slot reference points at a real graph (slots reference
 * graphs; graphs reference drums). Pure + kit-agnostic — the caller supplies the kit's
 * drum ids — so it lives in core and the web boundary reuses it. Throws
 * {@link ReferentialIntegrityError} naming every offending reference.
 */
export function assertShowIntegrity(input: ShowIntegrityInput): void {
  const ids = new Set(input.drumIds);
  const keys = new Set(input.graphKeys);
  const bad: string[] = [];

  for (const key of keys) {
    // Authored graphs are fired by their trigger source (midi/osc), not bound to a pad,
    // so they have no drum to resolve — skip the kit check (slot refs below still apply).
    if (isAuthoredGraphKey(key)) continue;
    const drumId = drumIdOfPadKey(key);
    if (!ids.has(drumId)) bad.push(`graph "${key}" → drum "${drumId}" (not in kit)`);
  }
  for (const ref of input.slotRefs ?? [])
    if (!keys.has(ref)) bad.push(`setlist slot → graph "${ref}" (no such graph)`);

  if (bad.length) {
    throw new ReferentialIntegrityError(
      `Show references that don't resolve (kit drums [${[...ids].join(', ')}]):\n  - ${bad.join('\n  - ')}`,
    );
  }
}
