/* The unlit-pixel colour shared by both visualizers — a dark frosted band so idle
   segments read as "off but present", not black voids. Canonical in normalized 0..1
   RGB (the 3D Pixels.svelte vertex-colour unit); DARK_PIXEL_RGB8 is the same colour
   scaled to 8-bit for the 2D strip's `rgb()` fill. ONE source of truth so the two
   views can't drift apart. */
export const DARK_PIXEL_RGB = [0.05, 0.05, 0.07] as const;

/** {@link DARK_PIXEL_RGB} scaled to 8-bit (0..255) for canvas `rgb()` consumers. */
export const DARK_PIXEL_RGB8: [number, number, number] = [
  Math.round(DARK_PIXEL_RGB[0] * 255),
  Math.round(DARK_PIXEL_RGB[1] * 255),
  Math.round(DARK_PIXEL_RGB[2] * 255),
];
