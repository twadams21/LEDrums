/**
 * forces.ts — per-particle acceleration field + shape springs.   (FORCES agent)
 *
 * CONTRACT (stable, consumed by particles.ts / actions.ts / panel.ts) — signatures unchanged from the stub; only ADDED fields.
 *  forceParams        plain mutable object (CPU-side knobs; the panel and actions mutate it). Read every frame by syncForceUniforms.
 *    flow      gravity (m/s^2 along Y, negative = down) · drag (1/s; applied by particles.ts, NOT here) · maxSpeed (m/s, 0 = off;
 *              soft limit: a restoring accel above the limit, so bursts may briefly overshoot)
 *    curl      curlStrength (m/s^2) · curlScale (1/m) · curlSpeed (1/s) — time-evolving 3D curl of a noise vector potential
 *    vortex    swirl (= vortex tangential strength, m/s^2 at the core radius) · vortexAxisX/Y/Z (axis through the kit centre,
 *              normalised on the CPU) · vortexCore (m) · vortexFalloff (1/m) · vortexPull (inward, m/s^2) · vortexLift (along axis)
 *    attractors attractorCount (0..3) · attractorStrength (m/s^2 at the softening radius; negative repels) · attractorFalloff
 *              (exponent, 2 = inverse-square-like) · attractorSoftening (m) · attractorOrbit (m) · attractorSpeed (rad/s)
 *    shape     shape (one of SHAPES; set via setShape) · springStrength (1/s^2) · springDamping (damping ratio, 1 = critical)
 *              · shapeRadius (m) · shapeThickness (m, random scatter around the target) · shapeSpin (rad/s about Y; procedural
 *              shapes only) · morphTime (s) · morphStagger (0..1, per-particle transition delay) · burstSpring (0..1 spring
 *              weight applied to burst particles so they can explode before being pulled in)
 *              · shapeFlowDamp (0..1: fraction of gravity/curl/vortex removed on particles held by a shape)
 *  forceUniforms      TSL uniform nodes mirroring forceParams (created once, never replaced). `shapeIndex` = target shape index.
 *  forceState         { attractors: Vector3[3] } live CPU-side attractor positions (metres, lab space) — read-only for others.
 *  SHAPES             readonly string[]; 'none' first. Indices are the order below.
 *  setShape(name)     switch shape with a morph from the current one. Unknown names ignored.
 *  syncForceUniforms(dt, time)  called by main each frame BEFORE the particle compute.
 *  buildAcceleration(ctx)  called ONCE by particles.ts; returns Fn(([position, velocity, index]) => vec3 m/s^2).
 *                     Drag is NOT applied here. ctx is unchanged from the foundation contract: the kit LED / hoop-segment
 *                     data needed by 'kit-leds' and 'drum-rings' is uploaded to a private storage buffer built from `kit`.
 *  registerForcePanel(folder)  lil-gui controllers, grouped in sub-folders.
 *  ForceContext       { time: uniform<float> seconds; kit: KitInfo; lifeBuffer; positionBuffer; velocityBuffer }
 *
 * SHAPES (target computed in-shader from the per-particle seed in life.z — nothing stored per particle):
 *  none · sphere · helix (double) · rings (stacked hoops) · torus · cube-lattice (wire grid) ·
 *  kit-leds (particle i -> LED i % ledCount) · drum-rings (points on the kit's real hoop outlines)
 */
import {
  Fn, If, float, hash, mx_noise_vec3, cross, sin, cos, uniform, vec3, PI, PI2, instancedArray, select, mix, dot, length,
  normalize, exp, pow, max, step, floor, int, smoothstep, sqrt,
} from './tsl';
import { Vector3 } from 'three/webgpu';
import type GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { KitInfo } from './kit';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TNode = any;

export const SHAPES = ['none', 'sphere', 'helix', 'rings', 'torus', 'cube-lattice', 'kit-leds', 'drum-rings'] as const;
export type ShapeName = (typeof SHAPES)[number];

