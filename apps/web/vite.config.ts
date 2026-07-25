import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { sourceManifestPlugin } from './scripts/vite-plugin-source-manifest.mjs';

// Must match @ledrums/core WS_PORT / WS_PATH (apps/server binds the same).
// Overridable so a second worktree's stack can run beside the default one
// (server: PORT=<n>; web: LEDRUMS_WEB_PORT / LEDRUMS_WS_PORT to match).
const WS_PORT = Number(process.env.LEDRUMS_WS_PORT) || 4321;
const WS_PATH = '/ws';
const WEB_PORT = Number(process.env.LEDRUMS_WEB_PORT) || 5173;

export default defineConfig({
  // `svelteTesting()` is a no-op outside Vitest; under test it adds the `browser` resolve
  // condition (so Svelte's client runtime is used for component tests, not its SSR build)
  // and auto-cleans the DOM between tests.
  plugins: [svelte(), svelteTesting(), sourceManifestPlugin()],
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
    port: WEB_PORT,
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
    // Hidden sourcemaps (#122): emit `.js.map` files but DON'T reference them from the shipped JS
    // (no `//# sourceMappingURL` comment). The OTA publish flow archives them to R2 keyed by version
    // so any minified stack trace ever reported stays symbolicatable — without exposing source maps
    // from the served bundle. This is the one irreversible decision: a build with no archived map is
    // un-symbolicatable forever, so it must land in the first release that ships the Reporter.
    sourcemap: 'hidden',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
