#!/usr/bin/env node
/* lab-shot — spike smoke test for the particle lab (apps/web/lab.html).
   Loads http://127.0.0.1:5180/lab.html in SYSTEM Chrome with WebGPU flags, optionally presses keys, waits,
   prints console errors + whether navigator.gpu exists + LED sample stats, and writes .ui-shots/lab.png.

   Usage:  node apps/web/scripts/lab-shot.mjs [--keys 1,2,5] [--wait 3000] [--n 100000] [--out lab.png]
                                              [--viewport 1600x900] [--gui]
   Env:    LAB_URL (default http://127.0.0.1:5180/lab.html)   LAB_HEADFUL=1 (show the window; needed if headless has no WebGPU)
           LAB_CHROME_ARGS="--flag1 --flag2" (extra chrome args)
   Exit code 2 if navigator.gpu is missing, 1 on console/page errors (so it can gate), else 0. */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const OUT_DIR = join(repoRoot, '.ui-shots');
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const opt = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : d;
};
const keys = (opt('--keys', '') || '').split(',').filter(Boolean);
const wait = Number(opt('--wait', '3000'));
const n = opt('--n', '');
const out = opt('--out', 'lab.png');
const [vw, vh] = (opt('--viewport', '1600x900') || '1600x900').split('x').map(Number);
const headful = process.env.LAB_HEADFUL === '1';
let url = process.env.LAB_URL ?? 'http://127.0.0.1:5180/lab.html';
if (n) url += (url.includes('?') ? '&' : '?') + `n=${n}`;

const chromeArgs = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,UseSkiaRenderer,WebGPU',
  '--use-angle=metal',
  '--ignore-gpu-blocklist',
  '--enable-webgpu-developer-features',
  ...(process.env.LAB_CHROME_ARGS ? process.env.LAB_CHROME_ARGS.split(/\s+/).filter(Boolean) : []),
];

const browser = await chromium.launch({ channel: 'chrome', headless: !headful, args: chromeArgs });
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const problems = [];
const seen = new Map();
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') {
    const line = `[console.${t}] ${m.text()}`;
    const key = line.slice(0, 300);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (seen.get(key) === 1) {
      console.log(line);
      if (t === 'error') problems.push(line);
    }
  }
});
page.on('pageerror', (e) => {
  const line = `[pageerror] ${e.message}`;
  console.log(line);
  problems.push(line);
});

await page.goto(url, { waitUntil: 'load' });
const hasGpu = await page.evaluate(() => !!navigator.gpu);
console.log(`navigator.gpu: ${hasGpu ? 'present' : 'MISSING'}`);
let adapterInfo = null;
if (hasGpu) {
  adapterInfo = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return a ? { vendor: a.info?.vendor, arch: a.info?.architecture, desc: a.info?.description } : null;
  });
  console.log('adapter:', JSON.stringify(adapterInfo));
}

await page.waitForTimeout(Math.min(wait, 1500));
for (const k of keys) {
  await page.keyboard.press(k);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(wait);

if (hasGpu) {
  const stats = await page
    .evaluate(async () => {
      const lab = window.__lab;
      if (!lab) return { error: 'window.__lab missing (boot failed?)' };
      const leds = await lab.readLeds();
      return { frames: lab.frames, fps: Math.round(lab.fps), leds };
    })
    .catch((e) => ({ error: String(e) }));
  console.log('stats:', JSON.stringify(stats));
}

for (const [k, c] of seen) if (c > 1) console.log(`(x${c}) ${k.slice(0, 120).replace(/\n/g, ' ')}`);
const png = join(OUT_DIR, out);
await page.screenshot({ path: png });
console.log(`wrote ${png}`);
await browser.close();
process.exit(hasGpu ? (problems.length ? 1 : 0) : 2);
