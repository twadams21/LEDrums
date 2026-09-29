/**
 * sampler.ts — LED colour sampling of the particle field + the right-hand kit preview.   (FOUNDATION-OWNED, stable)
 *
 * One compute thread per LED gathers light from particles within `radius` metres (smooth (1-d²/r²)² falloff),
 * scaled by `gain` and `stride` (only every stride-th particle is visited, with a random per-frame offset, and the
 * result is multiplied by stride to stay unbiased — cost is O(ledCount * particleCount / stride)). Result is
 * temporally smoothed: led = max(led * decay^(dt*60), sample). Output stays on the GPU in `ledColor`.
 *
 * EXPORTS
 *  samplerParams  plain mutable object: radius (m), gain, stride (int >=1), decay (0..0.999 per-60fps-frame retention),
 *                 ledSize (m, preview sprite diameter), previewGain (preview brightness multiplier)
 *  createSampler({ renderer, particles }): Sampler
 *  Sampler
 *    .ledColor       storage vec4 node (count = kit.ledCount): rgb = linear HDR sampled colour, a = 1.
 *                    This is THE buffer a real output adapter / other agents should read.
 *    .ledPosition    storage vec4 node: xyz = LED metres (lab space), w = 1. Static.
 *    .preview        THREE.Group to add to the RIGHT scene (dim hoop lines + instanced glowing LED sprites reading
 *                    ledColor directly, no CPU copy)
 *    .update(dt)     run the sampling compute (called by main each frame after particles.update)
 *    .readback()     Promise<Float32Array> (ledCount*4) — DEBUG ONLY (GPU->CPU stall); used by lab-shot.mjs via window.__lab
 *  registerSamplerPanel(folder)
 */
import {
  Fn, If, Loop, instanceIndex, instancedArray, uniform, vec3, vec4, float, dot, oneMinus, max, smoothstep, length, uv,
} from './tsl';
import { AdditiveBlending, Group, Sprite, SpriteNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import type GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { kit, createHoopLines } from './kit';
import type { ParticleSystem } from './particles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TNode = any;

export const samplerParams = {
  radius: 0.2,
  gain: 0.012,
  stride: 4,
  decay: 0.85,
  ledSize: 0.024,
  previewGain: 1.0,
};

export interface Sampler {
  readonly ledColor: TNode;
  readonly ledPosition: TNode;
  readonly preview: Group;
  update(dt: number): void;
  readback(): Promise<Float32Array>;
}

export function createSampler({ renderer, particles }: { renderer: WebGPURenderer; particles: ParticleSystem }): Sampler {
  const nLed = kit.ledCount;
  const nPart = particles.count;

  const ledPosition = instancedArray(nLed, 'vec4');
  const ledColor = instancedArray(nLed, 'vec4');
  {
    const arr = ledPosition.value.array as Float32Array;
    for (let i = 0; i < nLed; i++) {
      arr[i * 4] = kit.ledPositions[i * 3]!;
      arr[i * 4 + 1] = kit.ledPositions[i * 3 + 1]!;
      arr[i * 4 + 2] = kit.ledPositions[i * 3 + 2]!;
      arr[i * 4 + 3] = 1;
    }
    ledPosition.value.needsUpdate = true;
  }

  const radius = uniform(samplerParams.radius);
  const gain = uniform(samplerParams.gain);
  const strideI = uniform(samplerParams.stride, 'int');
  const strideF = uniform(samplerParams.stride);
  const offsetI = uniform(0, 'int');
  const iters = uniform(nPart, 'int');
  const decayF = uniform(0.9);

  const kernel = Fn(() => {
    const li = instanceIndex;
    const lp = ledPosition.element(li).xyz;
    const acc = vec3(0, 0, 0).toVar();
    const r2 = radius.mul(radius);
    Loop(iters, ({ i }: { i: TNode }) => {
      const pi = i.mul(strideI).add(offsetI);
      const p = particles.buffers.position.element(pi);
      const d = p.xyz.sub(lp);
      const d2 = dot(d, d);
      If(d2.lessThan(r2), () => {
        const c = particles.buffers.color.element(pi);
        const w = oneMinus(d2.div(r2));
        acc.addAssign(c.xyz.mul(c.w).mul(w.mul(w)));
      });
    });
    const sample = acc.mul(gain).mul(strideF);
    const prev = ledColor.element(li).xyz;
    ledColor.element(li).assign(vec4(max(prev.mul(decayF), sample), 1));
  })().compute(nLed);

  // ---- preview (right viewport) ----------------------------------------------------------------
  const ledSize = uniform(samplerParams.ledSize);
  const previewGain = uniform(samplerParams.previewGain);
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const lc = ledColor.toAttribute();
  mat.positionNode = ledPosition.toAttribute().xyz;
  mat.scaleNode = ledSize;
  const dist = length(uv().sub(0.5)).mul(2);
  const soft = oneMinus(smoothstep(0.0, 1.0, dist));
  // Soft-knee tone curve so faint samples still read and hot ones don't clip flat.
  const lit = float(1).sub(lc.xyz.mul(previewGain).mul(-3).exp());
  mat.colorNode = vec3(0.015, 0.02, 0.035).add(lit);
  mat.opacityNode = soft.mul(soft).mul(float(0.35).add(lit.x.add(lit.y).add(lit.z).mul(0.4).clamp(0, 0.65)));
  const leds = new Sprite(mat);
  (leds as unknown as { count: number }).count = nLed;
  leds.frustumCulled = false;

  const preview = new Group();
  preview.add(createHoopLines(0x22314a, 0.6));
  preview.add(leds);

  return {
    ledColor,
    ledPosition,
    preview,
    update(dt) {
      radius.value = samplerParams.radius;
      gain.value = samplerParams.gain;
      const stride = Math.max(1, Math.floor(samplerParams.stride));
      strideI.value = stride;
      strideF.value = stride;
      const off = Math.floor(Math.random() * stride);
      offsetI.value = off;
      iters.value = Math.ceil((nPart - off) / stride);
      decayF.value = Math.pow(Math.min(0.999, Math.max(0, samplerParams.decay)), Math.max(0, dt) * 60);
      ledSize.value = samplerParams.ledSize;
      previewGain.value = samplerParams.previewGain;
      renderer.compute(kernel);
    },
    async readback() {
      const buf = await renderer.getArrayBufferAsync(ledColor.value);
      return new Float32Array(buf);
    },
  };
}

export function registerSamplerPanel(folder: GUI): void {
  folder.add(samplerParams, 'radius', 0.02, 1, 0.005);
  folder.add(samplerParams, 'gain', 0, 0.05, 0.0005);
  folder.add(samplerParams, 'stride', 1, 16, 1);
  folder.add(samplerParams, 'decay', 0, 0.99, 0.005);
  folder.add(samplerParams, 'ledSize', 0.005, 0.08, 0.001);
  folder.add(samplerParams, 'previewGain', 0, 4, 0.01);
}
