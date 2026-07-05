/**
 * The canvas scene engine (D4) — hosted through the ONE `EffectGenerator` seam. A scene
 * document becomes a generator via {@link createCanvasSceneEffect}; the existing
 * generator bridge and compositor render it exactly like any hosted effect (no second
 * dispatch path, locked decision 7). `playType:'canvas'` play nodes name a scene; the
 * effects registry resolves the `canvas:<sceneId>` id to this adapter.
 *
 * Per pixel: sampler table (precomputed placement) → samplerRotDeg → canvas transform
 * (offset/scale/rotate) → lens chain (D5; `hyper4d` replaces the base placement from
 * world space) → element stack (painter's order) → global hue rotate + brightness.
 *
 * Deterministic + pure: everything derives from (time, params, model, scene). State is
 * only the memoized sampler table (a pure function of model + scene, rebuilt on model
 * change). No IO, no RNG, no hot-path allocation.
 */
import { DEG2RAD, type Vec3 } from '../math';
import type { PixelModel } from '../geometry/pixel-model';
import { hsvToRgb, rgbToHsv } from '../color/color';
import { pnum, type EffectGenerator, type ParamSpec } from '../effects/types';
import { canvasEffectId } from './ids';
import { buildSamplerTable, isWorldSpaceSampler, type SamplerTable } from './sampler';
import { sceneColorAt } from './elements';
import { applyLensChain, hyper4dUv, type UvPair } from './lenses';
import type { CanvasScene, Lens } from './types';

/** Scene-level params — the STANDARD paramSpec surface (D4), so the Inspector,
    envelopes, LFOs and CC drive a scene with ZERO new UI. */
export const CANVAS_PARAM_SPEC: ParamSpec[] = [
  { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  { key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0, max: 5, step: 0.01 },
  { key: 'hue', label: 'Hue Rotate', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
  { key: 'canvasRotDeg', label: 'Canvas Rotate', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
  { key: 'canvasOffsetX', label: 'Canvas X', type: 'number', default: 0, min: -1, max: 1, step: 0.01 },
  { key: 'canvasOffsetY', label: 'Canvas Y', type: 'number', default: 0, min: -1, max: 1, step: 0.01 },
  { key: 'canvasScale', label: 'Canvas Scale', type: 'number', default: 1, min: 0.1, max: 8, step: 0.01 },
  { key: 'samplerRotDeg', label: 'Sampler Rotate', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
];

/** Memoized placement + per-pixel scratch. Pure function of (model, scene) — rebuilt
    when the model identity changes, never persisted (KTD7). */
export interface CanvasSceneState {
  table: SamplerTable | null;
  forModel: PixelModel | null;
  uv: UvPair;
  rgb: [number, number, number];
}

/** The scene's hyper4d lens, if any (world-space path; see `lenses.ts`). */
function hyper4dOf(scene: CanvasScene): Extract<Lens, { kind: 'hyper4d' }> | null {
  for (const l of scene.lenses ?? []) if (l.kind === 'hyper4d') return l;
  return null;
}

/**
 * Wrap a scene document as an {@link EffectGenerator}. The adapter's id is
 * `canvas:<sceneId>` (see `ids.ts`); its tags always include `'canvas'` so the shared
 * taxonomy derives the Canvas collection/play-type.
 */
export function createCanvasSceneEffect(scene: CanvasScene): EffectGenerator<CanvasSceneState> {
  const hyper = hyper4dOf(scene);
  const worldSpace = isWorldSpaceSampler(scene.sampler);
  const lenses = scene.lenses ?? [];

  return {
    id: canvasEffectId(scene.id),
    name: scene.name,
    category: 'texture',
    description: scene.description,
    tags: ['canvas'],
    paramSpec: CANVAS_PARAM_SPEC,
    createState(model): CanvasSceneState {
      return {
        table: buildSamplerTable(model, scene.sampler),
        forModel: model,
        uv: [0, 0],
        rgb: [0, 0, 0],
      };
    },
    render(ctx, params, fb, state): void {
      const model = ctx.model;
      // Thumbnails / older callers render without createState; models can also be
      // rebuilt live (kit transform edits) — memoize the table on model identity.
      if (!state || state.forModel !== model || !state.table) {
        state = {
          table: buildSamplerTable(model, scene.sampler),
          forModel: model,
          uv: [0, 0],
          rgb: [0, 0, 0],
        };
      }
      const t = (ctx.timeMs / 1000) * pnum(params, 'speed', 1);
      const bri = pnum(params, 'brightness', 1);
      const hueShift = pnum(params, 'hue', 0);
      const canvasRot = pnum(params, 'canvasRotDeg', 0) * DEG2RAD;
      const offX = pnum(params, 'canvasOffsetX', 0);
      const offY = pnum(params, 'canvasOffsetY', 0);
      const scale = Math.max(0.05, pnum(params, 'canvasScale', 1));
      const samplerRot = pnum(params, 'samplerRotDeg', 0) * DEG2RAD;
      if (bri <= 0) return;

      const cosS = Math.cos(samplerRot);
      const sinS = Math.sin(samplerRot);
      // sampling the canvas rotated by θ = rotating the sample point by −θ
      const cosC = Math.cos(-canvasRot);
      const sinC = Math.sin(-canvasRot);
      const invScale = 1 / scale;

      const table = state.table!;
      const uv = state.uv;
      const rgb = state.rgb;
      const useHyper = hyper !== null && worldSpace;
      const bounds = model.bounds;
      const center: Vec3 = bounds.center;
      const invHalf = bounds.size > 0 ? 2 / bounds.size : 1;

      for (let i = 0; i < model.pixelCount; i++) {
        if (useHyper) {
          hyper4dUv(hyper!, model.pixels[i]!.world, center, invHalf, t, uv);
        } else {
          uv[0] = table.u[i]!;
          uv[1] = table.v[i]!;
        }
        // sampler rotation — spins the placement around the canvas centre (hoop spin!)
        let x = uv[0] - 0.5;
        let y = uv[1] - 0.5;
        if (samplerRot !== 0) {
          const rx = x * cosS - y * sinS;
          y = x * sinS + y * cosS;
          x = rx;
        }
        // canvas transform: offset pans the artwork; scale/rotate about the centre
        x = (x - offX) * invScale;
        y = (y - offY) * invScale;
        if (canvasRot !== 0) {
          const rx = x * cosC - y * sinC;
          y = x * sinC + y * cosC;
          x = rx;
        }
        uv[0] = x + 0.5;
        uv[1] = y + 0.5;
        // hyper4d is identity in (u,v) space, so the chain is safe to run whole either way
        if (lenses.length) applyLensChain(lenses, uv, t);

        const cov = sceneColorAt(scene.elements, uv[0], uv[1], t, rgb);
        if (cov <= 0) continue;
        let r = rgb[0];
        let g = rgb[1];
        let b = rgb[2];
        if (hueShift !== 0) {
          const hsv = rgbToHsv(r, g, b);
          const c = hsvToRgb(hsv.h + hueShift, hsv.s, hsv.v);
          r = c.r;
          g = c.g;
          b = c.b;
        }
        fb.set(i, r * bri, g * bri, b * bri, cov);
      }
    },
  };
}
