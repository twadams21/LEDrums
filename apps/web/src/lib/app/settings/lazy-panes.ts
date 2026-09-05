import type { Component } from 'svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import type { SettingsPane } from '../shell-nav';
import type { LazyResource } from '../../ui/lazy-resource.svelte';
import { lazyComponent } from '../../ui/lazy-component';

// Code is cached, not mounted panes. In particular an inactive Controller must
// unwatch: its component lifetime owns polling interest on the server.
export const settingsPanes = {
  input: lazyComponent('InputPane', () => import('./panes/InputPane.svelte')),
  zones: lazyComponent('DrumZonesPane', () => import('./panes/DrumZonesPane.svelte')),
  controls: lazyComponent('GlobalControlsPane', () => import('./panes/GlobalControlsPane.svelte')),
  drums: lazyComponent('DrumsHoopsPane', () => import('./panes/DrumsHoopsPane.svelte')),
  outputs: lazyComponent('OutputsChainsPane', () => import('./panes/OutputsChainsPane.svelte')),
  controller: lazyComponent('ControllerPane', () => import('./panes/ControllerPane.svelte')),
  system: lazyComponent('SystemPane', () => import('./panes/SystemPane.svelte')),
} satisfies Record<SettingsPane, LazyResource<Component<{ store: TriggerLab }>>>;
