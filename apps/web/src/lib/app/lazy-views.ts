import { lazyComponent } from '../ui/lazy-component';

// Literal route imports give Vite real seams. Do not preload these on boot/hover:
// Perform's controls and its Three visualizer have priority on a cold launch.
export const editorViews = {
  trigger: lazyComponent('TriggerGraphView', () => import('./views/TriggerGraphView.svelte')),
  sections: lazyComponent('SectionsView', () => import('./views/SectionsView.svelte')),
  objects: lazyComponent('ObjectsView', () => import('./views/ObjectsView.svelte')),
};
