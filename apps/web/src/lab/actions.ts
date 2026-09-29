/**
 * actions.ts — things a drum pad / key can DO to the world.   (OWNED by the ACTIONS agent)
 *
 * CONTRACT (unchanged, consumed by panel.ts)
 *  LabAction        { id; label; run(ctx: ActionContext, pad?: DrumPad): void }   pad set when fired from a drum pad
 *  ACTIONS          LabAction[] registry (registerAction() pushes / replaces by id)
 *  DrumPad          { id; drumId; label; actionId }   DRUM_PADS: one per kit drum; actionId reassignable (panel dropdown)
 *  ActionContext    particles, renderer, kit, forceParams, setShape, SHAPES, lookParams, samplerParams, particleParams,
 *                   time(), drumCenter(id), drumColor(id)
 *  createActionContext(deps), runAction(ctx, id, pad?), triggerPad(ctx, padId)
 *
 * ADDED
 *  activeEffectCount()   number of temporary effects currently running (for UI)
 *  ACTION_HELP           one-line description per action id
 *
 * BUILT-IN ACTIONS (ids): burst, shockwave, recolour, next-shape, surge, spin, scatter, freeze, flash, reset
 *  - Every heavy effect is a GPU compute kernel owned here (shell impulse, vortex impulse, recolour, scatter) that reads
 *    and writes the particle position / velocity / color storage buffers. No CPU per-particle work.
 *  - Temporary effects (shockwave shell, spin, surge, freeze, flash, recolour) are driven by a SELF-CONTAINED
 *    requestAnimationFrame loop that only runs while an effect is active. main.ts needs NO hook.
 *  - Param-driven effects (surge/spin/freeze/flash) remember the pre-effect value of each param they touch, ramp it
 *    with a smooth envelope and restore it exactly at the end. Dragging those sliders mid-effect is overridden until
 *    the effect ends.
 *  - Drum-less firing (a key / Actions button) picks a random drum as the origin.
 */
import { Color, Vector3, type WebGPURenderer } from 'three/webgpu';
import { kit, type KitInfo } from './kit';
import type { ParticleSystem } from './particles';
import { particleParams } from './particles';
import { forceParams, setShape, SHAPES } from './forces';
import { lookParams } from './look';
import { samplerParams } from './sampler';
import {
  Fn, instanceIndex, uniform, vec3, vec4, uint, hash, mix, exp, length, max, dot, sqrt, cos, sin, oneMinus, smoothstep, PI2,
} from './tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TNode = any;

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

const DEFAULT_PAD_ACTIONS: Record<string, string> = {
  kick: 'shockwave',
  snare: 'burst',
  tom1: 'recolour',
  tom2: 'spin',
};

export const DRUM_PADS: DrumPad[] = kit.drums.map((d) => ({
  id: d.id,
  drumId: d.id,
  label: d.label,
  actionId: DEFAULT_PAD_ACTIONS[d.id] ?? 'burst',
}));

export const ACTION_HELP: Record<string, string> = {
  burst: 'Emit a spray of particles from the drum in its colour',
  shockwave: 'Expanding ring: radial velocity kick plus a colour flash through the ring',
  recolour: 'Fade nearby (or all, when fired from a key) particles to a new hue; keys also shift the ambient palette',
  'next-shape': 'Cycle the spring-to-shape target (none, sphere, torus)',
  surge: 'Temporary boost of the flow field strength and speed, decaying back',
  spin: 'Vortex kick around the drum plus a temporary global swirl boost',
  scatter: 'Randomise particle velocities',
  freeze: 'Strong drag for a moment, then release with a little scatter',
  flash: 'Brief brightness flash of the LEDs and world view',
  reset: 'Cancel effects, reseed all particles, restore palette, drop the shape',
};

// ---- small helpers ------------------------------------------------------------------------------

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** rise over `a` of the unit range, then quadratic decay */
const attackDecay = (u: number, a = 0.1): number => (u < a ? u / a : Math.pow(1 - clamp01((u - a) / (1 - a)), 2));

