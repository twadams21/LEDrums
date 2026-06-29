/* Compact, fixed-decimal telemetry formatting for the lab status bar. The raw
   store values (server-measured fps, round-trip latency) can carry long
   fractions; the bar wants a brief, stable readout. Pairing a constant decimal
   count with the bar's `tabular-nums` keeps the width from jittering frame to
   frame. Non-finite inputs (NaN/Infinity, e.g. a divide-by-zero before the
   first sample) collapse to a zero so the bar never renders "NaN". */

/** Frame rate → whole number (e.g. 59.94 → "60"). A frame rate reads fine at
    integer precision, and 0 decimals is the briefest fixed-width form. */
export function formatFps(fps: number): string {
  return Number.isFinite(fps) ? String(Math.round(fps)) : '0';
}

/** Round-trip latency → one decimal (e.g. 12.3461 → "12.3"). One decimal is
    short yet keeps sub-millisecond movement legible at a fixed width. */
export function formatMs(ms: number): string {
  return Number.isFinite(ms) ? ms.toFixed(1) : '0.0';
}
