/**
 * actions.ts — things a drum pad / key can DO to the world.   (STUB — owned by the ACTIONS agent)
 *
 * The actions agent adds actions (bursts, shape morphs, force kicks, colour shifts, extra compute kernels…) by editing
 * this file (and panel.ts for UI). It must not need to edit main.ts / particles.ts.
 *
 * CONTRACT (stable, consumed by panel.ts and main.ts)
 *  LabAction        { id: string; label: string; run(ctx: ActionContext, pad?: DrumPad): void }
 *                   `pad` is set when the action was fired from a drum pad (so it can use pad.drumId), undefined otherwise.
 *  ACTIONS          LabAction[]  the registry (mutable array; registerAction() pushes / replaces by id).
 *  registerAction(a)
 *  DrumPad          { id: string (= drum id: 'kick'|'snare'|'tom1'|'tom2'); drumId: string; label: string; actionId: string }
 *  DRUM_PADS        DrumPad[] one per kit drum, in kit order; `actionId` is reassignable at runtime (panel dropdown).
 *  ActionContext    what an action can touch:
 *                     particles        ParticleSystem  (emit(), buffers, kernels, count)
 *                     renderer         WebGPURenderer  (renderer.compute(myKernel) to run extra kernels)
 *                     kit              KitInfo         (kit.drums[i].center etc.; lab metres)
 *                     forceParams / setShape / SHAPES   from forces.ts
 *                     lookParams       from look.ts
 *                     samplerParams    from sampler.ts
 *                     particleParams   from particles.ts
 *                     time()           seconds since start
 *                     drumCenter(drumId): [x,y,z]        lab metres ([0,0,0] if unknown)
 *                     drumColor(drumId): [r,g,b]         linear HDR colour for the drum (hex from the kit, boosted)
 *  createActionContext(deps): ActionContext
 *  runAction(ctx, actionId, pad?)   look up + run (unknown ids are ignored)
 *  triggerPad(ctx, padId)           run the pad's assigned action
 */
import { Color, type WebGPURenderer } from 'three/webgpu';
import { kit, type KitInfo } from './kit';
import type { ParticleSystem } from './particles';
import { particleParams } from './particles';
import { forceParams, setShape, SHAPES } from './forces';
import { lookParams } from './look';
import { samplerParams } from './sampler';

export interface DrumPad {
  id: string;
  drumId: string;
  label: string;
  actionId: string;
}

export interface ActionContext {
  particles: ParticleSystem;
  renderer: WebGPURenderer;
  kit: KitInfo;
  forceParams: typeof forceParams;
  setShape: typeof setShape;
  SHAPES: typeof SHAPES;
  lookParams: typeof lookParams;
  samplerParams: typeof samplerParams;
  particleParams: typeof particleParams;
  time(): number;
  drumCenter(drumId: string): [number, number, number];
  drumColor(drumId: string): [number, number, number];
}

export interface LabAction {
  id: string;
  label: string;
  run(ctx: ActionContext, pad?: DrumPad): void;
}

export const ACTIONS: LabAction[] = [];

export function registerAction(a: LabAction): void {
  const i = ACTIONS.findIndex((x) => x.id === a.id);
  if (i >= 0) ACTIONS[i] = a;
  else ACTIONS.push(a);
}

export const DRUM_PADS: DrumPad[] = kit.drums.map((d) => ({
  id: d.id,
  drumId: d.id,
  label: d.label,
  actionId: 'burst',
}));

// ---- built-in actions ---------------------------------------------------------------------------

registerAction({
  id: 'burst',
  label: 'Burst',
  run(ctx, pad) {
    const drumId = pad?.drumId ?? kit.drums[0]!.id;
    ctx.particles.emit({
      origin: ctx.drumCenter(drumId),
      count: 6000,
      speed: 3.2,
      spread: 1,
      color: ctx.drumColor(drumId),
      life: 1.8,
    });
  },
});

// ---- context ------------------------------------------------------------------------------------

export function createActionContext(deps: {
  particles: ParticleSystem;
  renderer: WebGPURenderer;
  time: () => number;
}): ActionContext {
  const boost = 3.0;
  return {
    particles: deps.particles,
    renderer: deps.renderer,
    kit,
    forceParams,
    setShape,
    SHAPES,
    lookParams,
    samplerParams,
    particleParams,
    time: deps.time,
    drumCenter(drumId) {
      const d = kit.drums.find((x) => x.id === drumId);
      return d ? [d.center[0], d.center[1], d.center[2]] : [0, 0, 0];
    },
    drumColor(drumId) {
      const d = kit.drums.find((x) => x.id === drumId);
      const c = new Color(d?.color ?? '#ffffff');
      return [c.r * boost, c.g * boost, c.b * boost];
    },
  };
}

export function runAction(ctx: ActionContext, actionId: string, pad?: DrumPad): void {
  const a = ACTIONS.find((x) => x.id === actionId);
  if (a) a.run(ctx, pad);
}

export function triggerPad(ctx: ActionContext, padId: string): void {
  const pad = DRUM_PADS.find((p) => p.id === padId);
  if (pad) runAction(ctx, pad.actionId, pad);
}