function pickDrumId(pad?: DrumPad): string {
  if (pad) return pad.drumId;
  const d = kit.drums[Math.floor(Math.random() * kit.drums.length)];
  return d ? d.id : (kit.drums[0]?.id ?? '');
}

/** ramp a numeric param and remember its original value so the effect can restore it exactly */
class Mod<T extends object> {
  private base: number | null = null;
  constructor(
    private readonly o: T,
    private readonly k: keyof T,
  ) {}
  apply(f: (base: number) => number): void {
    if (this.base === null) this.base = this.o[this.k] as unknown as number;
    this.o[this.k] = f(this.base) as unknown as T[keyof T];
  }
  release(): void {
    if (this.base !== null) {
      this.o[this.k] = this.base as unknown as T[keyof T];
      this.base = null;
    }
  }
}

const modCurl = new Mod(forceParams, 'curlStrength');
const modCurlSpeed = new Mod(forceParams, 'curlSpeed');
const modSwirl = new Mod(forceParams, 'swirl');
const modDrag = new Mod(forceParams, 'drag');
const modGain = new Mod(samplerParams, 'gain');
const modBright = new Mod(lookParams, 'brightness');
const ALL_MODS = [modCurl, modCurlSpeed, modSwirl, modDrag, modGain, modBright];

const INITIAL_AMBIENT = {
  a: [...particleParams.ambientColorA] as [number, number, number],
  b: [...particleParams.ambientColorB] as [number, number, number],
};

// ---- GPU kernels --------------------------------------------------------------------------------

interface Kernels {
  shell: TNode;
  vortex: TNode;
  recolour: TNode;
  scatter: TNode;
  u: {
    shC: TNode; shR: TNode; shThick: TNode; shImpulse: TNode; shTint: TNode; shTintAmt: TNode;
    vxC: TNode; vxImpulse: TNode; vxRadius: TNode; vxLift: TNode;
    rcC: TNode; rcRadius: TNode; rcTarget: TNode; rcK: TNode;
    scAmt: TNode; scSpeed: TNode; seed: TNode;
  };
}

const kernelCache = new WeakMap<object, Kernels>();

