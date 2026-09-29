/**
 * look.ts — how the LEFT (world) view is drawn.   (STUB — owned by the LOOK agent)
 *
 * The look agent may rewrite everything in this file (materials, post-processing, trails, bloom, camera-facing
 * tricks…) as long as the EXPORTS keep their signatures. main.ts never needs editing.
 *
 * RENDER CONTRACT (how main.ts and look cooperate — read carefully, PostProcessing in r171 has no viewport support)
 *  - There is ONE WebGPURenderer / ONE canvas. main.ts splits it: LEFT half = world (this file), RIGHT half = kit preview.
 *  - Before it calls `look.render()`, main.ts has ALREADY: cleared the whole canvas (colour+depth) once for the frame,
 *    set `renderer.setViewport(0,0,w,h)` + `renderer.setScissor(0,0,w,h)` + `renderer.setScissorTest(true)` to the left
 *    half (CSS px, w = half the window), and set `renderer.autoClear = false`.
 *  - `render()` therefore must ONLY draw into "the current viewport" and must NOT touch renderer viewport / scissor /
 *    autoClear / render target on exit. It may freely use its own render targets internally.
 *  - Recommended (and what the stub does): `PostProcessing` whose outputNode chains from `pass(scene, camera)`.
 *    PostProcessing.render() draws a full-screen quad with the renderer's CURRENT viewport, so the quad lands in the left
 *    half and texture nodes using the default `uv()` map 0..1 across that half. The scene pass renders into its own
 *    (full-canvas-sized) render target with the camera's aspect (main sets camera.aspect = halfWidth/height), so the image
 *    is undistorted. DO NOT sample with `screenUV` / viewportUV in the final composite — those are canvas-relative and
 *    would only show the left half of the target; use the default `uv()`.
 *  - RT passes are NOT cleared by autoClear (it is off). `scene.background` must be a THREE.Color (that FORCES a clear of
 *    the scene pass target each frame) — the stub keeps `scene.background` in sync with lookParams.background.
 *    Trail effects (AfterImageNode etc.) should build their feedback inside the post chain, not by skipping the clear.
 *  - Scene content: main.ts adds a faint hoop-line copy of the kit to `scene`. The look adds its own particle meshes to
 *    `scene` (in createWorldLook) and removes them in dispose(). `camera` is orbited by main.ts (do not move it).
 *
 * EXPORTS
 *  lookParams   plain mutable object: background ('#rrggbb'), pointScale, brightness (multipliers), showLeds (bool, reserved)
 *  createWorldLook({ renderer, scene, camera, particles }): WorldLook
 *  WorldLook    { render(): void; resize(width, height): void  // CSS px of the LEFT view
 *                 dispose(): void }
 *  registerLookPanel(folder)
 */
import { PostProcessing, AdditiveBlending, Color, Sprite, SpriteNodeMaterial } from 'three/webgpu';
import type { Scene, PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import { pass, uniform, vec3, oneMinus, smoothstep, length, uv } from './tsl';
import type GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { ParticleSystem } from './particles';

export const lookParams = {
  background: '#04060a',
  pointScale: 1.0,
  brightness: 1.0,
  showLeds: false,
};

export interface WorldLook {
  render(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createWorldLook(opts: {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  particles: ParticleSystem;
}): WorldLook {
  const { renderer, scene, camera, particles } = opts;

  const bg = new Color(lookParams.background);
  scene.background = bg;

  const pointScale = uniform(lookParams.pointScale);
  const brightness = uniform(lookParams.brightness);

  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const pos = particles.buffers.position.toAttribute();
  const col = particles.buffers.color.toAttribute();
  mat.positionNode = pos.xyz;
  mat.scaleNode = pos.w.mul(pointScale);
  const d = length(uv().sub(0.5)).mul(2);
  const soft = oneMinus(smoothstep(0.0, 1.0, d));
  mat.colorNode = vec3(col.xyz).mul(brightness);
  mat.opacityNode = soft.mul(soft).mul(col.w);
  const points = new Sprite(mat);
  (points as unknown as { count: number }).count = particles.count;
  points.frustumCulled = false;
  scene.add(points);

  const post = new PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  post.outputNode = scenePass;

  return {
    render() {
      pointScale.value = lookParams.pointScale;
      brightness.value = lookParams.brightness;
      bg.set(lookParams.background);
      post.render();
    },
    resize(_w, _h) {
      // PassNode follows renderer.getSize() by itself; nothing to do for the stub.
    },
    dispose() {
      scene.remove(points);
      mat.dispose();
    },
  };
}

export function registerLookPanel(folder: GUI): void {
  folder.addColor(lookParams, 'background');
  folder.add(lookParams, 'pointScale', 0.1, 6, 0.01);
  folder.add(lookParams, 'brightness', 0, 8, 0.01);
}