export const forceParams = {
  // flow
  gravity: -0.4,
  drag: 0.7,
  maxSpeed: 0,
  // curl noise
  curlStrength: 1.4,
  curlScale: 0.7,
  curlSpeed: 0.12,
  // vortex
  swirl: 1.0,
  vortexAxisX: 0,
  vortexAxisY: 1,
  vortexAxisZ: 0,
  vortexCore: 0.5,
  vortexFalloff: 0.15,
  vortexPull: 0,
  vortexLift: 0,
  // attractors
  attractorCount: 0,
  attractorStrength: 4,
  attractorFalloff: 2,
  attractorSoftening: 0.35,
  attractorOrbit: 1.2,
  attractorSpeed: 0.5,
  // shape spring
  shape: 'none' as ShapeName,
  springStrength: 6,
  springDamping: 0.6,
  shapeRadius: 0.9,
  shapeThickness: 0.03,
  shapeSpin: 0.25,
  morphTime: 1.5,
  morphStagger: 0.5,
  burstSpring: 0.5,
  shapeFlowDamp: 0.85,
};

export const forceUniforms = {
  gravity: uniform(forceParams.gravity),
  drag: uniform(forceParams.drag),
  maxSpeed: uniform(forceParams.maxSpeed),
  curlStrength: uniform(forceParams.curlStrength),
  curlScale: uniform(forceParams.curlScale),
  curlSpeed: uniform(forceParams.curlSpeed),
  swirl: uniform(forceParams.swirl),
  vortexAxis: uniform(new Vector3(0, 1, 0)),
  vortexCore: uniform(forceParams.vortexCore),
  vortexFalloff: uniform(forceParams.vortexFalloff),
  vortexPull: uniform(forceParams.vortexPull),
  vortexLift: uniform(forceParams.vortexLift),
  attractorCount: uniform(forceParams.attractorCount),
  attractorStrength: uniform(forceParams.attractorStrength),
  attractorFalloff: uniform(forceParams.attractorFalloff),
  attractorSoftening: uniform(forceParams.attractorSoftening),
  attractorPos0: uniform(new Vector3()),
  attractorPos1: uniform(new Vector3()),
  attractorPos2: uniform(new Vector3()),
  shapeIndex: uniform(0),
  shapeFrom: uniform(0),
  shapeTo: uniform(0),
  morph: uniform(1),
  morphing: uniform(0),
  morphStagger: uniform(forceParams.morphStagger),
  springStrength: uniform(forceParams.springStrength),
  springDamping: uniform(forceParams.springDamping),
  shapeRadius: uniform(forceParams.shapeRadius),
  shapeThickness: uniform(forceParams.shapeThickness),
  shapeSpin: uniform(forceParams.shapeSpin),
  burstSpring: uniform(forceParams.burstSpring),
  shapeFlowDamp: uniform(forceParams.shapeFlowDamp),
};

/** Live CPU-side force state (read-only for other modules). */
export const forceState = {
  attractors: [new Vector3(), new Vector3(), new Vector3()] as Vector3[],
};

const morphState = { from: 0, to: 0, morph: 1 };

export function setShape(name: string): void {
  const i = (SHAPES as readonly string[]).indexOf(name);
  if (i < 0) return;
  forceParams.shape = name as ShapeName;
  if (i === morphState.to && morphState.morph >= 1) return;
  // mid-morph: start from whichever end is closer so the retarget does not pop far
  if (morphState.morph < 1) morphState.from = morphState.morph > 0.5 ? morphState.to : morphState.from;
  else morphState.from = morphState.to;
  morphState.to = i;
  morphState.morph = morphState.from === i ? 1 : 0;
  forceUniforms.shapeIndex.value = i;
}

