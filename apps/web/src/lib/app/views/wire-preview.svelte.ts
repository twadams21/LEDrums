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

/* R08 armed-splice indication. The wire only arms while a node is dragged over it — the same
   drag-only state headless Chrome can't drive — so the shot seam pins this and TriggerGraphView
   (under `import.meta.env.DEV`) arms its first eligible flow edge for the capture. Inert and
   dead-code-eliminated in production. */
class SpliceArmedPreviewState {
  /** True when the armed-splice indication is pinned for a capture. */
  current = $state(false);

  set(on: boolean): void {
    this.current = on;
  }

  clear(): void {
    this.current = false;
  }
}

export const spliceArmedPreview = new SpliceArmedPreviewState();

/* F8 pending-wire palette. Releasing a connection drag in empty space summons the Add-node
   popover holding the wire — a drag-only state, so the shot seam pins the wire it would hold and
   TriggerGraphView (under `import.meta.env.DEV`) opens the popover at the canvas centre with the
   list filtered to the kinds that wire can land on. Inert + dead-code-eliminated in production. */
class PendingWirePreviewState {
  /** The pending wire pinned for a capture (`{ nodeId, type, handleId }`), else null. */
  current = $state<{ nodeId: string; type: 'source' | 'target'; handleId: string | null } | null>(null);

  set(wire: { nodeId: string; type: 'source' | 'target'; handleId: string | null }): void {
    this.current = wire;
  }

  clear(): void {
    this.current = null;
  }
}

export const pendingWirePreview = new PendingWirePreviewState();
