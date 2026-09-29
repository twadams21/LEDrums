/**
 * particles.ts — GPU particle storage + init/update compute + GPU burst emit.   (FOUNDATION-OWNED, stable)
 *
 * Nothing per-particle ever touches the CPU. All state lives in four vec4 storage buffers that the
 * sampler (LED colours) and the look (world view) read directly.
 *
 * BUFFER LAYOUT (all `instancedArray(count,'vec4')` storage nodes, index = particle id 0..count-1)
 *   position : xyz = metres (lab world space, kit centre = origin), w = SIZE (metres, sprite diameter)
 *   velocity : xyz = m/s, w = unused
 *   color    : rgb = linear HDR colour, a = CURRENT INTENSITY 0..1 (update kernel writes the life fade here;
 *              consumers should use rgb*a as the particle's emitted light)
 *   life     : x = age (s), y = lifespan (s), z = per-particle seed in [0,1) (constant, for shape targets etc.),
 *              w = tag (0 ambient, 1 burst; actions may repurpose)
 *
 * EXPORTS
 *  createParticles({ renderer, count }): ParticleSystem
 *  ParticleSystem
 *    .count                 number of particles
 *    .buffers               { position, velocity, color, life }  storage nodes (use .element(i) in compute,
 *                           .toAttribute() in materials)
 *    .uniforms              { dt, time }  TSL uniforms updated by update()
 *    .emit(req: EmitRequest)   queue a burst: respawns the next `count` particles (ring cursor) at req.origin.
 *                           Consumed inside the update compute via uniforms; at most MAX_BURSTS_PER_FRAME per frame.
 *    .update(dt, time)      run one simulation step (called by main each frame after syncForceUniforms)
 *    .reseed()              re-run the init kernel (fresh random field)
 *    .kernels               { init, update } compute nodes (actions may renderer.compute() their own kernels
 *                           that read/write the same buffers between frames)
 *  EmitRequest { origin:[x,y,z] (lab metres); count; speed? (m/s, default 3); spread? (0 = along `direction`,
 *                1 = full sphere, default 1); direction? ([x,y,z], default [0,1,0]); color? ([r,g,b] linear HDR,
 *                default [1,1,1]); life? (s, default 1.6); size? (m, default particleParams.burstSize) }
 *  particleParams        plain mutable object (CPU knobs mirrored into uniforms each update): lifeMin, lifeMax,
 *                        sizeMin, sizeMax, burstSize, ambientBrightness, ambientColorA/B ([r,g,b]), spawnScale
 *                        (fraction of kit.domainHalfExtent that ambient respawns fill)
 *  registerParticlePanel(folder)
 *  getParticleCount(): number   reads ?n= from the URL (default 100_000, clamped 1k..2M)
 *  MAX_BURSTS_PER_FRAME
 *
 * SIM RULES (per particle per step): age += dt; if burst-target -> respawn at origin; else if expired or far outside
 * the domain -> respawn ambient in the domain box; else  v += accel*dt (forces.ts); v *= exp(-drag*dt); p += v*dt.
 */
import {
  Fn, If, instancedArray, instanceIndex, uniform, vec3, vec4, float, uint, hash, select, exp, smoothstep, oneMinus,
  abs, max, cos, sin, PI, normalize, mix,
} from './tsl';
import { Vector3, type WebGPURenderer } from 'three/webgpu';
import type GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { kit } from './kit';
import { buildAcceleration, forceUniforms } from './forces';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TNode = any;

export const MAX_BURSTS_PER_FRAME = 8;

export interface EmitRequest {
  origin: [number, number, number];
  count: number;
  speed?: number;
  spread?: number;
  direction?: [number, number, number];
  color?: [number, number, number];
  life?: number;
  size?: number;
}

export const particleParams = {
  lifeMin: 3,
  lifeMax: 9,
  sizeMin: 0.012,
  sizeMax: 0.03,
  burstSize: 0.028,
  ambientBrightness: 0.35,
  ambientColorA: [0.1, 0.45, 1.0] as [number, number, number],
  ambientColorB: [1.0, 0.25, 0.7] as [number, number, number],
  spawnScale: 0.85,
};

export interface ParticleBuffers {
  position: TNode;
  velocity: TNode;
  color: TNode;
  life: TNode;
}

export interface ParticleSystem {
  readonly count: number;
  readonly buffers: ParticleBuffers;
  readonly uniforms: { dt: TNode; time: TNode };
  readonly kernels: { init: TNode; update: TNode };
  emit(req: EmitRequest): void;
  update(dt: number, time: number): void;
  reseed(): void;
}

export function getParticleCount(): number {
  const raw = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('n') : null;
  const n = raw ? Math.floor(Number(raw)) : 100_000;
  return Number.isFinite(n) && n > 0 ? Math.min(2_000_000, Math.max(1_000, n)) : 100_000;
}