export function syncForceUniforms(dt: number, time: number): void {
  const p = forceParams;
  const u = forceUniforms;
  // tolerate anyone assigning forceParams.shape directly
  if (p.shape !== SHAPES[morphState.to]) setShape(p.shape);

  // morph progression
  if (morphState.morph < 1) {
    morphState.morph = Math.min(1, morphState.morph + dt / Math.max(0.01, p.morphTime));
    if (morphState.morph >= 1) morphState.from = morphState.to;
  }
  u.shapeFrom.value = morphState.from;
  u.shapeTo.value = morphState.to;
  u.morph.value = morphState.morph;
  u.morphing.value = morphState.morph < 1 ? 1 : 0;

  u.gravity.value = p.gravity;
  u.drag.value = p.drag;
  u.maxSpeed.value = p.maxSpeed;
  u.curlStrength.value = p.curlStrength;
  u.curlScale.value = p.curlScale;
  u.curlSpeed.value = p.curlSpeed;

  u.swirl.value = p.swirl;
  const ax = u.vortexAxis.value as Vector3;
  ax.set(p.vortexAxisX, p.vortexAxisY, p.vortexAxisZ);
  if (ax.lengthSq() < 1e-6) ax.set(0, 1, 0);
  ax.normalize();
  u.vortexCore.value = Math.max(0.01, p.vortexCore);
  u.vortexFalloff.value = p.vortexFalloff;
  u.vortexPull.value = p.vortexPull;
  u.vortexLift.value = p.vortexLift;

  u.attractorCount.value = Math.max(0, Math.min(3, Math.round(p.attractorCount)));
  u.attractorStrength.value = p.attractorStrength;
  u.attractorFalloff.value = p.attractorFalloff;
  u.attractorSoftening.value = Math.max(0.01, p.attractorSoftening);
  // three slow Lissajous orbits about the kit centre
  const R = p.attractorOrbit;
  const w = p.attractorSpeed;
  const targets = [u.attractorPos0, u.attractorPos1, u.attractorPos2];
  for (let k = 0; k < 3; k++) {
    const a = forceState.attractors[k]!;
    a.set(
      R * Math.sin(w * (1 + 0.31 * k) * time + 2.1 * k),
      R * 0.6 * Math.sin(w * (0.7 + 0.23 * k) * time + 1.3 * k),
      R * Math.cos(w * (0.9 + 0.17 * k) * time + 0.7 * k),
    );
    (targets[k]!.value as Vector3).copy(a);
  }

  u.morphStagger.value = Math.max(0, Math.min(1, p.morphStagger));
  u.springStrength.value = p.springStrength;
  u.springDamping.value = p.springDamping;
  u.shapeRadius.value = p.shapeRadius;
  u.shapeThickness.value = p.shapeThickness;
  u.shapeSpin.value = p.shapeSpin;
  u.burstSpring.value = p.burstSpring;
  u.shapeFlowDamp.value = p.shapeFlowDamp;
}

export interface ForceContext {
  time: TNode;
  kit: KitInfo;
  lifeBuffer: TNode;
  positionBuffer: TNode;
  velocityBuffer: TNode;
}

