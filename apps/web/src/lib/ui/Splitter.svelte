<script lang="ts">
  /* A draggable divider that resizes an adjacent pane. CONTROLLED: the caller owns
     the size (in px) and persists it; the splitter reports the next *clamped* size
     via onResize on pointer-drag, arrow keys, and Home/End. The caller positions
     the bar on the divide via `style` (absolute) and tells it which way the pane
     grows via `invert`. Details (make-interfaces-feel-better): a hairline divider
     with a ≥40px pseudo-element hit area, a subtle hover→accent affordance, the
     right resize cursor, touch-action:none + pointer capture for clean dragging,
     and full role="separator" keyboard semantics. */
  interface Props {
    /** vertical bar resizes width (drag left/right); horizontal resizes height. */
    orientation: 'vertical' | 'horizontal';
    /** current pane size in px (the value being dragged). */
    size: number;
    /** report the next clamped size; the caller persists it. */
    onResize: (next: number) => void;
    /** negate the drag delta — set when the pane is anchored to the FAR edge (a
        right dock grows as you drag left; a bottom dock grows as you drag up). */
    invert?: boolean;
    min?: number;
    max?: number;
    /** keyboard nudge in px. */
    step?: number;
    label: string;
    /** absolute placement on the divide (top/left/right/bottom/transform). */
    style?: string;
  }
  let {
    orientation,
    size,
    onResize,
    invert = false,
    min = 0,
    max = Number.POSITIVE_INFINITY,
    step = 16,
    label,
    style,
  }: Props = $props();

  const vertical = $derived(orientation === 'vertical');
  let dragging = $state(false);
  let startPos = 0;
  let startSize = 0;

  const clamp = (n: number): number => Math.min(max, Math.max(min, n));

  function onpointerdown(e: PointerEvent): void {
    e.preventDefault();
    dragging = true;
    startPos = vertical ? e.clientX : e.clientY;
    startSize = size;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onpointermove(e: PointerEvent): void {
    if (!dragging) return;
    const raw = (vertical ? e.clientX : e.clientY) - startPos;
    onResize(clamp(startSize + (invert ? -raw : raw)));
  }
  function endDrag(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }
  function onkeydown(e: KeyboardEvent): void {
    const inc = vertical ? 'ArrowRight' : 'ArrowDown';
    const dec = vertical ? 'ArrowLeft' : 'ArrowUp';
    if (e.key === 'Home') {
      e.preventDefault();
      onResize(clamp(min));
    } else if (e.key === 'End') {
      e.preventDefault();
      onResize(clamp(max));
    } else if (e.key === inc || e.key === dec) {
      e.preventDefault();
      const dir = e.key === inc ? 1 : -1;
      onResize(clamp(size + (invert ? -dir : dir) * step));
    }
  }
</script>

<!-- A focusable separator IS interactive (WAI-ARIA window splitter): tabindex + key
     handlers are intentional, so silence the non-interactive-element a11y lints. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="splitter {orientation}"
  class:dragging
  {style}
  role="separator"
  tabindex="0"
  aria-orientation={vertical ? 'vertical' : 'horizontal'}
  aria-label={label}
  aria-valuenow={Math.round(size)}
  aria-valuemin={Number.isFinite(min) ? min : undefined}
  aria-valuemax={Number.isFinite(max) ? Math.round(max) : undefined}
  {onpointerdown}
  {onpointermove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  {onkeydown}
></div>

<style>
  .splitter {
    position: absolute;
    z-index: 6;
    background: transparent;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .splitter.vertical {
    width: 2px;
    cursor: col-resize;
  }
  .splitter.horizontal {
    height: 2px;
    cursor: row-resize;
  }
  /* generous (≥40px) grab zone straddling the hairline, via a pseudo-element */
  .splitter::before {
    content: '';
    position: absolute;
  }
  .splitter.vertical::before {
    top: 0;
    bottom: 0;
    left: -19px;
    right: -19px;
  }
  .splitter.horizontal::before {
    left: 0;
    right: 0;
    top: -19px;
    bottom: -19px;
  }
  /* The visible hairline. Rest: it hides in the flush module seam (border-faint).
     Hover/focus/drag: it thickens (scale on the thin axis) and tints toward the
     accent, so a gutter-less boundary still announces "I'm draggable". */
  .splitter::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 2px;
    background: var(--border-faint);
    transition: background-color var(--dur-120) ease, box-shadow var(--dur-120) ease,
      transform var(--dur-120) var(--ease-control);
  }
  .splitter:focus-visible {
    outline: none;
  }
  /* Hover: clear tint + a slight thickening of the thin axis (2px → ~3px). */
  .splitter:hover::after {
    background: var(--accent-dim);
  }
  .splitter.vertical:hover::after {
    transform: scaleX(1.6);
  }
  .splitter.horizontal:hover::after {
    transform: scaleY(1.6);
  }
  /* Active drag / keyboard focus: full accent, a touch thicker than hover (no glow/shadow). */
  .splitter.vertical.dragging::after,
  .splitter.vertical:focus-visible::after {
    transform: scaleX(2);
  }
  .splitter.horizontal.dragging::after,
  .splitter.horizontal:focus-visible::after {
    transform: scaleY(2);
  }
  .splitter.dragging::after,
  .splitter:focus-visible::after {
    background: var(--accent);
  }
  @media (prefers-reduced-motion: reduce) {
    .splitter::after {
      transition: none;
    }
  }
</style>
