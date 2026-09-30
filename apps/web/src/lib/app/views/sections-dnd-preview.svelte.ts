/* Dev-only preview override for the Sections DnD indicators.

   The section-reorder insert line only exists during a live HTML5 drag — which headless Chrome can't drive
   reliably, so `pnpm ui-shot` can't reach those transient states the normal way.
   This tiny rune holder lets the screenshot seam (`shot-seam.ts`) pin the
   indicator so it renders statically for a capture. SectionsView merges it into
   its real drag state ONLY under `import.meta.env.DEV`, so it is inert (and
   dead-code-eliminated) in production. */

export type SectionsDndPreview = { kind: 'section'; index: number };

class SectionsDndPreviewState {
  /** The pinned indicator, or null when no preview is active. */
  current = $state<SectionsDndPreview | null>(null);

  set(preview: SectionsDndPreview | null): void {
    this.current = preview;
  }

  clear(): void {
    this.current = null;
  }
}

export const sectionsDndPreview = new SectionsDndPreviewState();
