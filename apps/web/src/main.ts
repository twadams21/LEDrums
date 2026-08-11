import { mount } from 'svelte';
import '@fontsource-variable/geist';
// PROTOTYPE (chrome exploration branch): DM Sans trial — see tokens.css --font-sans.
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/geist-mono';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app mount target not found');

// `?style` lazy-mounts the living styleguide; else the app.
const params = new URLSearchParams(location.search);
if (params.has('style')) {
  void import('./lib/styleguide/Styleguide.svelte').then(({ default: Styleguide }) => {
    mount(Styleguide, { target });
  });
} else if (params.get('proto') === 'chrome') {
  // PROTOTYPE (throwaway): tabbed-chrome layout exploration — see lib/app/proto-chrome/NOTES.md.
  void import('./lib/app/proto-chrome/ChromeProtoApp.svelte').then(({ default: ChromeProto }) => {
    mount(ChromeProto, { target });
  });
} else {
  mount(App, { target });
}
