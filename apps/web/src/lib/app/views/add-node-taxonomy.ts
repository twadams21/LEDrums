import type { AddGroup } from './AddPalette.svelte';
import { COLLECTIONS, listModifiersByCategory } from '@ledrums/core';
import Blend from '@lucide/svelte/icons/blend';
import GitBranch from '@lucide/svelte/icons/git-branch';
import Waves from '@lucide/svelte/icons/waves';
import { kindIcon, kindLabel, tint } from './trigger-node-meta';
import type { NodeKind } from '../../trigger-lab/sim';

export const EFFECT_GROUP_KEY = 'effect';
export const ROUTE_GROUP_KEY = 'route';
export const MODULATE_GROUP_KEY = 'modulate';
export const MODIFIER_GROUP_PREFIX = 'modifier:';

export const ENVELOPE_PRESETS = [
  { id: 'pluck', name: 'Pluck', hint: 'fast hit decay' },
  { id: 'stab', name: 'Stab', hint: 'short hold' },
  { id: 'swell', name: 'Swell', hint: 'slow rise' },
  { id: 'gate', name: 'Gate', hint: 'held plateau' },
  { id: 'custom', name: 'Custom', hint: 'flat editable shape' },
] as const;

export const LFO_PRESETS = [
  { id: 'sine', name: 'Sine', hint: 'smooth cycle' },
  { id: 'triangle', name: 'Triangle', hint: 'linear rise/fall' },
  { id: 'saw', name: 'Saw', hint: 'ramp wave' },
  { id: 'square', name: 'Square', hint: 'hard gate' },
  { id: 'sample-hold', name: 'Sample & Hold', hint: 'stepped random' },
] as const;

const ROUTE_KINDS = ['random', 'sequence', 'switch', 'chance', 'toggle', 'delay', 'scope', 'mix'] as const satisfies readonly NodeKind[];

export function buildAddGroups(): AddGroup[] {
  return [
    {
      key: EFFECT_GROUP_KEY,
      label: 'Effect',
      icon: kindIcon.play,
      tint: tint.play,
      items: COLLECTIONS.map((c) => ({
        id: c.type,
        name: c.label,
        icon: kindIcon.play,
        tint: tint.play,
        hint: c.blurb,
      })),
    },
    {
      key: ROUTE_GROUP_KEY,
      label: 'Route',
      icon: GitBranch,
      tint: tint.switch,
      items: [
        ...ROUTE_KINDS.map((kind) => ({
          id: kind,
          name: kindLabel[kind],
          icon: kindIcon[kind],
          tint: tint[kind],
          hint: kind === 'scope' ? 'pixel filter' : undefined,
          preview: 'route' as const,
          previewKind: kind,
        })),
      ],
    },
    {
      key: MODULATE_GROUP_KEY,
      label: 'Modulate',
      icon: Waves,
      tint: tint.lfo,
      items: [
        ...ENVELOPE_PRESETS.map((p) => ({
          id: `envelope:${p.id}`,
          name: `Envelope · ${p.name}`,
          icon: kindIcon.envelope,
          tint: tint.envelope,
          hint: p.hint,
          preview: 'modulate' as const,
          previewKind: 'envelope' as const,
        })),
        ...LFO_PRESETS.map((p) => ({
          id: `lfo:${p.id}`,
          name: `LFO · ${p.name}`,
          icon: kindIcon.lfo,
          tint: tint.lfo,
          hint: p.hint,
          preview: 'modulate' as const,
          previewKind: 'lfo' as const,
        })),
        { id: 'cc', name: 'CC', icon: kindIcon.cc, tint: tint.cc, hint: 'MIDI controller', preview: 'modulate' as const, previewKind: 'cc' as const },
        { id: 'note', name: 'Note', icon: kindIcon.note, tint: tint.note, hint: 'gate or velocity', preview: 'modulate' as const, previewKind: 'note' as const },
        { id: 'osc', name: 'OSC', icon: kindIcon.osc, tint: tint.osc, hint: 'address value', preview: 'modulate' as const, previewKind: 'osc' as const },
        { id: 'randomMod', name: 'Random', icon: kindIcon.randomMod, tint: tint.randomMod, hint: 'sampled value', preview: 'modulate' as const, previewKind: 'randomMod' as const },
      ],
    },
    {
      key: `${MODIFIER_GROUP_PREFIX}all`,
      label: 'Modify',
      icon: Blend,
      tint: 'var(--role-mod)',
      items: listModifiersByCategory().flatMap((g) =>
        g.modifiers.map((m) => ({
          id: m.id,
          name: m.name,
          icon: Blend,
          tint: 'var(--role-mod)',
          hint: g.label,
          preview: 'modifier' as const,
          previewKind: 'modifier' as const,
        })),
      ),
    },
  ];
}