export function buildAcceleration(ctx: ForceContext): TNode {
  const u = forceUniforms;
  const { kit } = ctx;

  // One private read-only-by-convention buffer: [0, ledCount) = LED positions, then 2 entries per hoop segment (a, b).
  const ledCount = kit.ledCount;
  const segCount = Math.floor(kit.hoopSegments.length / 6);
  const kitBuf = instancedArray(ledCount + 2 * segCount, 'vec4');
  {
    const arr = kitBuf.value.array as Float32Array;
    for (let i = 0; i < ledCount; i++) {
      arr[i * 4] = kit.ledPositions[i * 3]!;
      arr[i * 4 + 1] = kit.ledPositions[i * 3 + 1]!;
      arr[i * 4 + 2] = kit.ledPositions[i * 3 + 2]!;
      arr[i * 4 + 3] = 1;
    }
    for (let s = 0; s < segCount; s++) {
      for (let e = 0; e < 2; e++) {
        const o = (ledCount + s * 2 + e) * 4;
        arr[o] = kit.hoopSegments[s * 6 + e * 3]!;
        arr[o + 1] = kit.hoopSegments[s * 6 + e * 3 + 1]!;
        arr[o + 2] = kit.hoopSegments[s * 6 + e * 3 + 2]!;
        arr[o + 3] = 1;
      }
    }
    kitBuf.value.needsUpdate = true;
  }

  // ---- curl noise -----------------------------------------------------------------------------
  const noise3 = (p: TNode): TNode => mx_noise_vec3(p);
  /** curl of the vector potential (n1,n2,n3)(p): central differences, divergence-free by construction. */
  const curlNoise = Fn(([p]: TNode[]) => {
    const e = float(0.1);
    const dx = vec3(e, 0, 0);
    const dy = vec3(0, e, 0);
    const dz = vec3(0, 0, e);
    const ddx = noise3(p.add(dx)).sub(noise3(p.sub(dx)));
    const ddy = noise3(p.add(dy)).sub(noise3(p.sub(dy)));
    const ddz = noise3(p.add(dz)).sub(noise3(p.sub(dz)));
    return vec3(ddy.z.sub(ddz.y), ddz.x.sub(ddx.z), ddx.y.sub(ddy.x)).div(e.mul(2));
  });

  // ---- shape targets --------------------------------------------------------------------------
  /** Point on shape `sIdx` for the particle with `seed`/`index`. All shapes in lab metres, centred on the origin. */
  const shapeTarget = Fn(([sIdx, seed, index]: TNode[]) => {
    const R = u.shapeRadius;
    const s7 = seed.mul(1e7);
    const r = (k: number): TNode => hash(s7.add(k * 104729));
    const r1 = r(1);
    const r2 = r(2);
    const r3 = r(3);
    const r4 = r(4);
    const r5 = r(5);
    const out = vec3(0, 0, 0).toVar();

    If(sIdx.lessThan(0.5), () => {
      out.assign(vec3(0, 0, 0));
    })
      .ElseIf(sIdx.lessThan(1.5), () => {
        // sphere shell
        const z = r1.mul(2).sub(1);
        const phi = r2.mul(PI2);
        const s = sqrt(max(float(1).sub(z.mul(z)), 0));
        out.assign(vec3(s.mul(cos(phi)), z, s.mul(sin(phi))).mul(R));
      })
      .ElseIf(sIdx.lessThan(2.5), () => {
        // double helix, axis Y, 3 turns
        const strand = step(0.5, r4);
        const a = r1.mul(PI2).mul(3).add(strand.mul(PI));
        const hr = R.mul(0.55);
        out.assign(vec3(hr.mul(cos(a)), r1.sub(0.5).mul(R).mul(2.4), hr.mul(sin(a))));
      })
      .ElseIf(sIdx.lessThan(3.5), () => {
        // 6 stacked hoops, bulging in the middle
        const k = floor(r1.mul(5.999));
        const yn = k.div(5).sub(0.5);
        const rad = R.mul(float(0.55).add(cos(yn.mul(PI)).mul(0.35)));
        const a = r2.mul(PI2);
        out.assign(vec3(rad.mul(cos(a)), yn.mul(R).mul(2), rad.mul(sin(a))));
      })
      .ElseIf(sIdx.lessThan(4.5), () => {
        // torus surface (major = R, minor = 0.3 R)
        const a = r1.mul(PI2);
        const b = r2.mul(PI2);
        const rr = R.mul(0.3);
        const ring = R.add(rr.mul(cos(b)));
        out.assign(vec3(ring.mul(cos(a)), rr.mul(sin(b)), ring.mul(sin(a))));
      })
      .ElseIf(sIdx.lessThan(5.5), () => {
        // 6x6x6 wire lattice: nodes on two axes, continuous along the third
        const node = floor(vec3(r1, r2, r3).mul(5.999)).div(5).sub(0.5).mul(2).mul(R);
        const axis = floor(r4.mul(2.999));
        const cont = vec3(select(axis.lessThan(0.5), float(1), float(0)), select(axis.lessThan(0.5), float(0), select(axis.lessThan(1.5), float(1), float(0))), select(axis.greaterThan(1.5), float(1), float(0)));
        out.assign(mix(node, r5.mul(2).sub(1).mul(R), cont));
      })
      .ElseIf(sIdx.lessThan(6.5), () => {
        // the kit's real LED positions: particle i -> LED i % ledCount
        const f = float(index);
        const li = f.sub(floor(f.div(ledCount)).mul(ledCount));
        out.assign(kitBuf.element(int(li)).xyz);
      })
      .Else(() => {
        // random point on a random hoop segment
        const sg = floor(r1.mul(segCount - 0.001));
        const a = kitBuf.element(int(sg.mul(2).add(ledCount))).xyz;
        const b = kitBuf.element(int(sg.mul(2).add(ledCount + 1))).xyz;
        out.assign(mix(a, b, r2));
      });

    // procedural shapes spin about Y
    const ang = ctx.time.mul(u.shapeSpin);
    const c = cos(ang);
    const sn = sin(ang);
    If(sIdx.greaterThan(0.5).and(sIdx.lessThan(5.5)), () => {
      out.assign(vec3(out.x.mul(c).sub(out.z.mul(sn)), out.y, out.x.mul(sn).add(out.z.mul(c))));
    });
    // scatter for thickness
    out.addAssign(vec3(r(6), r(7), r(8)).mul(2).sub(1).mul(u.shapeThickness));
    return out;
  });

  // ---- acceleration ---------------------------------------------------------------------------
  return Fn(([position, velocity, index]: TNode[]) => {
    const lf = ctx.lifeBuffer.element(index);
    const seed = lf.z;
    const tag = lf.w;

    const acc = vec3(0, 0, 0).toVar();

    // 1) spring (with damping) to the current / morphing shape target. `hold` in [0,1] = how strongly this particle
    //    is held to a shape right now; it attenuates the ambient flow below so shapes stay recognisable.
    const hold = float(0).toVar();
    If(u.shapeFrom.greaterThan(0.5).or(u.shapeTo.greaterThan(0.5)), () => {
      const wBurst = mix(float(1), u.burstSpring, tag);
      const pull = vec3(0, 0, 0).toVar();
      const w = float(1).toVar();
      const tTo = shapeTarget(u.shapeTo, seed, index);
      If(u.morphing.greaterThan(0.5), () => {
        const tFrom = shapeTarget(u.shapeFrom, seed, index);
        const wFrom = select(u.shapeFrom.greaterThan(0.5), float(1), float(0));
        const wTo = select(u.shapeTo.greaterThan(0.5), float(1), float(0));
        // per-particle staggered, eased morph progress
        const delay = hash(seed.mul(1e7).add(777)).mul(u.morphStagger);
        const m = smoothstep(0, 1, u.morph.mul(float(1).add(u.morphStagger)).sub(delay).clamp(0, 1));
        pull.assign(mix(tFrom.sub(position).mul(wFrom), tTo.sub(position).mul(wTo), m));
        w.assign(mix(wFrom, wTo, m));
      }).Else(() => {
        pull.assign(tTo.sub(position));
      });
      const k = u.springStrength.mul(wBurst);
      acc.addAssign(pull.mul(k));
      acc.subAssign(velocity.mul(u.springDamping.mul(2).mul(sqrt(k)).mul(w)));
      hold.assign(w.mul(wBurst));
    });
    const flow = float(1).sub(hold.mul(u.shapeFlowDamp));

    // 2) gravity + curl-noise flow, evolving in time
    const t = ctx.time.mul(u.curlSpeed);
    const drift = vec3(0.7, 1.0, 0.5).mul(t).add(vec3(sin(t.mul(0.9)), 0, cos(t.mul(1.1))).mul(0.7));
    acc.addAssign(vec3(0, u.gravity, 0).add(curlNoise(position.mul(u.curlScale).add(drift)).mul(u.curlStrength)).mul(flow));

    // 3) vortex about a configurable axis through the kit centre
    {
      const axis = u.vortexAxis;
      const perp = position.sub(axis.mul(dot(position, axis)));
      const rr = length(perp);
      const c = u.vortexCore;
      const prof = c.mul(rr).mul(2).div(rr.mul(rr).add(c.mul(c))).mul(exp(rr.mul(u.vortexFalloff).negate()));
      const unitPerp = perp.div(rr.add(1e-4));
      const tang = cross(axis, unitPerp);
      acc.addAssign(tang.mul(u.swirl).add(unitPerp.mul(u.vortexPull.negate())).add(axis.mul(u.vortexLift)).mul(prof).mul(flow));
    }

    // 4) 1-3 orbiting point attractors (not attenuated by shapes: they are the deliberate disturbance)
    const attractors = [u.attractorPos0, u.attractorPos1, u.attractorPos2];
    attractors.forEach((ap, k) => {
      If(u.attractorCount.greaterThan(k + 0.5), () => {
        const d = ap.sub(position);
        const s = u.attractorSoftening;
        const d2 = dot(d, d).add(s.mul(s));
        const mag = pow(s.mul(s).div(d2), u.attractorFalloff.mul(0.5)).mul(u.attractorStrength);
        acc.addAssign(d.div(sqrt(d2)).mul(mag));
      });
    });

    // 5) soft speed limit
    If(u.maxSpeed.greaterThan(0.001), () => {
      const sp = length(velocity);
      acc.subAssign(velocity.div(sp.add(1e-4)).mul(max(sp.sub(u.maxSpeed), 0)).mul(15));
    });

    return acc;
  });
}

