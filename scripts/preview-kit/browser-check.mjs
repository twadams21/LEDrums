import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Opt-in, read-only verification against an operator-owned disposable Vite/voice-server stack.
// URL checks cannot establish the project's storage directory; see README.md.
const args = process.argv.slice(2).filter(arg => arg !== '--');
let base;
try { base = args.length === 1 ? new URL(args[0]) : null; } catch { base = null; }
if (!base || base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port ||
  ['80', '443', '4321', '5173', '9000'].includes(base.port) || base.username || base.password ||
  base.pathname !== '/' || base.search || base.hash) {
  console.error('Refusing: supply one non-default literal-loopback isolated Vite URL, e.g. pnpm verify:stage-gpu -- http://127.0.0.1:5294');
  process.exit(1);
}
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
mkdirSync(`${root}/.ui-shots`, { recursive: true });
const { chromium } = createRequire(`${root}/package.json`)('playwright-core');
const server = await chromium.launchServer({ channel: 'chrome', headless: true });
const browser = await chromium.connect(server.wsEndpoint());
const deadline = setTimeout(() => { console.error('Stage GPU check hard deadline'); server.kill().finally(() => process.exit(2)); }, 120000);
const evidence = {}, errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const qa = window.__GPU_QA = { state: null, presence: null, failure: null, interceptedMidiRequests: 0 };
    const denyDevice = () => { qa.failure = 'Attempted media capture'; return Promise.reject(new Error(qa.failure)); };
    // The existing app probes WebMIDI at startup. Supply empty synthetic ports; never open OS MIDI.
    navigator.requestMIDIAccess = async () => { qa.interceptedMidiRequests++; return { inputs: new Map(), outputs: new Map(), sysexEnabled: false, onstatechange: null, addEventListener() {}, removeEventListener() {} }; };
    if (navigator.mediaDevices) { navigator.mediaDevices.getUserMedia = denyDevice; navigator.mediaDevices.getDisplayMedia = denyDevice; navigator.mediaDevices.enumerateDevices = async () => []; }
    window.AudioContext = class { constructor() { qa.failure = 'Attempted audio context'; throw new Error(qa.failure); } };
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url, protocols) {
        super(url, protocols);
        if (new URL(url).pathname !== '/ws') return;
        this.addEventListener('message', e => {
          if (typeof e.data !== 'string') return;
          const m = JSON.parse(e.data);
          if (m.t === 'state') {
            qa.state = m;
            if (m.project.output.state !== 'disabled' || m.osc.port === 9000 || (m.tunnel && m.tunnel.status !== 'off')) qa.failure = 'Not an isolated disabled-output server';
          }
          if (m.t === 'presence') { qa.presence = m; if (m.clientCount !== 1 || !m.youAreEditor) qa.failure = 'Not the sole editor/client'; }
          if ((m.t === 'state' || m.t === 'stats') && m.output.state !== 'disabled') qa.failure = 'Output enabled';
        });
      }
      send(data) {
        if (new URL(this.url).pathname === '/ws' && typeof data === 'string') {
          const m = JSON.parse(data);
          if (/^(set|save|delete|create|import|restore|midi|audio|key|osc|hit|fire|takeover)/.test(m.t)) throw new Error('GPU check is read-only against the server');
        }
        return super.send(data);
      }
    };
  });
  await page.goto(base.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__GPU_QA.state && window.__GPU_QA.presence);
  const safe = async () => assert.equal(await page.evaluate(() => window.__GPU_QA.failure), null);
  await safe();
  console.log('GPU sampling actual sourced strips');
  evidence.gpu = await page.evaluate(async ({ root }) => {
    const fail = (message) => { throw new Error(message); };
    const resourcesSource = await fetch('/src/lib/visualizer/stage-resources.ts').then(r => r.text());
    const threeUrl = resourcesSource.match(/from\s+["']([^"']*\/three\.js[^"']*)["']/)?.[1];
    if (!threeUrl) fail('Cannot locate the exact application Three module');
    // These are browser module URLs served by Vite, not Node filesystem imports.
    const visualizerModule = name => import(new URL(`/src/lib/visualizer/${name}.ts`, location.origin).href);
    const [THREE, { loadStageAsset }, { createStageResources }, core, protocol] = await Promise.all([
      import(threeUrl), visualizerModule('stage-asset'), visualizerModule('stage-resources'),
      import(`/@fs/${root.replace(/^\/+/, '')}/packages/core/src/index.ts`), import(`/@fs/${root.replace(/^\/+/, '')}/packages/protocol/src/index.ts`),
    ]);
    const asset = await loadStageAsset(new AbortController().signal);
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setSize(64, 64); renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; renderer.setClearColor(0, 1);
    const target = new THREE.WebGLRenderTarget(64, 64, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-0.04, 0.04, 0.06, -0.06, 0.001, 30);
    const pixel = new Uint8Array(4);
    const toScene = v => new THREE.Vector3(v.x / 100, v.z / 100, v.y / 100);
    const cases = [], failures = [], physicalSeamSamples = [];
    let samples = 0, maxChannelError = 0;
    try {
      for (const variant of ['default', 'phase-reverse-flip-mirror-x', 'phase-reverse-flip-mirror-y', 'heterogeneous-counts']) {
        const kit = structuredClone(core.DEFAULT_KIT);
        if (variant !== 'default') {
          kit.global.mirror = variant.endsWith('-x') ? 'x' : variant.endsWith('-y') ? 'y' : 'none';
          kit.drums.forEach((drum, d) => {
            drum.startAngleDeg = 37.25 + d * 11;
            drum.localSpinDeg = -47.5 - d * 13;
            drum.rotation = { x: 31 + d * 9, y: -27 + d * 4, z: 19 - d * 3 };
            drum.flip = (d % 2 === 0) !== variant.endsWith('-y');
            drum.hoops.forEach((hoop, h) => { hoop.reverse = h % 2 === 1; if (variant === 'heterogeneous-counts') hoop.pixelCount = [37, 71, 109, 196][h] + d; });
          });
        }
        const model = core.buildPixelModel(kit);
        const serialized = protocol.serializePixelModel(model);
        const raw = new Uint8Array(model.pixelCount * 3);
        for (const p of model.pixels) raw.set([30 + (p.id * 17) % 197, 40 + (p.indexInHoop * 73) % 193, 70 + p.hoopIndex * 41], p.id * 3);
        for (const quality of ['eco', 'detail']) {
          const snapshot = createStageResources(asset, serialized, quality);
          if (snapshot.matchedDrums.size !== 4 || snapshot.fallbacks.length) fail(`${variant}: unexpected fallback ${JSON.stringify(snapshot.fallbacks)}`);
          scene.add(snapshot.group);
          const tapes = [];
          snapshot.group.traverse(node => { if (node.isMesh) { node.visible = false; if (node.userData.stageRole === 'led-tape') { const compile = node.material.onBeforeCompile; node.material.onBeforeCompile = function(shader, gl) { compile.call(this, shader, gl); node.userData.qaShader = shader; }; tapes.push(node); } } });
          scene.updateMatrixWorld(true);
          const chosen = model.pixels.filter(p => {
            const count = model.drumById.get(p.drumId).hoopPixelCounts[p.hoopIndex - 1];
            // Core's hoop and within-hoop labels are 1-based; frame ids remain 0-based.
            return [1, 2, count, Math.floor(count / 4) + 1, Math.floor(count / 2), Math.floor(count / 2) + 1, Math.floor(count / 2) + 2].includes(p.indexInHoop);
          });
          if (chosen.length !== 112 || tapes.length !== 16) fail('Incomplete hoop sampling fixture');
          let visible = null;
          const check = (p, frame, label) => {
            const tape = tapes.find(node => node.parent.name === `stage-drum:${p.drumId}` && node.userData.stageHoop === p.hoopIndex);
            if (!tape) fail(`Tape missing ${p.drumId}/${p.hoopIndex}`);
            if (visible) visible.visible = false; tape.visible = true; visible = tape;
            const position = toScene(p.world);
            const normal = new THREE.Vector3(p.normal.x, p.normal.z, p.normal.y);
            const z = serialized.drums.find(d => d.id === p.drumId).stage.zAxis;
            camera.up.set(z[0], z[2], z[1]); camera.position.copy(position).addScaledVector(normal, 10); camera.lookAt(position); camera.updateMatrixWorld(true);
            renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera);
            renderer.readRenderTargetPixels(target, 32, 32, 1, 1, pixel);
            // The actual CAD tape has an 8 mm gap at CAD +Y (90 degrees), recorded in
            // .cache/v4-current-features.json. A ray through that gap sees the opposite
            // strip, not the requested near-side LED. Do not invent geometry to fill it.
            const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(1 / 64, 1 / 64), camera);
            const hit = ray.intersectObject(tape)[0];
            if (!hit) fail(`No tape intersection ${variant}/${p.drumId}/${p.hoopIndex}/${p.indexInHoop}`);
            let sampled = p;
            if (hit.point.distanceTo(position) * 100 > 2) {
              const localTarget = tape.parent.worldToLocal(position.clone());
              const angle = Math.atan2(-localTarget.z, localTarget.x);
              const seamDistanceMm = Math.abs(Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2))) * model.drumById.get(p.drumId).radiusMm;
              if (seamDistanceMm > 4.5) fail(`Unexpected source coverage gap outside the documented seam: ${variant}/${p.drumId}/${p.hoopIndex}/${p.indexInHoop} distance ${seamDistanceMm}`);
              const worldHit = { x: hit.point.x * 100, y: hit.point.z * 100, z: hit.point.y * 100 };
              let distance = Infinity;
              for (const candidate of model.pixels) {
                if (candidate.drumId !== p.drumId || candidate.hoopIndex !== p.hoopIndex) continue;
                const d = (candidate.world.x - worldHit.x) ** 2 + (candidate.world.y - worldHit.y) ** 2 + (candidate.world.z - worldHit.z) ** 2;
                if (d < distance) { distance = d; sampled = candidate; }
              }
              if (label === 'pixel-identity') physicalSeamSamples.push({ variant, quality, drum: p.drumId, hoop: p.hoopIndex, requested: p.indexInHoop, visible: sampled.indexInHoop });
            }
            const expected = [0, 1, 2].map(c => frame?.[sampled.id * 3 + c] ?? 0);
            const error = Math.max(...expected.map((value, c) => Math.abs(value - pixel[c])));
            maxChannelError = Math.max(maxChannelError, error); samples++;
            if (error > 1 && failures.length < 6) {
              const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(1 / 64, 1 / 64), camera);
              const hits = ray.intersectObject(tape).slice(0, 2).map(hit => { const local = tape.parent.worldToLocal(hit.point.clone()); return { distance: hit.distance, local: local.toArray(), angle: Math.atan2(-local.z, local.x) }; });
              const u = tape.userData.qaShader?.uniforms;
              failures.push({ variant, quality, label, drum: p.drumId, hoop: p.hoopIndex, index: p.indexInHoop, expected, actual: [...pixel], point: p.world, hits, uniforms: u && Object.fromEntries(['stagePhase','stageDirection','stageCount','stageRow','stageAtlasWidth'].map(k => [k, u[k].value])) });
            }
          };
          try {
            snapshot.update(raw);
            for (const p of chosen) check(p, raw, 'pixel-identity');
            for (const [label, frame] of [['blackout', new Uint8Array(raw.length)], ['missing', null], ['short', raw.slice(0, 2)]]) {
              snapshot.update(frame);
              for (const p of chosen.filter(p => p.indexInHoop === 1)) check(p, frame, label);
            }
            cases.push({ variant, quality, pixels: model.pixelCount, litSamples: chosen.length });
          } finally { snapshot.dispose(); }
        }
      }
      const incompatible = structuredClone(core.DEFAULT_KIT); incompatible.drums[0].diameterIn += 1;
      const mismatched = createStageResources(asset, protocol.serializePixelModel(core.buildPixelModel(incompatible)), 'detail');
      try { if (mismatched.matchedDrums.size !== 3 || mismatched.fallbacks.length !== 1 || mismatched.fallbacks[0].id !== 'kick') fail('Mismatched kit was stretched or lost other drums'); }
      finally { mismatched.dispose(); }
      if (failures.length) fail(JSON.stringify({ samples, maxChannelError, failures }));
      return { samples, maxChannelError, cases, physicalSeamSamples, mismatchedDrumFallsBack: true, interpretation: 'Actual GLB tape geometry + production shader/atlas; linear render-target readback at known pixel centres and both sides of the CAD seam. A ray through the documented source gap is checked against the nearest pixel on the actual visible opposite surface. Other surfaces hidden to isolate strip mapping; no hole-filling or optical calibration.' };
    } finally { target.dispose(); renderer.dispose(); renderer.forceContextLoss(); asset.dispose(); }
  }, { root: root.replaceAll('\\', '/') });
  await safe();
  console.log('Visible unavailable-asset fallback');
  await page.route('**/models/acrylic-kit/kit.manifest.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.getByRole('radio', { name: 'Stage', exact: true }).click();
  await page.getByText('Acrylic kit unavailable · showing Pixels. Reopen Stage to retry.', { exact: true }).waitFor({ state: 'visible' });
  await page.screenshot({ path: `${root}/.ui-shots/acrylic-unavailable-fallback.png` });
  evidence.visibleUnavailableFallback = true; evidence.browser = browser.version();
  await safe(); assert.deepEqual(errors, []); evidence.interceptedMidiRequests = await page.evaluate(() => window.__GPU_QA.interceptedMidiRequests); evidence.ok = true;
  writeFileSync(`${root}/.ui-shots/stage-gpu-check.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.ok = false; evidence.error = String(error.stack ?? error); evidence.errors = errors;
  writeFileSync(`${root}/.ui-shots/stage-gpu-check.json`, JSON.stringify(evidence, null, 2)); throw error;
} finally { await browser.close(); await server.kill(); clearTimeout(deadline); }
