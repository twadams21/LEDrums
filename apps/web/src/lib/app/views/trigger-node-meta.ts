/* Shared visual metadata for the graph-era node kinds — the icon, type tint, label and
   one-line summary. The graph editor that drew node cards from it is gone (effect chains
   S08); the Buses dock, the section inspector and the Settings option lists still read
   their icons and tints here. Lucide imports keep this out of `packages/core`; it stays
   UI-only. */
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
import GitMerge from '@lucide/svelte/icons/git-merge';
import Spline from '@lucide/svelte/icons/spline';
import Waves from '@lucide/svelte/icons/waves'; // S36
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'; // S37
import CircleDot from '@lucide/svelte/icons/circle-dot';
import PieChart from '@lucide/svelte/icons/pie-chart';
import Dice5 from '@lucide/svelte/icons/dice-5';
import Music2 from '@lucide/svelte/icons/music-2';
import RadioTower from '@lucide/svelte/icons/radio-tower';
import { listModifiers, voice } from '@ledrums/core';
import AudioLines from '@lucide/svelte/icons/audio-lines';
import Rows3 from '@lucide/svelte/icons/rows-3';
import type { GraphNode, NodeKind } from '../../trigger-lab/sim';
import { audioBandLabel } from '../../audio/band-labels';

/** Icon per node kind (add palette, node card chip, kind selector). */
export const kindIcon: Record<NodeKind, Component> = {
  trigger: Zap,
  play: Sparkles,
  effect: Sparkles,
  splice: PieChart,
  // Stacked slabs — what a slice cuts the kit into, and visibly not Splice's pie wedges.
  slice: Rows3,
  all: Layers,
  random: Shuffle,
  sequence: ListOrdered,
  switch: GitBranch,
  chance: Dices,
  toggle: Power,
  delay: Timer,
  modifier: Blend,
  mix: GitMerge,
  scope: CircleDot,
  output: CircleDot,
  envelope: Spline,
  lfo: Waves, // S36
  cc: SlidersHorizontal, // S37
  note: Music2,
  osc: RadioTower,
  audio: AudioLines, // GH #214
  randomMod: Dice5,
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
  effect: 'var(--role-content)',
  splice: 'var(--role-content)',
  slice: 'var(--role-content)',
  all: 'var(--role-layer)',
  random: 'var(--role-effect)',
  sequence: 'var(--role-output)',
  switch: 'var(--role-input)',
  chance: 'var(--role-mod)',
  toggle: 'var(--accent)',
  delay: 'var(--role-mod)',
  modifier: 'var(--role-mod)',
  mix: 'var(--role-effect)',
  scope: 'var(--role-output)',
  output: 'var(--role-output)',
  envelope: 'var(--role-modulation)',
  lfo: 'var(--role-modulation)', // S36
  cc: 'var(--role-modulation)', // S37
  note: 'var(--role-modulation)',
  osc: 'var(--role-modulation)',
  audio: 'var(--role-modulation)', // GH #214
  randomMod: 'var(--role-modulation)',
};

/** Human label per node kind (node card title for containers/modifiers, selector). */
export const kindLabel: Record<NodeKind, string> = {
  trigger: 'Trigger',
  play: 'Play',
  effect: 'Effect',
  splice: 'Splice',
  slice: 'Slice',
  all: 'All',
  random: 'Random',
  sequence: 'Sequence',
  switch: 'Switch',
  chance: 'Chance',
  toggle: 'Toggle',
  delay: 'Delay',
  modifier: 'Modifier',
  mix: 'Mix',
  scope: 'Scope',
  output: 'Output',
  envelope: 'Envelope',
  lfo: 'LFO', // S36
  cc: 'CC', // S37
  note: 'Note',
  osc: 'OSC',
  audio: 'Audio', // GH #214
  randomMod: 'Random',
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
    case 'mix':
      return node.mixBlendMode ?? 'normal';
    // The two things that decide what a splice node LOOKS like on the kit: how finely it
    // cuts, and whether it is moving. What is inside each splice is the Inspector's job.
    case 'splice': {
      const count = node.spliceCount ?? voice.DEFAULT_SPLICE_COUNT;
      const per = node.splicePartition ?? 'hoop';
      const chase = node.spliceChase ?? 'off';
      if (chase === 'off') return `${count} per ${per}`;
      const rate = node.spliceRateMode === 'time' ? `${node.spliceRateMs ?? voice.DEFAULT_SPLICE_RATE_MS}ms` : node.spliceDivision ?? voice.DEFAULT_SPLICE_DIVISION;
      if (chase === 'stagger') return `${count} per ${per} · ${node.spliceIncrementPx ?? voice.DEFAULT_SPLICE_INCREMENT_PX}px / ${rate}`;
      return `${count} per ${per} · ${chase === 'smooth' ? 'spin' : 'chase'} ${rate}`;
    }
    // The slice counterpart: how finely, along which axis, over what, and whether it moves.
    case 'slice': {
      const count = node.spliceCount ?? voice.DEFAULT_SPLICE_COUNT;
      const axis = (node.sliceAxis ?? voice.DEFAULT_SLICE_AXIS).toUpperCase();
      const tilted = !!(node.sliceRotX || node.sliceRotY || node.sliceRotZ);
      const over = node.sliceRegion ? 'space' : node.scope === 'drum' ? 'drum' : 'kit';
      const base = `${count} along ${axis}${tilted ? ' (tilted)' : ''} · ${over}`;
      const chase = node.spliceChase ?? 'off';
      if (chase === 'off') return base;
      const rate = node.spliceRateMode === 'time' ? `${node.spliceRateMs ?? voice.DEFAULT_SPLICE_RATE_MS}ms` : node.spliceDivision ?? voice.DEFAULT_SPLICE_DIVISION;
      if (chase === 'stagger') return `${base} · ${node.sliceIncrementPct ?? voice.DEFAULT_SLICE_INCREMENT_PCT}% / ${rate}`;
      return `${base} · ${chase === 'smooth' ? 'sweep' : 'chase'} ${rate}`;
    }
    case 'scope':
      return node.scope === 'kit' ? 'whole kit' : node.targetId || node.scope;
    case 'envelope':
      return 'modulation source';
    case 'lfo': // S36
      return node.lfo?.rateMode === 'beats'
        ? `${node.lfo.waveform} · ${node.lfo.division}`
        : `${node.lfo?.waveform ?? 'sine'} · ${node.lfo?.rateHz ?? 1}Hz`;
    case 'cc':
      return `CC ${node.ccController ?? 1}${node.ccChannel != null ? ` · ch ${node.ccChannel}` : ''}`; // S37
    case 'note':
      return `Note ${node.noteNumber ?? 60}${node.noteMode === 'velocity' ? ' · velocity' : ' · gate'}`;
    case 'osc':
      return `OSC ${node.oscAddress || '—'}`;
    case 'audio':
      return `Audio · ${audioBandLabel(node.audioBand ?? 'level')}`;
    case 'randomMod':
      return node.randomDistribution === 'stepped'
        ? `stepped · ${node.randomSteps ?? 4}`
        : node.randomDistribution ?? 'linear';
    default:
      return '';
  }
}
