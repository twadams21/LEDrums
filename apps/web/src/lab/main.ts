/**
 * main.ts — lab bootstrap + frame loop.   (FOUNDATION-OWNED — after the foundation lands, NOBODY edits this file)
 *
 * One WebGPURenderer, one canvas, split in two viewports:
 *   LEFT  = world view, drawn by look.ts (createWorldLook) — particle field + faint kit hoops
 *   RIGHT = kit preview, drawn straight from sampler.ts's preview group — LEDs coloured by sampling the field
 * Both read the SAME GPU storage buffers; nothing is read back to the CPU.
 *
 * Frame order: syncForceUniforms -> particles.update (compute) -> sampler.update (compute) ->
 *   clear canvas once -> left viewport: look.render() -> right viewport: renderer.render(kitScene).
 *
 * Debug hook: window.__lab = { renderer, particles, sampler, ctx, frames, fps, readLeds() }.
 */
import { WebGPURenderer, Scene, PerspectiveCamera, Color, Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { kit, createHoopLines } from './kit';
import { syncForceUniforms } from './forces';
import { createParticles, getParticleCount } from './particles';
import { createSampler, samplerParams } from './sampler';
import { createWorldLook } from './look';
import { createActionContext } from './actions';
import { createPanel } from './panel';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function boot(): Promise<void> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    $('nogpu').style.display = 'flex';
    return;
  }

  const canvas = $<HTMLCanvasElement>('gpu-canvas');
  const renderer = new WebGPURenderer({ canvas, antialias: new URLSearchParams(location.search).get('aa') !== '0', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.autoClear = false;
  await renderer.init();

  const particles = createParticles({ renderer, count: getParticleCount() });
  const sampler = createSampler({ renderer, particles });

  // ---- scenes + cameras ------------------------------------------------------------------------
  const sceneLeft = new Scene();
  sceneLeft.background = new Color(0x04060a);
  sceneLeft.add(createHoopLines(0x33507a, 0.9));

  const sceneRight = new Scene();
  sceneRight.add(sampler.preview);

  const worldR = Math.hypot(...kit.domainHalfExtent);
  const camLeft = new PerspectiveCamera(50, 1, 0.05, 200);
  camLeft.position.set(0.75, 0.5, 1.0).normalize().multiplyScalar(worldR * 2.1);
  const camRight = new PerspectiveCamera(40, 1, 0.02, 100);
  camRight.position.set(0.7, 0.45, 1.0).normalize().multiplyScalar(kit.bounds.radius * 4.2);

  const look = createWorldLook({ renderer, scene: sceneLeft, camera: camLeft, particles });

  const paneL = $('pane-left');
  const paneR = $('pane-right');
  const ctlLeft = new OrbitControls(camLeft, paneL);
  const ctlRight = new OrbitControls(camRight, paneR);
  for (const c of [ctlLeft, ctlRight]) {
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.target.copy(new Vector3(0, 0, 0));
  }
  ctlLeft.update();
  ctlRight.update();

  let t = 0;
  const ctx = createActionContext({ particles, renderer, time: () => t });
  createPanel(ctx);

  // ---- resize ----------------------------------------------------------------------------------
  let W = 1;
  let H = 1;
  let LW = 1;
  const onResize = (): void => {
    W = window.innerWidth;
    H = window.innerHeight;
    LW = Math.floor(W / 2);
    renderer.setSize(W, H);
    camLeft.aspect = LW / H;
    camLeft.updateProjectionMatrix();
    camRight.aspect = (W - LW) / H;
    camRight.updateProjectionMatrix();
    look.resize(LW, H);
  };
  window.addEventListener('resize', onResize);
  onResize();

  // ---- loop ------------------------------------------------------------------------------------
  const hud = $('hud');
  let last = performance.now();
  let fps = 60;
  let hudAt = 0;
  let frames = 0;

  const frame = (now: number): void => {
    const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
    last = now;
    t += dt;
    fps += (1 / dt - fps) * 0.05;

    syncForceUniforms(dt, t);
    particles.update(dt, t);
    sampler.update(dt);
    ctlLeft.update();
    ctlRight.update();

    // one full clear, then per-viewport draws with autoClear off (WebGPU clears ignore scissor)
    renderer.autoClear = false;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.clear();

    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, LW, H);
    renderer.setScissor(0, 0, LW, H);
    look.render();

    renderer.setViewport(LW, 0, W - LW, H);
    renderer.setScissor(LW, 0, W - LW, H);
    renderer.render(sceneRight, camRight);

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);

    frames++;
    if (now - hudAt > 250) {
      hudAt = now;
      hud.textContent = `${fps.toFixed(0)} fps  |  ${particles.count.toLocaleString()} particles  |  ${kit.ledCount} LEDs  |  keys 1-4 drums, 5-0 actions`;
    }
    (window as unknown as { __lab: Record<string, unknown> }).__lab.frames = frames;
    (window as unknown as { __lab: Record<string, unknown> }).__lab.fps = fps;
    requestAnimationFrame(frame);
  };

  (window as unknown as { __lab: unknown }).__lab = {
    renderer,
    particles,
    sampler,
    ctx,
    samplerParams,
    camLeft,
    camRight,
    frames: 0,
    fps: 0,
    async readLeds() {
      const a = await sampler.readback();
      let max = 0;
      let sum = 0;
      let lit = 0;
      for (let i = 0; i < kit.ledCount; i++) {
        const v = Math.max(a[i * 4]!, a[i * 4 + 1]!, a[i * 4 + 2]!);
        if (v > max) max = v;
        sum += v;
        if (v > 0.02) lit++;
      }
      return { ledCount: kit.ledCount, max, mean: sum / kit.ledCount, lit };
    },
  };

  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error('[lab] boot failed', err);
  const el = document.getElementById('nogpu');
  if (el) {
    el.textContent = `Lab failed to start: ${err instanceof Error ? err.message : String(err)}`;
    el.style.display = 'flex';
  }
});
