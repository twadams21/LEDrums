/* =============================================================================
   BINDING CLAIMS — who already owns this MIDI note / CC / OSC address?

   One input address can be typed into FOUR different editors: the patch zone map, a
   trigger node's `source`, a `sequence` node's `resetSource`, and a global control.
   At showtime they do NOT share equally — the host's pinned precedence consumes a
   globally-bound address at input step 0 (see `voice-engine-host`'s STEP 0), so
   everything else bound to it silently stops firing. A binding that looks configured
   and does nothing is the worst failure mode this app has: nothing is red, nothing
   logs, and the rig is just wrong on stage.

   The fix is to refuse the collision at AUTHORING time rather than resolve it at
   showtime. This module is the single source of truth for "who owns this address",
   imported by every editor that can write one.

   THREE GROUPS, and what may share:

     A `pad-trigger`    zone map + trigger-node sources — share freely WITH EACH OTHER.
                        This is long-standing intended behaviour: a zone-mapped hit
                        fires its pad graph and the raw note stays available to a
                        trigger `source` (see `engine.handleTriggerEvent`).
     B `sequence-reset`  a sequence node's `resetSource` — shares freely with OTHER
                        resets, so one note can snap several chosen sequencers back to
                        step 1 (`sequenceResync` is the all-or-nothing global).
     C `global-control`  unique. Two actions on one address is never intent; today it
                        silently resolves by catalogue order.

   ACROSS groups, all three block each other.

   The DRUM namespace is deliberately untouched. A `drum` source names a pad
   (`drumId`/`zone`), not an input address, so it claims nothing here — which is what
   preserves issue #159's "one pad hit both fires the graph AND resets its sequencer".
   That feature lives entirely in the drum namespace and never collides with a note.

   Purity: pure resolution over (inputMap, graphs). No engine state, no IO, no DOM.
   ============================================================================= */
import { GLOBAL_CONTROL_CATALOG, RESERVED_SECTION_RECALL_CC, type GlobalControlAction } from '../model/global-controls';
import type { InputMap } from '../model/project-schema';
import type { TriggerGraph, TriggerSource } from './types';

/**
 * Which sharing rule a binding plays by. `reserved` is not an editable group — it is
 * the app's own claim (today: CC 0 for global section recall), and it blocks everyone
 * including itself, because nothing a user types can win against it.
 */
export type BindingGroup = 'pad-trigger' | 'sequence-reset' | 'global-control' | 'reserved';

/**
 * An input address, in the namespace it actually collides in. Three separate spaces:
 * note 60 and CC 60 are unrelated, and neither relates to `/ledrums/next`.
 *
 * OSC addresses compare TRIMMED — the editors trim on commit, and an untrimmed
 * comparison would let " /a" slip past a guard and then match "/a" at runtime.
 */
export type BindingAddress =
  | { kind: 'note'; note: number }
  | { kind: 'cc'; controller: number }
  | { kind: 'osc'; address: string };

/**
 * One existing owner of an address. Carries enough identity to (a) recognise a claim
 * as the caller's OWN binding being re-saved, and (b) let the UI say precisely what is
 * in the way — "the snare's edge zone", not "something else".
 *
 * Labels are deliberately absent: naming a drum needs the kit, which is a web-side
 * concern. Core reports structure; the editors format it.
 */
export type BindingClaim =
  | { group: 'pad-trigger'; kind: 'zone'; drumId: string; slot: number }
  | { group: 'pad-trigger'; kind: 'triggerNode'; graphKey: string; nodeId: string }
  | { group: 'sequence-reset'; kind: 'reset'; graphKey: string; nodeId: string }
  | { group: 'global-control'; kind: 'global'; action: GlobalControlAction }
  | { group: 'reserved'; kind: 'reservedCc'; controller: number };

/** Everything a claim search reads: the patch input map plus every authored graph. */
export interface BindingScope {
  inputMap: InputMap;
  graphs: Record<string, TriggerGraph>;
}

/**
 * Does a trigger/reset source bind THIS address?
 *
 * `drum` sources always return false — see the header: they name a pad, not an input
 * address, and share by design.
 */
export function sourceClaimsAddress(src: TriggerSource, address: BindingAddress): boolean {
  switch (address.kind) {
    case 'note':
      return src.kind === 'midi' && src.note !== undefined && src.note === address.note;
    case 'cc':
      return src.kind === 'midi' && src.cc !== undefined && src.cc === address.controller;
    case 'osc':
      return src.kind === 'osc' && src.address.trim() === address.address.trim();
  }
}

