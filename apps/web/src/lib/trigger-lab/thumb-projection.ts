/* Isometric fake-drum projection for effect thumbnails (Effects Library v2, D7/U2).

   Projects the 338 thumb-model pixels (buildThumbPixelModel: 26 columns around a
   100mm-radius cylinder × 13 stacked hoops) to 2D with ONE fixed ¾-angle camera:
   hoops read as stacked ellipses with a slight vertical perspective, every pixel
   becomes a soft glowing dot. The same camera + drum + hit cadence is used for
   EVERY effect, so variance between thumbnails means variance in the EFFECT.

   Everything static is precomputed once per (width, height, mini) layout and
   cached: the per-pixel screen position, dot radius and depth shade, plus an
   offscreen "unlit drum" base layer so the drum's form always reads even while an
   effect is dark. Per frame the painter only recolours dots. */

import { buildThumbPixelModel } from './kit';

export const THUMB_COLS = 26;
export const THUMB_ROWS = 13;
const N = THUMB_COLS * THUMB_ROWS;

/** How squashed the hoop ellipses are (1 = circle, 0 = flat line). */
const SQUASH = 0.32;
/** Drum height as a fraction of its diameter (144mm tall / 200mm wide ≈ 0.72). */
const HEIGHT_RATIO = 1.44;
/** Slight vertical perspective: top hoops (nearer the ¾ camera) render a touch wider. */
const PERSP = 0.1;
/** Depth shading floor for pixels on the far side of the drum. */
const BACK_SHADE = 0.42;
/** Mini background drum (kit-wide effects) scale relative to the main drum. */
const MINI_SCALE = 0.52;
/** Mini drum brightness relative to the main drum. */
const MINI_DIM = 0.55;

export interface DotTable {
  /** Screen-space dot centres, device px; index i matches thumb pixel i (row-major). */
  x: Float32Array;
  y: Float32Array;
  /** Core dot radius, device px (glow is drawn at a multiple of this). */
  r: Float32Array;
  /** Depth shade 0..1 — far-side dots render dimmer/smaller so the cylinder reads. */
  shade: Float32Array;
}

export interface ThumbProjection {
  /** Canvas size in device px this projection was built for. */
  w: number;
  h: number;
  main: DotTable;
  /** Present only when built with `mini: true` (kit-wide effects). */
  mini: DotTable | null;
  /** Prebaked unlit-drum layer (faint structural dots) — drawImage per frame. */
  baseLayer: HTMLCanvasElement | OffscreenCanvas | null;
}

/**
 * Project the thumb drum with the fixed ¾ camera into a box of half-width `a`,
 * centred at (cx, cy) (cy = vertical centre of the whole drum bounding box).
 */
