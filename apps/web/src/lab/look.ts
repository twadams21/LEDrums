/**
 * look.ts — how the LEFT (world) view is drawn.   (OWNED by the LOOK agent; exports keep foundation signatures)
 *
 * RENDER CONTRACT (how main.ts and look cooperate — PostProcessing in r171 has no viewport support)
 *  - ONE WebGPURenderer / ONE canvas. main.ts splits it: LEFT half = world (this file), RIGHT half = kit preview.
 *  - Before `look.render()`, main.ts has ALREADY cleared the whole canvas, set viewport + scissor to the left half and
 *    `renderer.autoClear = false`. `render()` must ONLY draw into "the current viewport" and must NOT touch renderer
 *    viewport / scissor / autoClear / render target on exit. Own render targets internally are fine.
 *  - We render only through `PostProcessing` (chain from `pass(scene, camera)`); its quad lands in the current viewport
 *    and the final composite samples with the default `uv()` (never `screenUV`).
 *  - `scene.background` stays a THREE.Color (forces the scene-pass RT to clear each frame; trails live in the post
 *    chain, not in a skipped clear).
 *
 * WHAT THIS FILE DOES
 *  Particles: one instanced Sprite (SpriteNodeMaterial, additive, no depth) reading position/velocity/color/life storage
 *  buffers as vertex attributes. Selectable shape (soft / hard / ring / square / streak), size, size-by-speed,
 *  size-by-life, opacity, colour mode (particle / speed / life / height / seed through a 4-stop palette).
 *  Post chain (rebuilt only when a toggle flips): scene -> [AfterImage trails] -> [radial RGB shift] -> [+ Bloom] ->
 *  vignette -> soft tone map. Everything else is a uniform update per frame.
 *
 * EXPORTS
 *  lookParams   plain mutable object (see below), read every frame
 *  createWorldLook({ renderer, scene, camera, particles }): WorldLook
 *  WorldLook    { render(); resize(w, h); dispose() }
 *  registerLookPanel(folder)
 *  LOOK_SHAPES, LOOK_COLOR_MODES, LOOK_PALETTES   (option lists)
 */
import { PostProcessing, AdditiveBlending, Color, Sprite, SpriteNodeMaterial } from 'three/webgpu';
import type { Scene, PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import { afterImage } from 'three/examples/jsm/tsl/display/AfterImageNode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import {
  T, pass, uniform, vec2, vec3, vec4, float, oneMinus, smoothstep, length, uv, select, mix, exp, abs, max, pow, saturate,
  clamp, cameraViewMatrix,
} from './tsl';
import type GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { ParticleSystem } from './particles';
import { kit } from './kit';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TNode = any;

export const LOOK_SHAPES = ['soft', 'hard', 'ring', 'square', 'streak'] as const;
export const LOOK_COLOR_MODES = ['particle', 'speed', 'life', 'height', 'seed'] as const;

/** 4-stop palettes, sRGB hex (converted to linear on use). */
const PALETTE_STOPS: Record<string, [string, string, string, string]> = {
  neon: ['#1a2bff', '#00e5ff', '#ff2bd6', '#ffffff'],
  fire: ['#5a0a00', '#ff3b00', '#ffb000', '#fff4c0'],
  ice: ['#0b1d6b', '#1e6bff', '#6ee7ff', '#f0ffff'],
  acid: ['#14003a', '#7a00ff', '#b6ff00', '#f4ffd0'],
};
export const LOOK_PALETTES = Object.keys(PALETTE_STOPS);

export const lookParams = {
  // scene
  background: '#04060a',
  showLeds: false, // reserved
  showHoops: true,
  hoopOpacity: 0.9,
  // particle sprite
  shape: 'soft' as (typeof LOOK_SHAPES)[number],
  pointScale: 1.0,
  brightness: 1.0,
  opacity: 1.0,
  sizeBySpeed: 0.0,
  sizeByLife: 0.6,
  fadeIn: 0.1,
  fadeOut: 0.5,
  opacityByLife: 0.0,
  streakLength: 0.06, // seconds of velocity drawn as tail
  streakWidth: 0.45, // tail thickness relative to particle size
  // colour
  colorMode: 'particle' as (typeof LOOK_COLOR_MODES)[number],
  palette: 'neon',
  speedMax: 4.0, // m/s mapped to gradient end
  particleMix: 0.0, // blend gradient toward particle's own colour
  // post
  trails: true,
  trailDamp: 0.86,
  bloom: true,
  bloomStrength: 0.6,
  bloomRadius: 0.5,
  bloomThreshold: 0.6,
  rgbShift: false,
  rgbShiftAmount: 0.004,
  vignette: 0.35,
  toneMap: true,
  exposure: 1.1,
};

