/* Pure display helpers for the global control bindings (Settings). No Svelte / DOM —
   unit-tested in isolation, like `trigger-source-label.ts` which it borrows from. */
import type { GlobalControlBinding, InputMap } from '@ledrums/core';
import { describeTriggerSource, zoneLinkForSource, type DrumRef } from './trigger-source-label';

/**
 * The warning a global control shows when its binding COLLIDES with a drum zone in the
 * patch input map.
 *
 * Deliberately different in meaning from `drumLinkHint`, which reads "also drum trigger"
 * because a trigger-source graph and a zone BOTH fire for one message. A global control
 * does not share: it consumes the note/address at input step 0, so the zone stops firing
 * entirely. The copy has to say that — "also" would be actively wrong here, and the
 * silent-dead-pad it describes is exactly the bug a user would otherwise spend an
 * evening chasing.
 *
 * Returns null when nothing collides. Checks the MIDI note and the OSC address
 * independently and reports the first collision found (note first — it is the more
 * common binding).
 */
export function globalControlZoneWarning(
  inputMap: InputMap,
  binding: GlobalControlBinding | undefined,
  drums: readonly DrumRef[],
): string | null {
  if (!binding) return null;

  if (binding.midiNote !== undefined) {
    const link = zoneLinkForSource(inputMap, { kind: 'midi', note: binding.midiNote });
    if (link) return `overrides drum trigger: ${describeTriggerSource({ kind: 'drum', ...link }, drums).sub}`;
  }

  const address = binding.oscAddress?.trim();
  if (address) {
    const link = zoneLinkForSource(inputMap, { kind: 'osc', address });
    if (link) return `overrides drum trigger: ${describeTriggerSource({ kind: 'drum', ...link }, drums).sub}`;
  }

  return null;
}
