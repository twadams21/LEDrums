import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Must match @ledrums/core WS_PORT / WS_PATH (apps/server binds the same).
const WS_PORT = 4321;
const WS_PATH = '/ws';

export default defineConfig({
  plugins: [svelte()],
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
