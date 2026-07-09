/* Dev-only preview override for the R03 invalid-wire drag state (item 1.1).

   The red / dotted / dull wire-in-progress only exists during a live xyflow connection drag —
   which headless Chrome can't drive reliably, so `pnpm ui-shot` can't reach that transient state
   the normal way. This tiny rune holder lets the screenshot seam (`shot-seam.ts`) pin the state
   so a static stand-in renders for a capture. TriggerGraphView reads it ONLY under
   `import.meta.env.DEV`, so it is inert (and dead-code-eliminated) in production.

   Mirrors `sections-dnd-preview.svelte.ts` — the same drag-only-state-for-a-shot pattern. */

class WireInvalidPreviewState {
  /** True when the invalid-wire drag state is pinned for a capture. */
  current = $state(false);

  set(on: boolean): void {
    this.current = on;
  }

  clear(): void {
    this.current = false;
  }
}

export const wireInvalidPreview = new WireInvalidPreviewState();
