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
 * IMPORT-ONLY SAFETY NET. The editors can no longer CREATE this state: every in-app write
 * of a note/CC/address passes the `binding-claims` guard in `store.setInputMap`, which
 * refuses a global that lands on a zone. What still bypasses that guard is bulk state
 * arriving from outside the editors — `setProjectPatch` sends a pasted patch straight to
 * the server as `setProject`, never touching `setInputMap`. So this warning survives to
 * describe an IMPORTED collision, which is the one case where a user can be holding a
 * dead pad they did not create. Do not delete it as unreachable; it is reachable by paste.
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