function projectDrum(a: number, cx: number, cy: number, dim: number): DotTable {
  const pm = buildThumbPixelModel();
  const x = new Float32Array(N);
  const y = new Float32Array(N);
  const r = new Float32Array(N);
  const shade = new Float32Array(N);

  const hoopSpan = a * HEIGHT_RATIO; // vertical distance bottom hoop → top hoop
  const topY = cy - hoopSpan / 2;
  const rows1 = THUMB_ROWS - 1;
  // Core dot radius scales with the drum so all three thumb sizes read the same.
  const dotR = Math.max(1.1, a * 0.055);

  for (const p of pm.pixels) {
    const i = p.id;
    const t = rows1 > 0 ? p.hoopIndex / rows1 : 0; // 0 = bottom hoop, 1 = top hoop
    const rad = a * (1 - PERSP * (1 - t)); // slight vertical perspective
    const aRad = (p.angleDeg * Math.PI) / 180;
    const cos = Math.cos(aRad);
    const sin = Math.sin(aRad); // +sin = toward the camera (front of the drum)
    x[i] = cx + cos * rad;
    y[i] = topY + (1 - t) * hoopSpan + sin * rad * SQUASH;
    const front = sin * 0.5 + 0.5; // 0 far side … 1 front
    shade[i] = (BACK_SHADE + (1 - BACK_SHADE) * front) * dim;
    r[i] = dotR * (0.72 + 0.38 * front);
  }
  return { x, y, r, shade };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

/** Bake the faint unlit-drum dots so the drum's form reads even when an effect is dark. */
function bakeBaseLayer(w: number, h: number, tables: DotTable[]): HTMLCanvasElement | OffscreenCanvas | null {
  const cv = makeCanvas(w, h);
  const ctx = cv?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!cv || !ctx) return null;
  for (const t of tables) {
    for (let i = 0; i < N; i++) {
      ctx.fillStyle = `rgba(148, 168, 200, ${(0.1 * t.shade[i]!).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(t.x[i]!, t.y[i]!, t.r[i]!, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return cv;
}

const cache = new Map<string, ThumbProjection>();

/**
 * Build (cached) the projection for a canvas of `w`×`h` device px.
 * `mini` adds the smaller background drum used by kit-wide effects.
 */
export function getThumbProjection(w: number, h: number, mini: boolean): ThumbProjection {
  const key = `${w}x${h}${mini ? ':mini' : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pad = Math.max(2, h * 0.06);
  // Fit: total projected height = hoopSpan + top/bottom ellipse halves ≈ a·(HEIGHT_RATIO + 2·SQUASH).
  const fitH = (h - 2 * pad) / (HEIGHT_RATIO + 2 * SQUASH + 0.12);
  const fitW = (w * (mini ? 0.62 : 0.8)) / 2;
  const a = Math.max(4, Math.min(fitH, fitW));

  const mainCx = mini ? w * 0.58 : w / 2;
  const mainCy = h / 2 + (mini ? h * 0.03 : 0);
  const main = projectDrum(a, mainCx, mainCy, 1);

  let miniTable: DotTable | null = null;
  if (mini) {
    // Behind and up-left of the main drum, so cross-drum travel has somewhere to go.
    miniTable = projectDrum(a * MINI_SCALE, w * 0.2, h * 0.34, MINI_DIM);
  }

  const proj: ThumbProjection = {
    w,
    h,
    main,
    mini: miniTable,
    baseLayer: bakeBaseLayer(w, h, miniTable ? [miniTable, main] : [main]),
  };
  cache.set(key, proj);
  return proj;
}

// ---- Reduced-motion representative age --------------------------------------

/** Param keys that name an effect's characteristic lifetime, in priority order. */
const LIFE_KEYS_MS = ['lifeMs', 'decayMs', 'baseDecayMs', 'life', 'delayMs', 'recoverMs'] as const;

/**
 * The static frame a reduced-motion user sees: 35% of the effect's dominant life
 * param (the moment a hit-driven effect is visibly mid-flight), falling back to
 * 35% of the 1600ms thumb loop when the effect declares no lifetime.
 *
 * `params` (the clip/preset overrides) win over the spec default, matching what
 * the animated thumbnail renders.
 */
export function representativeAgeMs(
  paramSpec: readonly { key: string; default: number | string | boolean }[] | undefined,
  params: Record<string, number | string | boolean | undefined>,
  loopMs: number,
): number {
  if (paramSpec) {
    for (const key of LIFE_KEYS_MS) {
      const spec = paramSpec.find((s) => s.key === key);
      if (!spec) continue;
      const raw = params[key] ?? spec.default;
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        return Math.min(Math.max(raw * 0.35, 50), loopMs);
      }
    }
    // beats → ms at the thumbnail's fixed 120bpm transport (500ms/beat).
    const beats = paramSpec.find((s) => s.key === 'lifeBeats');
    if (beats) {
      const raw = params.lifeBeats ?? beats.default;
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        return Math.min(Math.max(raw * 500 * 0.35, 50), loopMs);
      }
    }
  }
  return loopMs * 0.35;
}
