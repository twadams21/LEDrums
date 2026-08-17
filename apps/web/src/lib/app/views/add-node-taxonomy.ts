/* The Add-node popover's vocabulary: the FLAT list of node types the trigger graph can
   gain, one click each (decided by Trent, 2026-08-17 — F2 amendment to S3).

   There is no taxonomy to browse and no second click. The three families whose members
   differ only by subtype — Effect, Modifier, Modulate — add on the store's own default
   subtype (`playNodeInit` / `modifierNodeInit` / the default envelope), and the subtype is
   then switched in the node's inspector. So this list is exactly "what kinds of node
   exist", in the order Trent fixed.

   Icons, colours and labels are read from the node registry's own metadata
   (`trigger-node-meta`), never redrawn here, so a kind's glyph and tint have one home. */
import type { Component } from 'svelte';
import { COLLECTIONS, listModifiersByCategory } from '@ledrums/core';
import Blend from '@lucide/svelte/icons/blend';
import Waves from '@lucide/svelte/icons/waves';
import { kindIcon, kindLabel, tint } from './trigger-node-meta';
import type { NodeKind } from '../../trigger-lab/sim';

export type AddNodeType = {
  /** The kind the store adds — the family default for Effect / Modifier / Modulate. */
  kind: NodeKind;
  label: string;
  icon: Component;
  /** CSS colour for the row's icon chip (the kind's own tint). */
  tint: string;
  /** Tight qualifier: what the node does, or which default subtype it lands on. */
  hint: string;
};

/** Every node type the popover offers, in display order. */
export const ADD_NODE_TYPES: readonly AddNodeType[] = [
  { kind: 'effect', label: kindLabel.effect, icon: kindIcon.effect, tint: tint.effect, hint: 'makes light' },
  { kind: 'all', label: kindLabel.all, icon: kindIcon.all, tint: tint.all, hint: 'all at once' },
  { kind: 'random', label: kindLabel.random, icon: kindIcon.random, tint: tint.random, hint: 'one at random' },
  { kind: 'sequence', label: kindLabel.sequence, icon: kindIcon.sequence, tint: tint.sequence, hint: 'in order' },
  { kind: 'switch', label: kindLabel.switch, icon: kindIcon.switch, tint: tint.switch, hint: 'branch on a value' },
  { kind: 'chance', label: kindLabel.chance, icon: kindIcon.chance, tint: tint.chance, hint: 'fires by probability' },
  { kind: 'toggle', label: kindLabel.toggle, icon: kindIcon.toggle, tint: tint.toggle, hint: 'on · off' },
  { kind: 'delay', label: kindLabel.delay, icon: kindIcon.delay, tint: tint.delay, hint: 'time or beats' },
  { kind: 'modifier', label: kindLabel.modifier, icon: kindIcon.modifier, tint: tint.modifier, hint: 'transforms the chain' },
  { kind: 'mix', label: kindLabel.mix, icon: kindIcon.mix, tint: tint.mix, hint: 'blends branches' },
  { kind: 'scope', label: kindLabel.scope, icon: kindIcon.scope, tint: tint.scope, hint: 'pixel filter' },
  // The whole modulation family behind one type — it lands as an Envelope (the store's
  // default modulation source) and the inspector swaps it to LFO / CC / Note / OSC / Random.
  { kind: 'envelope', label: 'Modulate', icon: Waves, tint: tint.envelope, hint: 'envelope by default' },
];

/** Is `kind` a type this palette can add? Guards the drag payload (an arbitrary string
    must never reach `store.addNode`). */
export function isAddNodeKind(kind: string): kind is NodeKind {
  return ADD_NODE_TYPES.some((t) => t.kind === kind);
}

/* --- drag-to-place payload ------------------------------------------------------------
   A palette row is also a drag source: dropping it on the canvas places the node at the
   drop point instead of at the popover's invoke point. The payload is just the kind, on a
   private MIME type so a stray text drop can never add a node. */

export const ADD_NODE_DRAG_TYPE = 'application/x-ledrums-add-node';

export function encodeAddDragPayload(kind: NodeKind): string {
  return kind;
}

/** The kind a drop carries, or null when the payload is missing / not an addable kind. */
export function decodeAddDragPayload(text: string): NodeKind | null {
  const kind = text.trim();
  return isAddNodeKind(kind) ? kind : null;
}

/* ---- Inspector subtype switching (F3 item 11) ------------------------------------------
   The flat list above adds a family on its default subtype; these are the lists the
   inspector's SubtypeSwitcher re-types within. They read the SAME core registries the
   default-subtype plumbing uses (collections for Effect, the modifier registry for Modify),
   so "added as" and "re-typed to" cannot drift apart. Modulation sources re-type at KIND
   level with their own option list in `Inspector.svelte` — shape/waveform presets belong to
   each source's editor, not here. */

export const EFFECT_GROUP_KEY = 'effect';
export const MODIFIER_GROUP_PREFIX = 'modifier:';

/** One in-place subtype choice — the Select `Option` shape, so a switcher renders the SAME
    icon and tint the Add-node list drew for that family. */
export interface SubtypeOption {
  value: string;
  label: string;
  icon: Component;
  iconColor?: string;
}

/**
 * The subtypes an inspector switcher offers for a family key. An unknown key yields an
 * empty list rather than throwing: a switcher with nothing to offer simply doesn't render.
 */
export function subtypeOptions(groupKey: string): SubtypeOption[] {
  if (groupKey === EFFECT_GROUP_KEY) {
    return COLLECTIONS.map((c) => ({
      value: c.type,
      label: c.label,
      icon: kindIcon.play,
      iconColor: tint.play,
    }));
  }
  if (groupKey.startsWith(MODIFIER_GROUP_PREFIX)) {
    return listModifiersByCategory().flatMap((g) =>
      g.modifiers.map((m) => ({
        value: m.id,
        label: m.name,
        icon: Blend,
        iconColor: 'var(--role-mod)',
      })),
    );
  }
  return [];
}
