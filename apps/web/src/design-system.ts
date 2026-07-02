/* Entry for the single-file design-system artifact (docs/design-system.html).
   Mounts the SAME Styleguide app the `/?style` dev route serves — one source for
   the live route and the artifact, so the generated file can never drift from
   the real components. Built by `pnpm design-system` (vite.design-system.config.ts:
   everything — JS, CSS, fonts — inlined into one HTML file that opens offline). */
import { mount } from 'svelte';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './app.css';
import Styleguide from './lib/styleguide/Styleguide.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app mount target not found');

mount(Styleguide, { target });
