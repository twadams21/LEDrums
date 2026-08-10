/* Gamut-safe OKLCH for colours that only exist at runtime.
 *
 * Static tokens get their sRGB / P3 renditions authored into tokens.css by
 * `scripts/gamut-tokens.mjs`. Colours computed in JS (live voice tints, whose hue
 * comes from the show, not the design system) can't be — so they clamp here instead.
 *
 * Why it matters: an OKLCH colour outside the display's gamut is gamut-mapped by the
 * engine, and WKWebView (the desktop shell) and Chromium (where we develop) map
 * differently. The voice ramp reaches `oklch(0.78 0.20 200)`, which overshoots sRGB by
 * half a channel — the widest divergence in the app. Clamping first means both engines
 * are handed a colour they can show, so neither has to guess.
 *
 * Mapping is CSS Color 4 style: hold L and H, reduce C. Never clip RGB channels, which
 * shifts hue — a clipped cyan slides toward blue, and voice hue is meaningful here.
 */

/** Destination gamut. P3 is used when the display has it, so we keep the extra punch. */
export type Gamut = 'srgb' | 'p3';

// OKLab → LMS' (CSS Color 4 / Björn Ottosson).
function oklabToLms(L: number, a: number, b: number): [number, number, number] {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.291485548 * b;
  return [l * l * l, m * m * m, s * s * s];
}

function linearSrgb(l: number, m: number, s: number): [number, number, number] {
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearP3(l: number, m: number, s: number): [number, number, number] {
  // LMS' → XYZ (D65) → linear Display P3.
  const X = 1.2268798758 * l - 0.5578149945 * m + 0.2813910502 * s;
  const Y = -0.0405757626 * l + 1.1122868033 * m - 0.0717110667 * s;
  const Z = -0.0763729497 * l - 0.4214933324 * m + 1.5869240198 * s;
  return [
    2.4934969119 * X - 0.9313836179 * Y - 0.4027107845 * Z,
    -0.8294889696 * X + 1.7626640603 * Y + 0.0236246858 * Z,
    0.0358458302 * X - 0.0761723893 * Y + 0.956884524 * Z,
  ];
}

/** True when (L, C, H) is displayable in `gamut`, with a hair of headroom for rounding. */
export function inGamut(L: number, C: number, hDeg: number, gamut: Gamut): boolean {
  const h = (hDeg * Math.PI) / 180;
  const [l, m, s] = oklabToLms(L, C * Math.cos(h), C * Math.sin(h));
  const rgb = gamut === 'p3' ? linearP3(l, m, s) : linearSrgb(l, m, s);
  return rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

/* maxChroma is called per voice per frame, so results are cached. L and H are quantised
   before lookup — the ramp is continuous, and a 0.005 / 1° grid is far finer than the eye
   or the 1px chip it paints. */
const chromaCache = new Map<number, number>();

/* The boundary is searched on the quantised grid, so it can sit a little inside or a
   little outside the boundary at the caller's exact L and hue. GRID_SLACK covers the
   outside case — it is well above the drift measured across the whole ramp, and 0.003
   of chroma is far below a perceptible step. */
const GRID_SLACK = 0.003;

/** A conservative upper bound on the chroma displayable at this lightness and hue. */
export function maxChroma(L: number, hDeg: number, gamut: Gamut): number {
  const lq = Math.round(L * 200) / 200;
  const hq = Math.round(((hDeg % 360) + 360) % 360);
  const key = (gamut === 'p3' ? 1e7 : 0) + lq * 1000 + hq / 1000;
  const hit = chromaCache.get(key);
  if (hit !== undefined) return hit;

  let lo = 0;
  let hi = 0.5; // beyond any real OKLCH chroma
  if (inGamut(lq, hi, hq, gamut)) {
    chromaCache.set(key, hi);
    return hi;
  }
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(lq, mid, hq, gamut)) lo = mid;
    else hi = mid;
  }
  const bound = Math.max(0, lo - GRID_SLACK);
  chromaCache.set(key, bound);
  return bound;
}

/* Which gamut the display actually has. Read once and kept live — dragging the window to
   a different monitor flips it. `matchMedia` is absent under SSR and in the node test
   environment, where sRGB is the safe assumption. */
let displayGamut: Gamut = 'srgb';
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(color-gamut: p3)');
  displayGamut = mq.matches ? 'p3' : 'srgb';
  mq.addEventListener('change', (e) => {
    displayGamut = e.matches ? 'p3' : 'srgb';
    chromaCache.clear();
  });
}

/** The display's gamut — P3 where available, otherwise sRGB. */
export const currentGamut = (): Gamut => displayGamut;

/**
 * An `oklch(...)` string clamped into `gamut` (the display's, by default), so both
 * engines render it identically. Hue and lightness are preserved; only chroma gives way.
 */
export function gamutSafeOklch(
  L: number,
  C: number,
  hDeg: number,
  alpha?: number,
  gamut: Gamut = displayGamut,
): string {
  const c = Math.min(C, maxChroma(L, hDeg, gamut));
  const body = `${round(L)} ${round(c)} ${round(hDeg, 2)}`;
  return alpha === undefined || alpha >= 1 ? `oklch(${body})` : `oklch(${body} / ${round(alpha)})`;
}

const round = (n: number, dp = 4): number => Number(n.toFixed(dp));
