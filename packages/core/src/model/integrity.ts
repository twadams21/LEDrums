/**
 * Referential integrity at the project/kit boundary. Pure + platform-agnostic
 * (no Node/DOM/IO) so the server (when it loads a project, #2) and the routing checks
 * validate authored content against the SAME kit the renderer runs. A dangling reference is the silent-misrender bug class — a drum-scoped voice
 * whose `sourceDrumId` isn't in the kit goes dark instead of erroring — so these
 * checks turn that into a loud, named throw at load/build time.
 */

import type { KitConfig } from '../geometry/kit-schema';
import type { Project } from './project-schema';

/** Thrown when an authored reference fails to resolve to a kit drum. */
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