export function registerForcePanel(folder: GUI): void {
  const flow = folder.addFolder('Flow');
  flow.add(forceParams, 'gravity', -5, 5, 0.01);
  flow.add(forceParams, 'drag', 0, 5, 0.01);
  flow.add(forceParams, 'maxSpeed', 0, 20, 0.1).name('maxSpeed (0=off)');

  const curl = folder.addFolder('Curl noise');
  curl.add(forceParams, 'curlStrength', 0, 10, 0.01).name('strength');
  curl.add(forceParams, 'curlScale', 0.05, 4, 0.01).name('scale');
  curl.add(forceParams, 'curlSpeed', 0, 2, 0.01).name('speed');

  const vortex = folder.addFolder('Vortex');
  vortex.add(forceParams, 'swirl', -6, 6, 0.01).name('strength');
  vortex.add(forceParams, 'vortexAxisX', -1, 1, 0.01).name('axis x');
  vortex.add(forceParams, 'vortexAxisY', -1, 1, 0.01).name('axis y');
  vortex.add(forceParams, 'vortexAxisZ', -1, 1, 0.01).name('axis z');
  vortex.add(forceParams, 'vortexCore', 0.05, 3, 0.01).name('core radius');
  vortex.add(forceParams, 'vortexFalloff', 0, 2, 0.01).name('falloff');
  vortex.add(forceParams, 'vortexPull', -6, 6, 0.01).name('inward pull');
  vortex.add(forceParams, 'vortexLift', -6, 6, 0.01).name('axial lift');

  const attr = folder.addFolder('Attractors');
  attr.add(forceParams, 'attractorCount', 0, 3, 1).name('count');
  attr.add(forceParams, 'attractorStrength', -20, 20, 0.1).name('strength');
  attr.add(forceParams, 'attractorFalloff', 0.5, 4, 0.05).name('falloff');
  attr.add(forceParams, 'attractorSoftening', 0.02, 2, 0.01).name('softening');
  attr.add(forceParams, 'attractorOrbit', 0, 3, 0.01).name('orbit radius');
  attr.add(forceParams, 'attractorSpeed', 0, 4, 0.01).name('orbit speed');

  const shape = folder.addFolder('Shape');
  shape.add(forceParams, 'shape', [...SHAPES]).onChange((v: string) => setShape(v)).listen();
  shape.add(forceParams, 'springStrength', 0, 60, 0.1).name('spring');
  shape.add(forceParams, 'springDamping', 0, 2, 0.01).name('damping ratio');
  shape.add(forceParams, 'shapeRadius', 0.1, 3, 0.01).name('radius');
  shape.add(forceParams, 'shapeThickness', 0, 0.5, 0.001).name('thickness');
  shape.add(forceParams, 'shapeSpin', -3, 3, 0.01).name('spin');
  shape.add(forceParams, 'morphTime', 0.05, 8, 0.05).name('morph time');
  shape.add(forceParams, 'morphStagger', 0, 1, 0.01).name('morph stagger');
  shape.add(forceParams, 'burstSpring', 0, 1, 0.01).name('burst spring');
  shape.add(forceParams, 'shapeFlowDamp', 0, 1, 0.01).name('calm flow in shape');
}
