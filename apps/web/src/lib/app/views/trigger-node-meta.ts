/* Shared visual metadata for the Trigger Graph's node kinds — the icon, type tint,
   label and one-line summary each node card shows. The xyflow TriggerNode, the add
   palette and (where useful) the Inspector all read ONE source of truth here for
   "what a Random node looks like". Lucide imports keep this out of `packages/core`;
   it stays UI-only. */
import type { Component } from 'svelte';
import Zap from '@lucide/svelte/icons/zap';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Layers from '@lucide/svelte/icons/layers';
import Shuffle from '@lucide/svelte/icons/shuffle';
import ListOrdered from '@lucide/svelte/icons/list-ordered';
import GitBranch from '@lucide/svelte/icons/git-branch';
import Dices from '@lucide/svelte/icons/dices';
import Power from '@lucide/svelte/icons/power';
import Disc3 from '@lucide/svelte/icons/disc-3';
import Activity from '@lucide/svelte/icons/activity';
import Wand2 from '@lucide/svelte/icons/wand-2';
import Timer from '@lucide/svelte/icons/timer';
import Blend from '@lucide/svelte/icons/blend';
import Spline from '@lucide/svelte/icons/spline';
import Waves from '@lucide/svelte/icons/waves'; // S36
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'; // S37
import { listModifiers } from '@ledrums/core';
import type { GraphNode, NodeKind } from '../../trigger-lab/sim';

/** Icon per node kind (add palette, node card chip, kind selector). */
export const kindIcon: Record<NodeKind, Component> = {
  trigger: Zap,
  play: Sparkles,
  all: Layers,
  random: Shuffle,
  sequence: ListOrdered,
  switch: GitBranch,
  chance: Dices,
  toggle: Power,
  delay: Timer,
  modifier: Blend,
  envelope: Spline,
  lfo: Waves, // S36
  cc: SlidersHorizontal, // S37
};

/** Icon per layer/bus (base / trigger / effect). */
export const busIcon: Record<string, Component> = {
  base: Disc3,
  trigger: Activity,
  effect: Wand2,
};

/** Type colour per node kind — rides the node card's icon chip. */
export const tint: Record<NodeKind, string> = {
  trigger: 'var(--accent)',
  play: 'var(--role-content)',
  all: 'var(--role-layer)',
  random: 'var(--role-effect)',
  sequence: 'var(--role-output)',
  switch: 'var(--role-input)',
  chance: 'var(--role-mod)',
  toggle: 'var(--accent)',
  delay: 'var(--role-mod)',
  modifier: 'var(--role-mod)',
  envelope: 'var(--role-modulation)',
  lfo: 'var(--role-modulation)', // S36
  cc: 'var(--role-modulation)', // S37
};

/** Human label per node kind (node card title for containers/modifiers, selector). */
export const kindLabel: Record<NodeKind, string> = {
  trigger: 'Trigger',
  play: 'Play',
  all: 'All',
  random: 'Random',
  sequence: 'Sequence',
  switch: 'Switch',
  chance: 'Chance',
  toggle: 'Toggle',
  delay: 'Delay',
  modifier: 'Modifier',
  envelope: 'Envelope',
  lfo: 'LFO', // S36
  cc: 'CC', // S37
};

/** Human name for a modifier id (the registry's display name), falling back to the id. */
export function modifierName(id: string | undefined): string {
  if (!id) return 'none';
  return listModifiers().find((m) => m.id === id)?.name ?? id;
}

/** One-line summary for a container/modifier node's card sub line. Play + trigger
    nodes carry their own (effect/preset, drum·zone) and don't use this. */
export function kindSummary(node: GraphNode): string {
  switch (node.kind) {
    case 'all':
      return 'all at once';
    case 'random':
      return node.noRepeat ? 'no-repeat' : 'repeat';
    case 'sequence':
      return 'in order';
    case 'switch':
      return `on ${node.on}`;
    case 'chance':
      return `${Math.round(node.p * 100)}%`;
    case 'toggle':
      return 'on · off';
    case 'delay':
      return node.delayMode === 'time' ? `${node.ms}ms` : node.division;
    case 'modifier':
      return node.bypass ? `${modifierName(node.modifierId)} · bypassed` : modifierName(node.modifierId);
    case 'envelope':
      return 'modulation source';
    case 'lfo': // S36
      return node.lfo?.rateMode === 'beats'
        ? `${node.lfo.waveform} · ${node.lfo.division}`
        : `${node.lfo?.waveform ?? 'sine'} · ${node.lfo?.rateHz ?? 1}Hz`;
    case 'cc':
      return node.ccSource === 'osc'
        ? `OSC ${node.oscAddress || '—'}`
        : `CC ${node.ccController ?? 1}${node.ccChannel != null ? ` · ch ${node.ccChannel}` : ''}`; // S37
    default:
      return '';
  }
}
