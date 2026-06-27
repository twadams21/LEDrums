import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

// Must match @ledrums/core WS_PORT / WS_PATH (apps/server binds the same).
const WS_PORT = 4321;
const WS_PATH = '/ws';

export default defineConfig({
  // `svelteTesting()` is a no-op outside Vitest; under test it adds the `browser` resolve
  // condition (so Svelte's client runtime is used for component tests, not its SSR build)
  // and auto-cleans the DOM between tests.
  plugins: [svelte(), svelteTesting()],
  // Vitest's resolved config omits `environments.client`, which vite 6's preprocessCSS
  // (invoked by vite-plugin-svelte's <style> preprocessor) proxies — tripping a
  // "non-object proxy target" crash when compiling .svelte files under test. Declaring an
  // explicit client environment gives the proxy a real target. No-op for app dev/build
  // (vite always has a client environment).
  environments: { client: {} },
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