/**
 * Every existing owner of `address`, across all four editable surfaces.
 *
 * Order is stable and meaningful: reserved first (it outranks everything), then zone
 * map, then graph nodes in graph-key order, then globals in catalogue order — so a
 * refusal message names the most authoritative blocker first.
 */
export function claimsForAddress(scope: BindingScope, address: BindingAddress): BindingClaim[] {
  const out: BindingClaim[] = [];
  const { inputMap, graphs } = scope;

  // The app's own reservation. Predates global controls (`SECTION_RECALL_CC`) and is
  // enforced at the host, so a stored CC 0 binding could never have fired anyway.
  if (address.kind === 'cc' && address.controller === RESERVED_SECTION_RECALL_CC) {
    out.push({ group: 'reserved', kind: 'reservedCc', controller: RESERVED_SECTION_RECALL_CC });
  }

  // Zone map — notes and OSC addresses only; a pad is never bound to a CC.
  if (address.kind === 'note') {
    for (const m of inputMap.midiNotes) {
      if (m.note === address.note) out.push({ group: 'pad-trigger', kind: 'zone', drumId: m.drumId, slot: m.slot });
    }
  }
  if (address.kind === 'osc') {
    const wanted = address.address.trim();
    for (const m of inputMap.oscMap) {
      if (m.address.trim() === wanted) out.push({ group: 'pad-trigger', kind: 'zone', drumId: m.drumId, slot: m.slot });
    }
  }

  // Authored graphs — a trigger node's `source` (group A) and a sequence node's
  // `resetSource` (group B) are different groups on the SAME node shape, so both are
  // read in one pass rather than two walks that could drift.
  for (const graphKey of Object.keys(graphs).sort()) {
    for (const node of graphs[graphKey]?.nodes ?? []) {
      if (node.kind === 'trigger' && node.source && sourceClaimsAddress(node.source, address)) {
        out.push({ group: 'pad-trigger', kind: 'triggerNode', graphKey, nodeId: node.id });
      }
      if (node.kind === 'sequence' && node.resetSource && sourceClaimsAddress(node.resetSource, address)) {
        out.push({ group: 'sequence-reset', kind: 'reset', graphKey, nodeId: node.id });
      }
    }
  }

  // Global controls, in catalogue order — the same order resolution ties break in.
  for (const def of GLOBAL_CONTROL_CATALOG) {
    const b = inputMap.globalControls[def.id];
    if (!b) continue;
    const hit =
      address.kind === 'note'
        ? b.midiNote !== undefined && b.midiNote === address.note
        : address.kind === 'cc'
          ? b.midiCc !== undefined && b.midiCc === address.controller
          : !!b.oscAddress && b.oscAddress.trim() === address.address.trim();
    if (hit) out.push({ group: 'global-control', kind: 'global', action: def.id });
  }

  return out;
}

/**
 * Is this claim the very binding the caller is editing?
 *
 * Without this, re-saving a binding to its own current value would refuse itself —
 * every commit of an unchanged field, and every Learn that re-hears the note already
 * bound to the armed control, would look like a collision.
 */
export function isSameClaim(a: BindingClaim, b: BindingClaim): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'zone':
      return b.kind === 'zone' && a.drumId === b.drumId && a.slot === b.slot;
    case 'triggerNode':
      return b.kind === 'triggerNode' && a.graphKey === b.graphKey && a.nodeId === b.nodeId;
    case 'reset':
      return b.kind === 'reset' && a.graphKey === b.graphKey && a.nodeId === b.nodeId;
    case 'global':
      return b.kind === 'global' && a.action === b.action;
    case 'reservedCc':
      return b.kind === 'reservedCc';
  }
}

/**
 * The claims that BLOCK `self` from taking `address` — empty means the write is allowed.
 *
 * The whole rule, in three lines below: a reserved claim blocks everyone; a claim from
 * another group always blocks; a claim from your OWN group blocks only if your group is
 * unique (globals). `self` is excluded throughout, so re-saving an unchanged binding is
 * never a conflict.
 *
 * Callers pass the claim they are about to WRITE as `self` — its group is the group the
 * rule is evaluated for, so there is no way to ask about a group and an identity that
 * disagree.
 */
export function bindingConflicts(scope: BindingScope, address: BindingAddress, self: BindingClaim): BindingClaim[] {
  return claimsForAddress(scope, address).filter((claim) => {
    if (isSameClaim(claim, self)) return false;
    if (claim.group === 'reserved') return true;
    if (claim.group !== self.group) return true;
    return self.group === 'global-control';
  });
}