/** Debug/test: `?l_<param>=value` in the URL overrides lookParams (e.g. ?l_trails=0&l_shape=streak). */
function applyUrlOverrides(): void {
  try {
    const q = new URLSearchParams(location.search);
    const P = lookParams as unknown as Record<string, unknown>;
    q.forEach((v, k) => {
      if (!k.startsWith('l_')) return;
      const key = k.slice(2);
      if (!(key in P)) return;
      const cur = P[key];
      P[key] = typeof cur === 'boolean' ? v === '1' || v === 'true' : typeof cur === 'number' ? Number(v) : v;
    });
  } catch {
    /* no location (tests) */
  }
}

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
  applyUrlOverrides();

  const bg = new Color(lookParams.background);
  scene.background = bg;

  // hoop lines main.ts already put in the scene (found once, before we add our sprite)
  const hoopObjects: TNode[] = [];
  scene.traverse((o: TNode) => {
    if (o.isLine || o.isLineSegments) hoopObjects.push(o);
  });

  // ---- uniforms -----------------------------------------------------------------------------------
  const U = {
    shape: uniform(0),
    pointScale: uniform(1),
    brightness: uniform(1),
    opacity: uniform(1),
    sizeBySpeed: uniform(0),
    sizeByLife: uniform(0.6),
    fadeIn: uniform(0.1),
    fadeOut: uniform(0.5),
    opacityByLife: uniform(0),
    streakLength: uniform(0.06),
    streakWidth: uniform(0.45),
    colorMode: uniform(0),
    speedMax: uniform(4),
    particleMix: uniform(0),
    heightHalf: uniform(Math.max(0.1, kit.domainHalfExtent[1])),
    p0: uniform(new Color()),
    p1: uniform(new Color()),
    p2: uniform(new Color()),
    p3: uniform(new Color()),
    // post
    chroma: uniform(0.004),
    vignette: uniform(0.35),
    toneMap: uniform(1),
    exposure: uniform(1.1),
  };

  // ---- particle material --------------------------------------------------------------------------
  const pos: TNode = particles.buffers.position.toAttribute();
  const vel: TNode = particles.buffers.velocity.toAttribute();
  const col: TNode = particles.buffers.color.toAttribute();
  const life: TNode = particles.buffers.life.toAttribute();

  const speed = length(vel.xyz);
  const speedT = saturate(speed.div(max(U.speedMax, 0.001)));
  const lifeT = saturate(life.x.div(max(life.y, 0.001)));
  const heightT = saturate(pos.y.div(U.heightHalf.mul(2)).add(0.5));
  const lifeEnv = smoothstep(0, max(U.fadeIn, 0.001), lifeT).mul(
    oneMinus(smoothstep(oneMinus(max(U.fadeOut, 0.001)), 1, lifeT)),
  );

  const isStreak = U.shape.equal(4);

  // view-space velocity -> screen-aligned streak angle + foreshortened length
  const viewVel = cameraViewMatrix.mul(vec4(vel.xyz, 0)).xy;
  const angle = T.atan2(viewVel.y, viewVel.x.add(1e-5));
  const viewSpeed = length(viewVel);

  const sizeMulSpeed = mix(1.0, speedT.mul(2.0).add(0.3), U.sizeBySpeed);
  const sizeMulLife = mix(1.0, lifeEnv, U.sizeByLife);
  const baseSize = pos.w.mul(U.pointScale).mul(sizeMulSpeed).mul(sizeMulLife);

  const mat = new SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });
  mat.positionNode = pos.xyz;
  mat.rotationNode = select(isStreak, angle, float(0));
  mat.scaleNode = vec2(
    select(isStreak, baseSize.add(viewSpeed.mul(U.streakLength)), baseSize),
    select(isStreak, baseSize.mul(U.streakWidth), baseSize),
  );

  // colour
  const gradient = (t: TNode): TNode => {
    const t3 = clamp(t, 0, 1).mul(3);
    let c = mix(U.p0, U.p1, saturate(t3));
    c = mix(c, U.p2, saturate(t3.sub(1)));
    return mix(c, U.p3, saturate(t3.sub(2)));
  };
  const gT = select(
    U.colorMode.equal(1), speedT,
    select(U.colorMode.equal(2), lifeT, select(U.colorMode.equal(3), heightT, life.z)),
  );
  const paletteColor = mix(gradient(gT), col.xyz, U.particleMix);
  const baseColor = select(U.colorMode.equal(0), col.xyz, paletteColor);
  mat.colorNode = baseColor.mul(U.brightness);

  // shape alpha (uv is 0..1 across the sprite quad; local +x is the velocity direction for streaks)
  const p = uv().mul(2).sub(1);
  const d = length(p);
  const soft = oneMinus(smoothstep(0, 1, d));
  const softA = soft.mul(soft);
  const hardA = oneMinus(smoothstep(0.8, 1.0, d));
  const ringA = oneMinus(smoothstep(0, 0.22, abs(d.sub(0.72))));
  const squareA = oneMinus(smoothstep(0.8, 1.0, max(abs(p.x), abs(p.y))));
  const across = oneMinus(smoothstep(0, 1, abs(p.y)));
  const tt = p.x.mul(0.5).add(0.5);
  const streakA = across.mul(across).mul(pow(tt, 1.5)).mul(oneMinus(smoothstep(0.85, 1.0, tt)));
  const shapeA = select(
    U.shape.equal(0), softA,
    select(U.shape.equal(1), hardA, select(U.shape.equal(2), ringA, select(U.shape.equal(3), squareA, streakA))),
  );
  mat.opacityNode = shapeA.mul(col.w).mul(U.opacity).mul(mix(1.0, lifeEnv, U.opacityByLife));

  const points = new Sprite(mat);
  (points as unknown as { count: number }).count = particles.count;
  points.frustumCulled = false;
  scene.add(points);

  // ---- post chain ---------------------------------------------------------------------------------
  const post = new PostProcessing(renderer);
  const scenePass: TNode = pass(scene, camera);
  const sceneTex: TNode = scenePass.getTextureNode();
  let after: TNode = null;
  const bloomBySource = new Map<TNode, TNode>();
  let chainKey = '';
  let bloomNode: TNode = null;

  const rebuild = (): void => {
    let src: TNode = sceneTex;
    if (lookParams.trails) {
      after ??= afterImage(sceneTex, lookParams.trailDamp);
      src = after.getTextureNode();
    }
    let c: TNode;
    if (lookParams.rgbShift) {
      const off = uv().sub(0.5).mul(U.chroma);
      c = vec3(src.uv(uv().add(off)).r, src.uv(uv()).g, src.uv(uv().sub(off)).b);
    } else {
      c = vec3(src.rgb);
    }
    if (lookParams.bloom) {
      let b = bloomBySource.get(src);
      if (!b) {
        b = bloom(src, lookParams.bloomStrength, lookParams.bloomRadius, lookParams.bloomThreshold);
        bloomBySource.set(src, b);
      }
      bloomNode = b;
      c = c.add(b.getTextureNode().rgb);
    } else {
      bloomNode = null;
    }
    const dist = length(uv().sub(0.5)).mul(1.4142);
    c = c.mul(oneMinus(smoothstep(0.35, 1.25, dist).mul(U.vignette)));
    const e = c.mul(U.exposure);
    c = mix(e, oneMinus(exp(e.negate())), U.toneMap);
    post.outputNode = vec4(c, 1);
    post.needsUpdate = true;
  };

  // ---- per-frame ----------------------------------------------------------------------------------
  let lastPalette = '';
  let lastT = performance.now();
  const tmpColor = new Color();

  const syncUniforms = (dt: number): void => {
    const P = lookParams;
    U.shape.value = Math.max(0, LOOK_SHAPES.indexOf(P.shape));
    U.pointScale.value = P.pointScale;
    U.brightness.value = P.brightness;
    U.opacity.value = P.opacity;
    U.sizeBySpeed.value = P.sizeBySpeed;
    U.sizeByLife.value = P.sizeByLife;
    U.fadeIn.value = P.fadeIn;
    U.fadeOut.value = P.fadeOut;
    U.opacityByLife.value = P.opacityByLife;
    U.streakLength.value = P.streakLength;
    U.streakWidth.value = P.streakWidth;
    U.colorMode.value = Math.max(0, LOOK_COLOR_MODES.indexOf(P.colorMode));
    U.speedMax.value = P.speedMax;
    U.particleMix.value = P.particleMix;
    U.chroma.value = P.rgbShiftAmount;
    U.vignette.value = P.vignette;
    U.toneMap.value = P.toneMap ? 1 : 0;
    U.exposure.value = P.exposure;
    if (P.palette !== lastPalette) {
      lastPalette = P.palette;
      const stops = PALETTE_STOPS[P.palette] ?? PALETTE_STOPS.neon!;
      [U.p0, U.p1, U.p2, U.p3].forEach((u, i) => u.value.copy(tmpColor.set(stops[i]!)));
    }
    bg.set(P.background);
    for (const o of hoopObjects) {
      o.visible = P.showHoops;
      if (o.material) {
        o.material.transparent = true;
        o.material.opacity = P.hoopOpacity;
      }
    }
    if (after) after.damp.value = Math.pow(P.trailDamp, dt * 60);
    if (bloomNode) {
      bloomNode.strength.value = P.bloomStrength;
      bloomNode.radius.value = P.bloomRadius;
      bloomNode.threshold.value = P.bloomThreshold;
    }
  };

  return {
    render() {
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0.0005, (now - lastT) / 1000));
      lastT = now;
      const key = `${lookParams.trails}|${lookParams.bloom}|${lookParams.rgbShift}`;
      if (key !== chainKey) {
        chainKey = key;
        rebuild();
      }
      syncUniforms(dt);
      post.render();
    },
    resize(_w, _h) {
      // PassNode / AfterImage / Bloom follow renderer drawing-buffer size by themselves.
    },
    dispose() {
      scene.remove(points);
      mat.dispose();
      after?.dispose();
      bloomBySource.forEach((b) => b.dispose());
    },
  };
}

