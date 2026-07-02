/* Build config for the single-file design-system artifact.
   `pnpm design-system` (root) → renders the real Styleguide app (the same code the
   `/?style` dev route mounts) into ONE self-contained HTML file with all JS, CSS and
   fonts inlined, then copies it to docs/design-system.html. Not part of `pnpm build` —
   the normal app build is untouched. See src/lib/styleguide/README.md. */
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { sourceManifestPlugin } from './scripts/vite-plugin-source-manifest.mjs';

const OUT_DIR = 'dist-design-system';
const ARTIFACT = resolve(__dirname, OUT_DIR, 'design-system.html');
const DEST = resolve(__dirname, '../../docs/design-system.html');

export default defineConfig({
  plugins: [
    svelte(),
    sourceManifestPlugin(),
    viteSingleFile(),
    {
      name: 'ledrums:copy-design-system',
      closeBundle() {
        mkdirSync(resolve(__dirname, '../../docs'), { recursive: true });
        copyFileSync(ARTIFACT, DEST);
        console.log(`design system → ${DEST}`);
      },
    },
  ],
  optimizeDeps: {
    exclude: ['@ledrums/core'],
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'design-system.html'),
    },
  },
});
