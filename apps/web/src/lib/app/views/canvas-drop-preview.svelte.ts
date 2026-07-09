/* Dev-only preview override for the R12 canvas drag-over highlight.

   The graph canvas only shows its "drop target is live" ring while a new node is
   being dragged in from the Add pane — a live HTML5 drag headless Chrome can't
   drive reliably, so `pnpm ui-shot` can't reach that transient state the normal
   way. This tiny rune holder lets the screenshot seam (`shot-seam.ts`) pin the
   highlight so it renders statically for a capture. TriggerGraphView merges it
   into its real drag state ONLY under `import.meta.env.DEV`, so it is inert (and
   dead-code-eliminated) in production.

   Mirrors `sections-dnd-preview.svelte.ts` / `wire-preview.svelte.ts` — the same
   drag-only-state-for-a-shot pattern. */

class CanvasDropPreviewState {
  /** True when the canvas drag-over highlight is pinned for a capture. */
  current = $state(false);

  set(on: boolean): void {
    this.current = on;
  }

  clear(): void {
    this.current = false;
  }
}

export const canvasDropPreview = new CanvasDropPreviewState();
