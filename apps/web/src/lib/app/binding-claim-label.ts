/* Pure display copy for a REFUSED input binding — core reports structure (which group,
   which node/zone/action), this turns it into the one sentence the user reads.

   Deliberately separate from `global-control-labels`, which warns about a collision that
   IS allowed. These messages describe a write that did NOT happen, so they must name the
   blocker precisely: "already the trigger for Kick" is actionable, "already in use" sends
   the user hunting through four editors. No Svelte / DOM — unit-tested in isolation. */
import { globalControlDef, type voice } from '@ledrums/core';
import { formatMidiNote } from '../midi/midi-note';
import { describeTriggerSource, type DrumRef } from './trigger-source-label';

/** How a graph key becomes a display name — `store.graphLabel`, injected to stay pure. */
export type GraphLabeller = (graphKey: string) => string;

/** The address itself, in the same phrasing the source labels use ("MIDI D2", "OSC /go"). */
export function describeBindingAddress(address: voice.BindingAddress): string {
  switch (address.kind) {
    case 'note':
      return `MIDI ${formatMidiNote(address.note)}`;
    case 'cc':
      return `MIDI CC ${address.controller}`;
    case 'osc':
      return `OSC ${address.address.trim()}`;
  }
}

/** Who holds the address — a noun phrase that slots into "… is already {this}". */
export function describeBindingClaim(claim: voice.BindingClaim, drums: readonly DrumRef[], graphLabel: GraphLabeller): string {
  switch (claim.kind) {
    case 'zone':
      return `the drum trigger ${describeTriggerSource({ kind: 'drum', drumId: claim.drumId, zone: String(claim.slot) }, drums).sub}`;
    case 'triggerNode':
      return `the trigger for ${graphLabel(claim.graphKey)}`;
    case 'reset':
      return `a sequence reset in ${graphLabel(claim.graphKey)}`;
    case 'global':
      return `the “${globalControlDef(claim.action).label}” global control`;
    case 'reservedCc':
      return 'reserved for global section recall';
  }
}

/**
 * The refusal sentence. Names the FIRST blocker only — `claimsForAddress` returns them
 * most-authoritative first, and a toast listing four owners is a toast nobody reads.
 *
 * The trailing clause says what to do, because the block is otherwise a dead end: the
 * user pressed Learn, hit a pad, and nothing happened.
 */
export function bindingRejectionMessage(
  rejection: voice.BindingRejection,
  drums: readonly DrumRef[],
  graphLabel: GraphLabeller,
): string {
  const blocker = rejection.conflicts[0]!;
  const what = describeBindingAddress(rejection.address);
  const who = describeBindingClaim(blocker, drums, graphLabel);
  return `${what} is already ${who} — clear that binding first, or pick another input.`;
}
