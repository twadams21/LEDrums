import { mount } from 'svelte';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app mount target not found');

// `?style` lazy-mounts the living styleguide; `?proto=trigger` lazy-mounts the
// throwaway Trigger Lab (model probe — see src/lib/trigger-lab/); else the app.
const params = new URLSearchParams(location.search);
if (params.has('style')) {
  void import('./lib/styleguide/Styleguide.svelte').then(({ default: Styleguide }) => {
    mount(Styleguide, { target });
  });
} else if (params.get('proto') === 'trigger') {
  void import('./lib/trigger-lab/TriggerLab.svelte').then(({ default: TriggerLab }) => {
    mount(TriggerLab, { target });
  });
} else {
  mount(App, { target });
}