export function createParticles({ renderer, count }: { renderer: WebGPURenderer; count: number }): ParticleSystem {
  const N = count;
  const position = instancedArray(N, 'vec4');
  const velocity = instancedArray(N, 'vec4');
  const color = instancedArray(N, 'vec4');
  const life = instancedArray(N, 'vec4');

  // ---- uniforms -------------------------------------------------------------------------------
  const dt = uniform(0.016);
  const time = uniform(0);
  const frameU = uniform(0, 'uint');
  const emitStart = uniform(0);
  const emitCount = uniform(0);
  const emitOrigin = uniform(new Vector3(0, 0, 0));
  const emitDir = uniform(new Vector3(0, 1, 0));
  const emitSpeed = uniform(3);
  const emitSpread = uniform(1);
  const emitColor = uniform(new Vector3(1, 1, 1));
  const emitLife = uniform(1.6);
  const emitSize = uniform(0.028);
  const domainHalf = uniform(new Vector3(...kit.domainHalfExtent));
  const lifeMin = uniform(particleParams.lifeMin);
  const lifeMax = uniform(particleParams.lifeMax);
  const sizeMin = uniform(particleParams.sizeMin);
  const sizeMax = uniform(particleParams.sizeMax);
  const ambBright = uniform(particleParams.ambientBrightness);
  const ambA = uniform(new Vector3(...particleParams.ambientColorA));
  const ambB = uniform(new Vector3(...particleParams.ambientColorB));
  const spawnScale = uniform(particleParams.spawnScale);

  const accel = buildAcceleration({ time, kit, lifeBuffer: life, positionBuffer: position, velocityBuffer: velocity });

  // ---- shared TSL helpers ---------------------------------------------------------------------
  /** deterministic per-(particle, frame, k) random in [0,1) */
  const rnd = (k: number): TNode =>
    hash(instanceIndex.mul(uint(747796405)).add(frameU.mul(uint(2891336453))).add(uint(k * 26699 + 1)));
  const unitSphere = (ka: number, kb: number): TNode => {
    const z = rnd(ka).mul(2).sub(1);
    const phi = rnd(kb).mul(PI).mul(2);
    const s = oneMinus(z.mul(z)).max(0).sqrt();
    return vec3(s.mul(cos(phi)), z, s.mul(sin(phi)));
  };

  /** ambient respawn: writes all four buffers for this particle. `randomAge` scatters initial ages. */
  const spawnAmbient = (randomAge: boolean): void => {
    const i = instanceIndex;
    const lifespan = mix(lifeMin, lifeMax, rnd(1));
    const box = vec3(rnd(2).mul(2).sub(1), rnd(3).mul(2).sub(1), rnd(4).mul(2).sub(1)).mul(domainHalf).mul(spawnScale);
    const v = unitSphere(5, 6).mul(0.15);
    const c = mix(ambA, ambB, rnd(7)).mul(ambBright);
    const size = mix(sizeMin, sizeMax, rnd(8));
    const age = randomAge ? rnd(9).mul(lifespan) : float(0);
    // seed: stable per particle — derive from index only so it survives respawns
    const seed = hash(i.mul(uint(2654435761)).add(uint(12345)));
    position.element(i).assign(vec4(box, size));
    velocity.element(i).assign(vec4(v, 0));
    color.element(i).assign(vec4(c, 0));
    life.element(i).assign(vec4(age, lifespan, seed, 0));
  };

  // ---- init kernel ----------------------------------------------------------------------------
  const initKernel = Fn(() => {
    spawnAmbient(true);
  })().compute(N);

  // ---- update kernel --------------------------------------------------------------------------
  const updateKernel = Fn(() => {
    const i = instanceIndex;
    const rel = float(i).sub(emitStart);
    const relW = select(rel.lessThan(0), rel.add(float(N)), rel);

    const pos4 = position.element(i).toVar();
    const vel4 = velocity.element(i).toVar();
    const col4 = color.element(i).toVar();
    const lf = life.element(i).toVar();

    const age = lf.x.add(dt);
    const ap = abs(pos4.xyz);
    const lim = domainHalf.mul(2);
    const outside = ap.x.greaterThan(lim.x).or(ap.y.greaterThan(lim.y)).or(ap.z.greaterThan(lim.z));

    If(relW.lessThan(emitCount), () => {
      // GPU burst respawn at emitOrigin
      const dir = normalize(mix(emitDir, unitSphere(11, 12), emitSpread).add(vec3(0, 1e-5, 0)));
      const sp = emitSpeed.mul(mix(0.55, 1.0, rnd(13)));
      const lifespan = emitLife.mul(mix(0.7, 1.3, rnd(14)));
      const jitter = unitSphere(15, 16).mul(0.02);
      position.element(i).assign(vec4(emitOrigin.add(jitter), emitSize.mul(mix(0.7, 1.4, rnd(17)))));
      velocity.element(i).assign(vec4(dir.mul(sp), 0));
      color.element(i).assign(vec4(emitColor, 1));
      life.element(i).assign(vec4(0, lifespan, lf.z, 1));
    })
      .ElseIf(age.greaterThanEqual(lf.y).or(outside), () => {
        spawnAmbient(false);
      })
      .Else(() => {
        const a = accel(pos4.xyz, vel4.xyz, i);
        const v = vel4.xyz.add(a.mul(dt)).mul(exp(forceUniforms.drag.mul(dt).negate()));
        const p = pos4.xyz.add(v.mul(dt));
        const t = age.div(max(lf.y, 1e-4));
        const fade = smoothstep(0, 0.06, t).mul(oneMinus(smoothstep(0.65, 1, t)));
        position.element(i).assign(vec4(p, pos4.w));
        velocity.element(i).assign(vec4(v, 0));
        color.element(i).assign(vec4(col4.xyz, fade));
        life.element(i).assign(vec4(age, lf.y, lf.z, lf.w));
      });
  })().compute(N);

  // ---- CPU side: burst queue ------------------------------------------------------------------
  const queue: EmitRequest[] = [];
  let cursor = 0;
  let frame = 0;

  const setBurst = (b: EmitRequest | null): void => {
    if (!b) {
      emitCount.value = 0;
      return;
    }
    const n = Math.min(N, Math.max(0, Math.floor(b.count)));
    emitStart.value = cursor;
    emitCount.value = n;
    cursor = (cursor + n) % N;
    emitOrigin.value.set(b.origin[0], b.origin[1], b.origin[2]);
    const d = b.direction ?? [0, 1, 0];
    emitDir.value.set(d[0], d[1], d[2]).normalize();
    emitSpeed.value = b.speed ?? 3;
    emitSpread.value = b.spread ?? 1;
    const c = b.color ?? [1, 1, 1];
    emitColor.value.set(c[0], c[1], c[2]);
    emitLife.value = b.life ?? 1.6;
    emitSize.value = b.size ?? particleParams.burstSize;
  };

  const syncParams = (): void => {
    lifeMin.value = particleParams.lifeMin;
    lifeMax.value = particleParams.lifeMax;
    sizeMin.value = particleParams.sizeMin;
    sizeMax.value = particleParams.sizeMax;
    ambBright.value = particleParams.ambientBrightness;
    ambA.value.set(...particleParams.ambientColorA);
    ambB.value.set(...particleParams.ambientColorB);
    spawnScale.value = particleParams.spawnScale;
  };

  const step = (dtSeconds: number): void => {
    dt.value = dtSeconds;
    frame = (frame + 1) >>> 0;
    frameU.value = frame;
    renderer.compute(updateKernel);
  };

  let initialised = false;
  const ensureInit = (): void => {
    if (initialised) return;
    initialised = true;
    syncParams();
    frameU.value = 1;
    renderer.compute(initKernel);
  };

  return {
    count: N,
    buffers: { position, velocity, color, life },
    uniforms: { dt, time },
    kernels: { init: initKernel, update: updateKernel },
    emit(req) {
      if (queue.length < MAX_BURSTS_PER_FRAME) queue.push(req);
    },
    update(dtSeconds, t) {
      ensureInit();
      syncParams();
      time.value = t;
      const bursts = queue.splice(0, MAX_BURSTS_PER_FRAME);
      if (bursts.length === 0) {
        setBurst(null);
        step(dtSeconds);
      } else {
        bursts.forEach((b, k) => {
          setBurst(b);
          step(k === 0 ? dtSeconds : 0);
        });
      }
    },
    reseed() {
      initialised = false;
      ensureInit();
    },
  };
}

export function registerParticlePanel(folder: GUI): void {
  folder.add(particleParams, 'ambientBrightness', 0, 3, 0.01);
  folder.addColor(particleParams, 'ambientColorA');
  folder.addColor(particleParams, 'ambientColorB');
  folder.add(particleParams, 'lifeMin', 0.2, 20, 0.1);
  folder.add(particleParams, 'lifeMax', 0.2, 30, 0.1);
  folder.add(particleParams, 'sizeMin', 0.002, 0.1, 0.001);
  folder.add(particleParams, 'sizeMax', 0.002, 0.15, 0.001);
  folder.add(particleParams, 'burstSize', 0.002, 0.15, 0.001);
  folder.add(particleParams, 'spawnScale', 0.1, 1.5, 0.01);
}
