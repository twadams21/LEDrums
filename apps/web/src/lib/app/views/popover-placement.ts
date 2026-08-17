/* Placement math for the on-canvas Add-node popover.

   The popover is summoned AT the pointer (right-click on the canvas) or at a `+`
   affordance, so its natural top-left is wherever the gesture happened — which near a
   right or bottom edge would push most of the palette off the canvas. Flip first (open
   leftwards / upwards from the invoke point, the way a context menu does), then clamp,
   so a corner invoke still lands fully visible instead of merely being shoved inward.

   Pure and in canvas-local px, so the view converts screen → local once and this file
   never touches the DOM. */

export interface PopoverSize {
  w: number;
  h: number;
}

/** The surface the popover must stay inside — the canvas wrapper's own box. */
export interface PopoverBounds {
  w: number;
  h: number;
}

/** Canvas-local top-left for a popover of `size` summoned at (`x`, `y`).

    `margin` is the breathing room kept from every edge. When the box does not fit even
    after flipping, clamping wins and the popover is pinned to the near edge — a partly
    clipped palette is still usable; an off-screen one is not. */
export function clampPopoverPosition(
  x: number,
  y: number,
  size: PopoverSize,
  bounds: PopoverBounds,
  margin = 8,
): { x: number; y: number } {
  return {
    x: place(x, size.w, bounds.w, margin),
    y: place(y, size.h, bounds.h, margin),
  };
}

/** One axis: open forward from `at`, flip backward if that overflows, then clamp. */
function place(at: number, size: number, extent: number, margin: number): number {
  const max = extent - size - margin;
  const flipped = at - size;
  const preferred = at + size + margin <= extent || flipped < margin ? at : flipped;
  return Math.max(margin, Math.min(preferred, Math.max(margin, max)));
}
