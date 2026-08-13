/* The Settings section registry — the identity (label, sub-line, icon, group) of every
   pane, in one place. `SettingsNav` renders the sidebar from it and `PaneHeader` renders
   each pane's title from the same row, so a section's icon and name cannot drift between
   the two. Its colour comes from `section-tints.css`, keyed by the same id.

   Holds no pane components — panes import PaneHeader, which imports this. */
import './section-tints.css';
import type { Component } from 'svelte';
import { SETTINGS_PANES, type SettingsPane } from '../shell-nav';
import Music from '@lucide/svelte/icons/music';
import Target from '@lucide/svelte/icons/target';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import CircleDot from '@lucide/svelte/icons/circle-dot';
import Cable from '@lucide/svelte/icons/cable';
import Cpu from '@lucide/svelte/icons/cpu';
import Wrench from '@lucide/svelte/icons/wrench';

/** Sidebar groups, in render order: what fires the rig · the rig · the app. */
export type SettingsGroup = 'input' | 'rig' | 'app';

export interface SettingsSection {
  id: SettingsPane;
  label: string;
  /** Mono sub-line under the pane title — what this section is, in four words. */
  sub: string;
  icon: Component;
  group: SettingsGroup;
}

export const SETTINGS_GROUPS: ReadonlyArray<{ id: SettingsGroup; label: string }> = [
  { id: 'input', label: 'Input' },
  { id: 'rig', label: 'Rig' },
  { id: 'app', label: 'App' },
];

const BY_ID = {
  input: {
    id: 'input',
    label: 'Input',
    sub: 'MIDI + OSC into the rig',
    icon: Music,
    group: 'input',
  },
  zones: {
    id: 'zones',
    label: 'Drum trigger zones',
    sub: 'zone → note / address',
    icon: Target,
    group: 'input',
  },
  controls: {
    id: 'controls',
    label: 'Global controls',
    sub: 'app-general bindings',
    icon: SlidersHorizontal,
    group: 'input',
  },
  drums: {
    id: 'drums',
    label: 'Drums & Hoops',
    sub: 'kit geometry',
    icon: CircleDot,
    group: 'rig',
  },
  outputs: {
    id: 'outputs',
    label: 'Outputs & Chains',
    sub: 'hoop chains per output',
    icon: Cable,
    group: 'rig',
  },
  controller: {
    id: 'controller',
    label: 'Controller',
    sub: 'the box and its transport',
    icon: Cpu,
    group: 'rig',
  },
  system: {
    id: 'system',
    label: 'System',
    sub: 'the app itself',
    icon: Wrench,
    group: 'app',
  },
} satisfies Record<SettingsPane, SettingsSection>;

/** Section order IS the route order (`SETTINGS_PANES`) — one list, no second ordering. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_PANES.map((id) => BY_ID[id]);

export function settingsSection(id: SettingsPane): SettingsSection {
  return BY_ID[id];
}
