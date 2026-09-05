// Measure production bundles against an isolated, connected, DISARMED local server.
// UI_SHOT_BASE=http://localhost:4411 node scripts/health-startup.mjs > /tmp/startup.json
// Chrome CDP: cold cache, fresh contexts, 4x CPU throttle; timings are local synthetic evidence.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.UI_SHOT_BASE ?? 'http://localhost:4411';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'use an isolated loopback server');
const runs = Number(process.env.HEALTH_STARTUP_RUNS ?? 3);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const [view, target] of [['perform', '.bigpad'], ['trigger', '.svelte-flow']]) {
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await cdp.send('Performance.enable');
      await page.goto(`${base}/?view=${view}`, { waitUntil: 'domcontentloaded' });
      await page.locator(target).first().waitFor({ state: 'visible' });
      const readyMs = await page.evaluate(() => performance.now());
      const { metrics } = await cdp.send('Performance.getMetrics');
      const scriptMs = metrics.find((m) => m.name === 'ScriptDuration').value * 1000;
      const resources = await page.evaluate(() => performance.getEntriesByType('resource')
        .filter((r) => new URL(r.name).pathname.endsWith('.js'))
        .map((r) => ({ path: new URL(r.name).pathname, bytes: r.encodedBodySize })));
      let dispatchToFrameMs = null;
      if (view === 'perform') {
        await page.locator('[title="Output disabled — engine not transmitting"]').waitFor({ state: 'visible' });
        // Not a hardware/MIDI latency measure: DOM dispatch through the next paint opportunity.
        dispatchToFrameMs = await page.evaluate(() => new Promise((resolve) => {
          const start = performance.now();
          document.querySelector('.bigpad').click();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
        }));
      }
      const settingsStart = await page.evaluate(() => performance.now());
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'visible' });
      const settingsOpenMs = await page.evaluate(() => performance.now()) - settingsStart;
      assert.deepEqual(errors, [], 'startup/settings must remain console-clean');
      results.push({ view, run, readyMs, scriptMs, dispatchToFrameMs, settingsOpenMs, jsBytes: resources.reduce((n, r) => n + r.bytes, 0), resources });
      await context.close();
    }
  }
  const median = (items) => [...items].sort((a, b) => a - b)[Math.floor(items.length / 2)];
  const summary = ['perform', 'trigger'].map((view) => {
    const rows = results.filter((r) => r.view === view);
    return { view, runs: rows.length, readyMs: median(rows.map((r) => r.readyMs)), scriptMs: median(rows.map((r) => r.scriptMs)), settingsOpenMs: median(rows.map((r) => r.settingsOpenMs)), jsBytes: median(rows.map((r) => r.jsBytes)), ...(view === 'perform' ? { dispatchToFrameMs: median(rows.map((r) => r.dispatchToFrameMs)) } : {}) };
  });
  console.log(JSON.stringify({ cpuThrottle: 4, summary, samples: results }, null, 2));
} finally {
  await browser.close();
}
