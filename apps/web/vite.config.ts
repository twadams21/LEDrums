import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Must match @ledrums/core WS_PORT / WS_PATH (apps/server binds the same).
const WS_PORT = 4321;
const WS_PATH = '/ws';

export default defineConfig({
  plugins: [
    // Under Vitest, vite-plugin-svelte's default CSS preprocess (the `style` half
    // of vitePreprocess) crashes on Vite 6's PartialEnvironment, which blocks
    // compiling any .svelte component for tests. SSR component tests don't need
    // CSS transformed, so keep the TS/script step and drop the style step there.
    svelte(process.env.VITEST ? { preprocess: [vitePreprocess({ script: true, style: false })] } : undefined),
  ],
  // Workspace packages export raw .ts source; let Vite transform them instead of
  // pre-bundling, so HMR and type-source resolution work across the monorepo.
  optimizeDeps: {
    exclude: ['@ledrums/core'],
  },
  server: {
    port: 5173,
    proxy: {
      [WS_PATH]: {
        target: `ws://localhost:${WS_PORT}`,
        ws: true,
        rewriteWsOrigin: true,
      },
    },
    // Leading dot allows the whole tailnet (hostnames gain -1/-2 suffixes across forwards).
    allowedHosts: ['.tail568a80.ts.net']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
