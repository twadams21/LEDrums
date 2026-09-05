// Real-browser allocation regression. Run against an isolated, web-only dev server.
// No physical output is connected; the dev screenshot seam supplies preview model revisions.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.UI_SHOT_BASE ?? 'http://127.0.0.1:5410';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(() => {
    const live = new Set();
    const counts = { created: 0, deleted: 0, live: 0 };
    window.__GPU_AUDIT__ = counts;
    for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!type || !Object.hasOwn(type.prototype, 'createBuffer')) continue;
      const create = type.prototype.createBuffer;
      const remove = type.prototype.deleteBuffer;
      type.prototype.createBuffer = function (...args) {
        const buffer = create.apply(this, args);
        if (buffer) { live.add(buffer); counts.created++; counts.live = live.size; }
        return buffer;
      };
      type.prototype.deleteBuffer = function (buffer) {
        if (live.delete(buffer)) { counts.deleted++; counts.live = live.size; }
        return remove.call(this, buffer);
      };
    }
  });
  await page.goto(`${base}/?view=perform`);
  await page.waitForFunction(() => window.__LEDRUMS_SHOT__ && window.__GPU_AUDIT__.created > 0);
  const replace = async () => {
    await page.evaluate(() => {
      const store = window.__LEDRUMS_SHOT__.store;
      const model = JSON.parse(JSON.stringify(store.model));
      model.positions[0] += 0.1;
      store.serverModel = model;
      store.serverFrame = new Uint8Array(model.count * 3);
      store.link = 'open';
    });
    await page.waitForTimeout(300);
  };
  await replace();
  const baseline = await page.evaluate(() => ({ ...window.__GPU_AUDIT__ }));
  for (let i = 0; i < 5; i++) await replace();
  const after = await page.evaluate(() => ({ ...window.__GPU_AUDIT__ }));
  console.log(JSON.stringify({ baseline, after, retainedGrowth: after.live - baseline.live }, null, 2));
  assert.ok(after.created > baseline.created, 'fixture must actually upload rebuilt geometry');
  assert.equal(after.live, baseline.live, 'model replacement must not retain old uploaded buffers');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__LEDRUMS_SHOT__.setView('monitor'));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__LEDRUMS_SHOT__.setView('perform'));
    await page.waitForTimeout(300);
  }
  const remounted = await page.evaluate(() => ({ ...window.__GPU_AUDIT__ }));
  console.log(JSON.stringify({ remounted, remountGrowth: remounted.live - after.live }, null, 2));
  assert.equal(remounted.live, after.live, 'view remounts must not retain old uploaded buffers');
} finally {
  await browser.close();
}