/** Convenience: may `self` take `address`? See {@link bindingConflicts} for the why. */
export function canBindAddress(scope: BindingScope, address: BindingAddress, self: BindingClaim): boolean {
  return bindingConflicts(scope, address, self).length === 0;
}

/** A refused write: what was being bound, where, and who was already there. */
export interface BindingRejection {
  address: BindingAddress;
  /** The binding that was refused. */
  self: BindingClaim;
  /** Non-empty — the existing owners that blocked it. */
  conflicts: BindingClaim[];
}

/**
 * Check a WHOLE-input-map write (`setInputMap`) — the zone map and the global controls
 * are both edited by replacing the map, so this is where their guard has to sit.
 *
 * Only bindings that are NEW OR CHANGED versus `current` are checked. That matters for
 * two reasons: an unrelated edit (renaming a zone, changing the MIDI channel) must not
 * be blocked by a collision it did not create, and re-committing an unchanged field must
 * not refuse itself.
 *
 * Claims are resolved against `next`, not `current`, so two colliding bindings introduced
 * by the SAME write still catch each other.
 */
export function inputMapBindingRejections(
  current: InputMap,
  next: InputMap,
  graphs: Record<string, TriggerGraph>,
): BindingRejection[] {
  const scope: BindingScope = { inputMap: next, graphs };
  const out: BindingRejection[] = [];
  const check = (address: BindingAddress, self: BindingClaim): void => {
    const conflicts = bindingConflicts(scope, address, self);
    if (conflicts.length > 0) out.push({ address, self, conflicts });
  };

  // Zone map — a slot's note/address is keyed by (drumId, slot), so "changed" means the
  // value bound to that slot differs from what it was.
  for (const m of next.midiNotes) {
    const was = current.midiNotes.find((x) => x.drumId === m.drumId && x.slot === m.slot);
    if (was?.note === m.note) continue;
    check({ kind: 'note', note: m.note }, { group: 'pad-trigger', kind: 'zone', drumId: m.drumId, slot: m.slot });
  }
  for (const o of next.oscMap) {
    const was = current.oscMap.find((x) => x.drumId === o.drumId && x.slot === o.slot);
    if (was?.address.trim() === o.address.trim()) continue;
    check({ kind: 'osc', address: o.address }, { group: 'pad-trigger', kind: 'zone', drumId: o.drumId, slot: o.slot });
  }

  // Global controls — each action carries up to three independent fields, so each is
  // diffed and checked on its own; changing an action's OSC address must not re-check
  // (and possibly re-refuse) the note it already had.
  for (const def of GLOBAL_CONTROL_CATALOG) {
    const before = current.globalControls[def.id];
    const after = next.globalControls[def.id];
    if (!after) continue;
    const self: BindingClaim = { group: 'global-control', kind: 'global', action: def.id };
    if (after.midiNote !== undefined && after.midiNote !== before?.midiNote) {
      check({ kind: 'note', note: after.midiNote }, self);
    }
    if (after.midiCc !== undefined && after.midiCc !== before?.midiCc) {
      check({ kind: 'cc', controller: after.midiCc }, self);
    }
    const addr = after.oscAddress?.trim();
    if (addr && addr !== before?.oscAddress?.trim()) {
      check({ kind: 'osc', address: addr }, self);
    }
  }

  return out;
}

/**
 * Check a trigger node's or a sequence node's source write. `graphs` must be the CURRENT
 * graphs — the node's existing binding is excluded as `self`, so a node re-saving its own
 * address never refuses itself.
 */
export function sourceBindingRejections(
  scope: BindingScope,
  source: TriggerSource | null,
  self: BindingClaim,
): BindingRejection[] {
  if (!source) return []; // clearing a binding can never collide
  const out: BindingRejection[] = [];
  for (const address of addressesForSource(source)) {
    const conflicts = bindingConflicts(scope, address, self);
    if (conflicts.length > 0) out.push({ address, self, conflicts });
  }
  return out;
}

/**
 * The addresses a trigger/reset source occupies — `drum` sources occupy none (they are
 * in the pad namespace). A `midi` source may carry BOTH a note and a CC, so this returns
 * a list rather than a single address.
 */
export function addressesForSource(src: TriggerSource): BindingAddress[] {
  switch (src.kind) {
    case 'drum':
      return [];
    case 'midi': {
      const out: BindingAddress[] = [];
      if (src.note !== undefined) out.push({ kind: 'note', note: src.note });
      if (src.cc !== undefined) out.push({ kind: 'cc', controller: src.cc });
      return out;
    }
    case 'osc':
      return src.address.trim() ? [{ kind: 'osc', address: src.address.trim() }] : [];
  }
}
