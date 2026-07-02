/* Types for the build-time virtual module emitted by
   scripts/vite-plugin-source-manifest.mjs (see that file for the key scheme). */
declare module 'virtual:source-manifest' {
  /** Key `lib/ui/Splitter` → repo-relative path `apps/web/src/lib/ui/Splitter.svelte`. */
  export const manifest: Record<string, string>;
}
