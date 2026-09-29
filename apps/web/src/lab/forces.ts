/**
 * forces.ts — per-particle acceleration field + shape springs.   (STUB — owned by the FORCES agent)
 *
 * The forces agent may rewrite everything in this file freely as long as the EXPORTS below keep
 * their signatures. It must NOT need to edit particles.ts / main.ts.
 *
 * CONTRACT (stable, consumed by particles.ts / actions.ts / panel.ts)
 *  forceParams        plain mutable object (CPU-side knobs; the panel and actions mutate it):
 *                       gravity        m/s^2, applied along world Y (negative = down)
 *                       drag           1/s   linear-ish damping; particles.ts applies  v *= exp(-drag*dt)
 *                                      AFTER integrating the acceleration below (do NOT apply drag in the accel fn)
 *                       curlStrength   m/s^2 amplitude of the noise/curl field
 *                       curlScale      1/m   spatial frequency of the field
 *                       curlSpeed      1/s   time evolution speed of the field
 *                       shape          current shape name (one of SHAPES); set it via setShape()
 *                       springStrength 1/s^2 spring constant pulling each particle to its shape target ('none' = off)
 *                       (the forces agent may ADD more numeric fields; keep the ones above)
 *  forceUniforms      TSL uniform nodes mirroring forceParams (created once). Never replaced.
 *  SHAPES             readonly string[] of valid shape names; 'none' is always first and means "no spring".
 *  setShape(name)     switch shape (updates forceParams.shape + shape-index uniform). Unknown names are ignored.
 *  syncForceUniforms(dt, time)   called by main every frame BEFORE the particle compute: copies forceParams
 *                     into forceUniforms and advances any CPU-driven force state. `time` is seconds since start.
 *  buildAcceleration(ctx)  called ONCE by particles.ts while building the update kernel. Returns a TSL Fn
 *                     (position: vec3, velocity: vec3, index: uint) => vec3 acceleration in m/s^2. It runs inside the
 *                     particle update compute for every live particle. It may read ctx.lifeBuffer.element(index)
 *                     (x=age, y=lifespan, z=per-particle seed in [0,1), w=tag) for per-particle behaviour
 *                     such as shape targets.
 *  registerForcePanel(folder)  add lil-gui controllers for the params to `folder` (a lil-gui GUI/folder).
 *  ForceContext       { time: uniform<float> seconds; kit: KitInfo; lifeBuffer: storage vec4 node;
 *                       positionBuffer / velocityBuffer: storage vec4 nodes (xyz used) }
 */
import { Fn, float, hash, mx_noise_vec3, cross, sin, cos, uniform, vec3, If, PI } from './tsl';
import type GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { KitInfo } from './kit';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TNode = any;

export const SHAPES = ['none', 'sphere', 'torus'] as const;
export type ShapeName = (typeof SHAPES)[number];

export const forceParams = {
  gravity: -0.4,
  drag: 0.7,
  curlStrength: 1.4,
  curlScale: 0.7,
  curlSpeed: 0.12,
  shape: 'none' as ShapeName,
  springStrength: 6,
  shapeRadius: 0.9,
  swirl: 0.6,
};

export const forceUniforms = {
  gravity: uniform(forceParams.gravity),
  drag: uniform(forceParams.drag),
  curlStrength: uniform(forceParams.curlStrength),
  curlScale: uniform(forceParams.curlScale),
  curlSpeed: uniform(forceParams.curlSpeed),
  shapeIndex: uniform(0),
  springStrength: uniform(forceParams.springStrength),
  shapeRadius: uniform(forceParams.shapeRadius),
  swirl: uniform(forceParams.swirl),
};

export function setShape(name: string): void {
  const i = (SHAPES as readonly string[]).indexOf(name);
  if (i < 0) return;
  forceParams.shape = name as ShapeName;
  forceUniforms.shapeIndex.value = i;
}

export function syncForceUniforms(_dt: number, _time: number): void {
  forceUniforms.gravity.value = forceParams.gravity;
  forceUniforms.drag.value = forceParams.drag;
  forceUniforms.curlStrength.value = forceParams.curlStrength;
  forceUniforms.curlScale.value = forceParams.curlScale;
  forceUniforms.curlSpeed.value = forceParams.curlSpeed;
  forceUniforms.springStrength.value = forceParams.springStrength;
  forceUniforms.shapeRadius.value = forceParams.shapeRadius;
  forceUniforms.swirl.value = forceParams.swirl;
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
  return Fn(([position, velocity, index]: TNode[]) => {
    void velocity;
    const seed = ctx.lifeBuffer.element(index).z;

    // noise field (a real curl field is the forces agent's job)
    const p = position.mul(u.curlScale).add(vec3(0, ctx.time.mul(u.curlSpeed), 0));
    const noise = mx_noise_vec3(p).mul(u.curlStrength);

    // swirl around the vertical axis through the kit centre
    const radial = vec3(position.x, 0, position.z);
    const swirl = cross(vec3(0, 1, 0), radial).mul(u.swirl);

    const acc = vec3(0, u.gravity, 0).add(noise).add(swirl).toVar();

    // spring to a per-particle shape target
    If(u.shapeIndex.greaterThan(0.5), () => {
      const r1 = hash(seed.mul(1e7).add(11));
      const r2 = hash(seed.mul(1e7).add(23));
      const r3 = hash(seed.mul(1e7).add(37));
      const target = vec3(0).toVar();
      If(u.shapeIndex.lessThan(1.5), () => {
        // sphere
        const z = r1.mul(2).sub(1);
        const phi = r2.mul(PI).mul(2);
        const s = float(1).sub(z.mul(z)).sqrt();
        target.assign(vec3(s.mul(cos(phi)), z, s.mul(sin(phi))).mul(u.shapeRadius));
      }).Else(() => {
        // torus (major radius = shapeRadius, minor = 0.25*shapeRadius)
        const a = r1.mul(PI).mul(2);
        const b = r2.mul(PI).mul(2);
        const R = u.shapeRadius;
        const rr = R.mul(0.25).mul(r3.sqrt());
        target.assign(vec3(R.add(rr.mul(cos(b))).mul(cos(a)), rr.mul(sin(b)), R.add(rr.mul(cos(b))).mul(sin(a))));
      });
      acc.addAssign(target.sub(position).mul(u.springStrength));
    });

    return acc;
  });
}

export function registerForcePanel(folder: GUI): void {
  folder.add(forceParams, 'gravity', -5, 5, 0.01);
  folder.add(forceParams, 'drag', 0, 5, 0.01);
  folder.add(forceParams, 'curlStrength', 0, 10, 0.01);
  folder.add(forceParams, 'curlScale', 0.05, 4, 0.01);
  folder.add(forceParams, 'curlSpeed', 0, 2, 0.01);
  folder.add(forceParams, 'swirl', -3, 3, 0.01);
  folder.add(forceParams, 'shape', [...SHAPES]).onChange((v: string) => setShape(v));
  folder.add(forceParams, 'springStrength', 0, 30, 0.1);
  folder.add(forceParams, 'shapeRadius', 0.1, 3, 0.01);
}