export function registerLookPanel(folder: GUI): void {
  const P = lookParams;
  folder.addColor(P, 'background');
  folder.add(P, 'showHoops');
  folder.add(P, 'hoopOpacity', 0, 1, 0.01);

  const fp = folder.addFolder('Particles');
  fp.add(P, 'shape', [...LOOK_SHAPES]);
  fp.add(P, 'pointScale', 0.1, 6, 0.01).name('size');
  fp.add(P, 'sizeBySpeed', 0, 1, 0.01);
  fp.add(P, 'sizeByLife', 0, 1, 0.01);
  fp.add(P, 'opacity', 0, 2, 0.01);
  fp.add(P, 'brightness', 0, 8, 0.01);
  fp.add(P, 'opacityByLife', 0, 1, 0.01);
  fp.add(P, 'fadeIn', 0, 0.5, 0.01);
  fp.add(P, 'fadeOut', 0, 1, 0.01);
  fp.add(P, 'streakLength', 0, 0.3, 0.001);
  fp.add(P, 'streakWidth', 0.05, 1, 0.01);

  const fc = folder.addFolder('Colour');
  fc.add(P, 'colorMode', [...LOOK_COLOR_MODES]).name('mode');
  fc.add(P, 'palette', LOOK_PALETTES);
  fc.add(P, 'speedMax', 0.5, 15, 0.1);
  fc.add(P, 'particleMix', 0, 1, 0.01);

  const ft = folder.addFolder('Trails');
  ft.add(P, 'trails').name('enabled');
  ft.add(P, 'trailDamp', 0.5, 0.995, 0.001).name('damp');

  const fb = folder.addFolder('Bloom');
  fb.add(P, 'bloom').name('enabled');
  fb.add(P, 'bloomStrength', 0, 4, 0.01).name('strength');
  fb.add(P, 'bloomRadius', 0, 1, 0.01).name('radius');
  fb.add(P, 'bloomThreshold', 0, 2, 0.01).name('threshold');

  const fx = folder.addFolder('Post');
  fx.add(P, 'rgbShift');
  fx.add(P, 'rgbShiftAmount', 0, 0.02, 0.0005).name('shiftAmount');
  fx.add(P, 'vignette', 0, 1, 0.01);
  fx.add(P, 'toneMap');
  fx.add(P, 'exposure', 0.1, 6, 0.01);
}