function getKernels(p: ParticleSystem): Kernels {
  const hit = kernelCache.get(p);
  if (hit) return hit;
  const { position, velocity, color } = p.buffers;
  const N = p.count;

  const u = {
    shC: uniform(new Vector3()), shR: uniform(0), shThick: uniform(0.3), shImpulse: uniform(0),
    shTint: uniform(new Vector3(1, 1, 1)), shTintAmt: uniform(0),
    vxC: uniform(new Vector3()), vxImpulse: uniform(0), vxRadius: uniform(1), vxLift: uniform(0),
    rcC: uniform(new Vector3()), rcRadius: uniform(1e5), rcTarget: uniform(new Vector3(1, 1, 1)), rcK: uniform(0),
    scAmt: uniform(0), scSpeed: uniform(3), seed: uniform(0, 'uint'),
  };

  // Expanding shell: radial impulse + tint on particles near radius R around a centre.
  const shell = Fn(() => {
    const i = instanceIndex;
    const pos = position.element(i).xyz;
    const vel4 = velocity.element(i).toVar();
    const col4 = color.element(i).toVar();
    const d3 = pos.sub(u.shC);
    const d = length(d3);
    const x = d.sub(u.shR).div(u.shThick);
    const w = exp(x.mul(x).negate());
    const dir = d3.div(max(d, 1e-3));
    velocity.element(i).assign(vec4(vel4.xyz.add(dir.mul(w.mul(u.shImpulse))), vel4.w));
    color.element(i).assign(vec4(mix(col4.xyz, u.shTint, w.mul(u.shTintAmt)), col4.w));
  })().compute(N);

  // Vortex: tangential impulse around the vertical axis through vxC (with a little lift).
  const vortex = Fn(() => {
    const i = instanceIndex;
    const pos = position.element(i).xyz;
    const vel4 = velocity.element(i).toVar();
    const d3 = pos.sub(u.vxC);
    const r = vec3(d3.x, 0, d3.z);
    const dist = length(r);
    const tang = vec3(r.z, 0, r.x.negate()).div(max(dist, 0.05));
    const rr = dist.div(u.vxRadius);
    const yy = d3.y.div(u.vxRadius.mul(1.3));
    const w = exp(rr.mul(rr).add(yy.mul(yy)).negate()).mul(smoothstep(0, 0.12, dist));
    const dv = tang.mul(w.mul(u.vxImpulse)).add(vec3(0, w.mul(u.vxLift), 0));
    velocity.element(i).assign(vec4(vel4.xyz.add(dv), vel4.w));
  })().compute(N);

  // Recolour: blend rgb toward a target hue (luminance preserved), weighted by distance to rcC.
  const recolour = Fn(() => {
    const i = instanceIndex;
    const pos = position.element(i).xyz;
    const col4 = color.element(i).toVar();
    const d = length(pos.sub(u.rcC));
    const w = oneMinus(smoothstep(u.rcRadius.mul(0.35), u.rcRadius, d));
    const lum = max(dot(col4.xyz, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    color.element(i).assign(vec4(mix(col4.xyz, u.rcTarget.mul(lum), u.rcK.mul(w)), col4.w));
  })().compute(N);

  // Scatter: blend velocity toward a random direction * speed.
  const rnd = (k: number): TNode =>
    hash(instanceIndex.mul(uint(747796405)).add(u.seed).add(uint(k * 26699 + 1)));
  const scatter = Fn(() => {
    const i = instanceIndex;
    const vel4 = velocity.element(i).toVar();
    const z = rnd(1).mul(2).sub(1);
    const phi = rnd(2).mul(PI2);
    const s = sqrt(max(oneMinus(z.mul(z)), 0));
    const dir = vec3(s.mul(cos(phi)), z, s.mul(sin(phi)));
    const speed = mix(0.4, 1.0, rnd(3)).mul(u.scSpeed);
    velocity.element(i).assign(vec4(mix(vel4.xyz, dir.mul(speed), u.scAmt), vel4.w));
  })().compute(N);

  const k: Kernels = { shell, vortex, recolour, scatter, u };
  kernelCache.set(p, k);
  return k;
}

/** compile every kernel once with neutral uniforms so the first real trigger has no pipeline hitch */
function prewarm(ctx: ActionContext): void {
  try {
    const k = getKernels(ctx.particles);
    k.u.shImpulse.value = 0;
    k.u.shTintAmt.value = 0;
    k.u.vxImpulse.value = 0;
    k.u.vxLift.value = 0;
    k.u.rcK.value = 0;
    k.u.scAmt.value = 0;
    for (const kernel of [k.shell, k.vortex, k.recolour, k.scatter]) ctx.renderer.compute(kernel);
  } catch (err) {
    console.warn('[lab] action kernel prewarm failed', err);
  }
}

// ---- temporary-effect scheduler -----------------------------------------------------------------

interface Fx {
  key: string;
  age: number;
  dur: number;
  step(u: number, age: number, dt: number): void;
  end(): void;
}

const running = new Map<string, Fx>();
let rafId = 0;
let lastTick = 0;

export function activeEffectCount(): number {
  return running.size;
}

function tick(now: number): void {
  rafId = 0;
  const dt = Math.min(0.05, Math.max(0.0005, (now - lastTick) / 1000));
  lastTick = now;
  for (const fx of [...running.values()]) {
    fx.age += dt;
    if (fx.age >= fx.dur) {
      running.delete(fx.key);
      fx.end();
    } else {
      fx.step(fx.age / fx.dur, fx.age, dt);
    }
  }
  if (running.size > 0) rafId = requestAnimationFrame(tick);
}

function play(fx: Fx): void {
  // a same-key replace restarts the effect; the Mod singletons keep the original base value across the restart
  running.set(fx.key, fx);
  if (!rafId) {
    lastTick = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function cancelAllEffects(): void {
  running.clear();
  for (const m of ALL_MODS) m.release();
}

// ---- hue helper ---------------------------------------------------------------------------------

let hueCursor = Math.random();
function nextHue(): number {
  hueCursor = (hueCursor + 0.382) % 1;
  return hueCursor;
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = new Color().setHSL(h, s, l);
  return [c.r, c.g, c.b];
}
/** rgb scaled so its luminance is 1 (recolour multiplies by the particle's own luminance) */
function unitLuminance(c: [number, number, number]): [number, number, number] {
  const l = Math.max(1e-4, 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
  return [c[0] / l, c[1] / l, c[2] / l];
}

// ---- built-in actions ---------------------------------------------------------------------------

registerAction({
  id: 'burst',
  label: 'Burst',
  run(ctx, pad) {
    const drumId = pickDrumId(pad);
    ctx.particles.emit({
      origin: ctx.drumCenter(drumId),
      count: Math.round(ctx.particles.count * 0.06), // 6% of the pool, so bursts scale with ?n=
      speed: 3.2,
      spread: 1,
      color: ctx.drumColor(drumId),
      life: 1.8,
    });
  },
});

registerAction({
  id: 'shockwave',
  label: 'Shockwave',
  run(ctx, pad) {
    const drumId = pickDrumId(pad);
    const c = ctx.drumCenter(drumId);
    const tint = ctx.drumColor(drumId);
    const k = getKernels(ctx.particles);
    const speed = 3.4;
    play({
      key: `shockwave:${drumId}`,
      age: 0,
      dur: 1.2,
      step(u, age, dt) {
        const R = 0.05 + speed * age;
        k.u.shC.value.set(c[0], c[1], c[2]);
        k.u.shR.value = R;
        k.u.shThick.value = 0.22 + 0.25 * R;
        k.u.shImpulse.value = (34 * dt * Math.pow(1 - u, 1.3)) / (1 + 1.2 * R);
        k.u.shTint.value.set(tint[0], tint[1], tint[2]);
        k.u.shTintAmt.value = 0.6 * (1 - u);
        ctx.renderer.compute(k.shell);
      },
      end() {},
    });
  },
});

registerAction({
  id: 'recolour',
  label: 'Recolour',
  run(ctx, pad) {
    const k = getKernels(ctx.particles);
    const h = nextHue();
    const target = unitLuminance(hslToRgb(h, 1, 0.5));
    let centre: [number, number, number] = [0, 0, 0];
    let radius = 1e5;
    if (pad) {
      centre = ctx.drumCenter(pad.drumId);
      radius = 2.0;
    } else {
      // whole-field recolour also retints the ambient respawn palette so the change persists
      const a = hslToRgb(h, 0.95, 0.5);
      const b = hslToRgb((h + 0.16) % 1, 0.9, 0.55);
      const norm = (c: [number, number, number]): [number, number, number] => {
        const m = Math.max(c[0], c[1], c[2], 1e-3);
        return [c[0] / m, c[1] / m, c[2] / m];
      };
      particleParams.ambientColorA = norm(a);
      particleParams.ambientColorB = norm(b);
    }
    play({
      key: pad ? `recolour:${pad.drumId}` : 'recolour:all',
      age: 0,
      dur: 1.6,
      step(u, _age, dt) {
        k.u.rcC.value.set(centre[0], centre[1], centre[2]);
        k.u.rcRadius.value = radius;
        k.u.rcTarget.value.set(target[0], target[1], target[2]);
        k.u.rcK.value = (1 - Math.exp(-6 * dt)) * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4);
        ctx.renderer.compute(k.recolour);
      },
      end() {},
    });
  },
});

registerAction({
  id: 'next-shape',
  label: 'Next shape',
  run(ctx) {
    const i = ctx.SHAPES.indexOf(ctx.forceParams.shape);
    ctx.setShape(ctx.SHAPES[(i + 1) % ctx.SHAPES.length]!);
  },
});

registerAction({
  id: 'surge',
  label: 'Surge',
  run() {
    play({
      key: 'surge',
      age: 0,
      dur: 3.2,
      step(u) {
        const e = attackDecay(u, 0.08);
        modCurl.apply((b) => b * (1 + 3 * e));
        modCurlSpeed.apply((b) => b * (1 + 5 * e) + 0.2 * e);
      },
      end() {
        modCurl.release();
        modCurlSpeed.release();
      },
    });
  },
});

let spinSign = 1;
registerAction({
  id: 'spin',
  label: 'Spin',
  run(ctx, pad) {
    const k = getKernels(ctx.particles);
    spinSign = -spinSign;
    const sign = spinSign;
    const local = !!pad;
    const c = pad ? ctx.drumCenter(pad.drumId) : [0, 0, 0];
    const radius = pad ? 0.9 : 6;
    play({
      key: pad ? `spin:${pad.drumId}` : 'spin:all',
      age: 0,
      dur: 1.8,
      step(u, _age, dt) {
        const e = attackDecay(u, 0.05);
        k.u.vxC.value.set(c[0]!, c[1]!, c[2]!);
        k.u.vxRadius.value = radius;
        k.u.vxImpulse.value = sign * (local ? 26 : 8) * e * dt;
        k.u.vxLift.value = (local ? 2.5 : 0.5) * e * dt;
        ctx.renderer.compute(k.vortex);
        modSwirl.apply((b) => b + sign * 3 * e);
      },
      end() {
        modSwirl.release();
      },
    });
  },
});

function scatterNow(ctx: ActionContext, amount: number, speed: number): void {
  const k = getKernels(ctx.particles);
  k.u.seed.value = Math.floor(Math.random() * 0x7fffffff);
  k.u.scAmt.value = amount;
  k.u.scSpeed.value = speed;
  ctx.renderer.compute(k.scatter);
}

registerAction({
  id: 'scatter',
  label: 'Scatter',
  run(ctx) {
    scatterNow(ctx, 0.75, 3.6);
  },
});

registerAction({
  id: 'freeze',
  label: 'Freeze',
  run(ctx) {
    const hold = 0.55;
    let released = false;
    play({
      key: 'freeze',
      age: 0,
      dur: 1.6,
      step(u, age) {
        const tHold = hold / 1.6;
        const e = u < tHold ? Math.min(1, u / 0.05) : Math.pow(1 - clamp01((u - tHold) / (1 - tHold)), 2);
        modDrag.apply((b) => b + 16 * e);
        if (!released && age >= hold) {
          released = true;
          scatterNow(ctx, 0.35, 1.8);
        }
      },
      end() {
        modDrag.release();
      },
    });
  },
});

registerAction({
  id: 'flash',
  label: 'Flash',
  run() {
    play({
      key: 'flash',
      age: 0,
      dur: 0.7,
      step(u) {
        const e = Math.pow(1 - u, 2);
        modGain.apply((b) => b * (1 + 4 * e));
        modBright.apply((b) => b * (1 + 2 * e));
      },
      end() {
        modGain.release();
        modBright.release();
      },
    });
  },
});

registerAction({
  id: 'reset',
  label: 'Reset',
  run(ctx) {
    cancelAllEffects();
    ctx.setShape('none');
    particleParams.ambientColorA = [...INITIAL_AMBIENT.a];
    particleParams.ambientColorB = [...INITIAL_AMBIENT.b];
    ctx.particles.reseed();
  },
});

// ---- context ------------------------------------------------------------------------------------

export function createActionContext(deps: {
  particles: ParticleSystem;
  renderer: WebGPURenderer;
  time: () => number;
}): ActionContext {
  const boost = 3.0;
  const ctx: ActionContext = {
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
  // build + compile the kernels a moment after boot (after the first frames have run)
  setTimeout(() => prewarm(ctx), 1500);
  return ctx;
}

export function runAction(ctx: ActionContext, actionId: string, pad?: DrumPad): void {
  const a = ACTIONS.find((x) => x.id === actionId);
  if (a) a.run(ctx, pad);
}

export function triggerPad(ctx: ActionContext, padId: string): void {
  const pad = DRUM_PADS.find((p) => p.id === padId);
  if (pad) runAction(ctx, pad.actionId, pad);
}
