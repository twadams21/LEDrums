/* Source pointers for the design system. The manifest is generated AT BUILD TIME
   from the real filesystem (scripts/vite-plugin-source-manifest.mjs) — a renamed or
   deleted file makes `srcPath` return undefined, which the styleguide renders as a
   visible ⚠ miss instead of a stale pointer. */
import { manifest } from 'virtual:source-manifest';

/** `lib/ui/Splitter` → `apps/web/src/lib/ui/Splitter.svelte` (undefined = stale key). */
export function srcPath(key: string): string | undefined {
  return manifest[key];
}
