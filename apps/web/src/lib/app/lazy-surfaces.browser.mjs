// Real production lazy-load regression, no app-only failure hooks.
// UI_SHOT_BASE=http://localhost:4412 node apps/web/src/lib/app/lazy-surfaces.browser.mjs
// Run against this worktree's built web + isolated server with output DISABLED.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.UI_SHOT_BASE ?? 'http://localhost:4412';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
const output = '.ui-shots/health-bundle';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [], consoleErrors = [], requested = [];
  let navigations = 0, sockets = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++; });
  page.on('websocket', () => { sockets++; });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', (r) => requested.push(r.url()));
  let releaseTrigger;
  let failTrigger = true;
  let triggerRequests = 0;
  await page.route(/\/assets\/TriggerGraphView-[^/]+\.js(?:\?.*)?$/, async (route) => {
    triggerRequests++;
    if (failTrigger) {
      await new Promise((resolve) => { releaseTrigger = resolve; });
      await route.abort('failed');
    } else await route.continue();
  });
  await page.goto(`${base}/?view=perform`);
  await page.locator('.bigpad').first().waitFor();
  await page.locator('[title="Output disabled — engine not transmitting"]').waitFor();
  assert.equal(requested.some((url) => /\/(TriggerGraphView|SectionsView|ObjectsView|InputPane|ControllerPane)-/.test(url)), false, 'noninitial editors must not load on Perform');
  results.push('Perform controls/visualizer ready without editor or Settings pane requests');
  await page.getByRole('button', { name: 'Trigger Graph', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Loading Trigger' }).waitFor();
  await page.screenshot({ path: `${output}/trigger-loading.png` });
  releaseTrigger();
  await page.getByRole('alert').filter({ hasText: 'Couldn’t load Trigger' }).waitFor();
  await page.screenshot({ path: `${output}/trigger-failure.png` });
  failTrigger = false; // connectivity restored before both the negative control and app retry
  const failedEntry = requested.find((url) => /\/TriggerGraphView-[^/]+\.js$/.test(url));
  assert.equal(await page.evaluate(async (url) => {
    try { await import(url); return 'unexpectedly loaded'; } catch { return 'still rejected'; }
  }, failedEntry), 'still rejected');
  assert.equal(triggerRequests, 1, 'Chrome caches the rejected module: the original import alone cannot retry');
  // The failed editor must not strand the performer or interrupt their connection.
  await page.getByRole('button', { name: 'Perform', exact: true }).click();
  await page.locator('.bigpad').first().click();
  await page.getByRole('button', { name: 'Trigger Graph', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Couldn’t load Trigger' }).waitFor();
  assert.equal(triggerRequests, 1, 'navigation must not silently retry');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('.svelte-flow').waitFor();
  assert.equal(triggerRequests, 2, 'retry must make a real new request');
  const entryUrls = requested.filter((url) => /\/TriggerGraphView-[^/]+\.js/.test(url));
  assert.equal(new Set(entryUrls).size, 2, 'retry must use a fresh entry URL');
  assert.ok(entryUrls[1].includes('?load-retry='));
  assert.equal(navigations, 1, 'no automatic app reload');
  assert.equal(sockets, 1, 'same engine connection through recovery');
  assert.equal(requested.filter((url) => /\/index-[^/]+\.js/.test(url)).length, 1, 'shared runtime is not re-imported');
  results.push('aborted production editor import: visible failure → actual network retry → graph ready');

  // Warm navigation must never mount the fallback, even for one DOM mutation.
  await page.getByRole('button', { name: 'Perform', exact: true }).click();
  await page.locator('.bigpad').first().waitFor();
  await page.evaluate(() => {
    window.__lazyFlashes = [];
    window.__lazyObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches('.load-space,.load-feedback') || node.querySelector('.load-space,.load-feedback'))) window.__lazyFlashes.push(node.textContent);
      }
    });
    window.__lazyObserver.observe(document.querySelector('main.center'), { childList: true, subtree: true });
  });
  await page.getByRole('button', { name: 'Trigger Graph', exact: true }).click();
  await page.locator('.svelte-flow').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__lazyFlashes), []);
  assert.equal(triggerRequests, 2);
  results.push('warm Trigger navigation: no import request and no fallback DOM flash');

  // Close Settings BEFORE the first pane can arrive, then resolve off-screen.
  let releaseInput;
  let inputRequests = 0;
  await page.route(/\/assets\/InputPane-[^/]+\.js$/, async (route) => {
    inputRequests++;
    await new Promise((resolve) => { releaseInput = resolve; });
    await route.continue();
  });
  const settingsButton = page.getByRole('button', { name: 'Settings', exact: true });
  await settingsButton.click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('status').filter({ hasText: 'Loading Input' }).waitFor();
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true);
  // Tab/Shift+Tab are trapped even when all pane controls are absent.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true);
  }
  // A focused IconButton tooltip legitimately owns the first Escape. Focus the
  // pane nav (no tooltip/popover) to exercise the dialog's own dismissal layer.
  await dialog.getByRole('button', { name: 'Input', exact: true }).focus();
  await page.screenshot({ path: `${output}/settings-loading.png` });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await settingsButton.evaluate((el) => el === document.activeElement), true, 'Escape restores the opener');
  const inputResponse = page.waitForResponse(/\/assets\/InputPane-[^/]+\.js$/);
  releaseInput();
  await inputResponse;
  await page.waitForTimeout(200);
  assert.equal(await dialog.count(), 0, 'late load cannot reopen a dismissed Settings');
  results.push('Settings loading: focus trap + Escape + opener focus restoration; late completion stays closed');
  await settingsButton.click();
  await dialog.getByRole('region', { name: 'MIDI input devices' }).waitFor();
  assert.equal(inputRequests, 1);
  const originalDialog = await dialog.elementHandle();
  await dialog.getByRole('button', { name: 'Global controls', exact: true }).click();
  await dialog.getByLabel('Global controls', { exact: true }).waitFor();
  assert.equal(await originalDialog.evaluate((el) => el.isConnected), true, 'pane swap retains one dialog');
  await page.screenshot({ path: `${output}/settings-ready.png` });
  await page.keyboard.press('Escape');
  results.push('Settings warm reopen cached; sidebar navigation keeps the same dialog');

  // Delayed route completion must not paint over a later navigation.
  let releaseObjects;
  await page.route(/\/assets\/ObjectsView-[^/]+\.js$/, async (route) => {
    await new Promise((resolve) => { releaseObjects = resolve; });
    await route.continue();
  });
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Loading Objects' }).waitFor();
  await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await page.locator('main.center .sections-view').waitFor();
  const objectsResponse = page.waitForResponse(/\/assets\/ObjectsView-[^/]+\.js$/);
  releaseObjects();
  await objectsResponse;
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('button', { name: 'Sections', exact: true }).getAttribute('aria-current'), 'page');
  results.push('rapid Objects → Sections: late import does not replace the current route');
  assert.deepEqual(errors, [], 'no unhandled browser exceptions');
  // Only the deliberately aborted request may produce a browser network diagnostic.
  assert.equal(consoleErrors.length, 1, JSON.stringify(consoleErrors));
  assert.match(consoleErrors[0], /Failed to load resource: net::ERR_FAILED/);
  await context.close();

  const recoveryContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const recovery = await recoveryContext.newPage();
  const recoveryErrors = [], recoveryConsole = [];
  recovery.on('pageerror', (e) => recoveryErrors.push(e.message));
  recovery.on('console', (m) => { if (m.type() === 'error') recoveryConsole.push(m.text()); });
  let cssRequests = 0;
  await recovery.route(/\/assets\/SectionsView-[^/]+\.css(?:\?.*)?$/, (route) => {
    cssRequests++;
    return cssRequests === 1 ? route.abort('failed') : route.continue();
  });
  let sharedCssRequests = 0;
  await recovery.route(/\/assets\/Field-[^/]+\.css(?:\?.*)?$/, (route) => {
    sharedCssRequests++;
    return sharedCssRequests === 1 ? route.abort('failed') : route.continue();
  });
  let settingsRequests = 0;
  await recovery.route(/\/assets\/InputPane-[^/]+\.js(?:\?.*)?$/, (route) => {
    settingsRequests++;
    if (settingsRequests === 1) return route.abort('failed');
    if (settingsRequests === 2) return route.fulfill({ status: 503, contentType: 'text/javascript', body: '' });
    return route.continue();
  });
  await recovery.goto(`${base}/?view=sections`);
  await recovery.getByRole('alert').filter({ hasText: 'Couldn’t load Sections' }).waitFor();
  await recovery.getByRole('button', { name: 'Try again', exact: true }).click();
  await recovery.locator('main.center .sections-view').waitFor();
  assert.equal(cssRequests, 2, 'retry must really reload a failed stylesheet');
  assert.equal(sharedCssRequests, 2, 'all failed preloads must recover, not just the first reported failure');
  assert.equal(await recovery.evaluate(() => [...document.styleSheets].some((s) => s.href?.includes('SectionsView-') && s.href.includes('load-retry='))), true);
  assert.equal(await recovery.evaluate(() => [...document.styleSheets].some((s) => s.href?.includes('Field-') && s.href.includes('load-retry='))), true);
  results.push('two failed route stylesheets: both re-requested and applied before rendering');
  await recovery.getByRole('button', { name: 'Settings', exact: true }).click();
  const failedSettings = recovery.getByRole('dialog', { name: 'Settings', exact: true });
  await failedSettings.getByRole('alert').filter({ hasText: 'Couldn’t load Input' }).waitFor();
  await recovery.screenshot({ path: `${output}/settings-failure.png` });
  await failedSettings.getByRole('button', { name: 'Try again', exact: true }).click();
  await failedSettings.getByRole('alert').filter({ hasText: 'Couldn’t load Input' }).waitFor();
  await failedSettings.getByRole('button', { name: 'Try again', exact: true }).click();
  await failedSettings.getByRole('region', { name: 'MIDI input devices' }).waitFor();
  assert.equal(settingsRequests, 3);
  assert.equal(await recovery.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true, 'focus stays in Settings when the retry button is replaced');
  await recovery.mouse.move(0, 0);
  await failedSettings.getByRole('button', { name: 'Input', exact: true }).focus();
  await recovery.getByRole('tooltip').waitFor({ state: 'hidden' });
  await recovery.keyboard.press('Escape');
  await failedSettings.waitFor({ state: 'hidden' });
  results.push('Settings pane download fails twice → repeated real retries → Input ready');
  assert.deepEqual(recoveryErrors, []);
  assert.equal(recoveryConsole.length, 4, JSON.stringify(recoveryConsole));
  assert.equal(recoveryConsole.filter((error) => /Failed to load resource: net::ERR_FAILED/.test(error)).length, 3);
  assert.equal(recoveryConsole.filter((error) => /503/.test(error)).length, 1);
  await recoveryContext.close();

  // A failed shared dependency cannot safely be cache-busted recursively: doing
  // that could instantiate another copy of the runtime/store. Be honest instead.
  const sharedContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const shared = await sharedContext.newPage();
  const sharedErrors = [], sharedConsole = [];
  shared.on('pageerror', (e) => sharedErrors.push(e.message));
  shared.on('console', (m) => { if (m.type() === 'error') sharedConsole.push(m.text()); });
  let sharedRequests = 0, sharedNavigations = 0;
  shared.on('framenavigated', (frame) => { if (frame === shared.mainFrame()) sharedNavigations++; });
  await shared.route(/\/assets\/graph-thumb-[^/]+\.js(?:\?.*)?$/, (route) => {
    sharedRequests++;
    return route.abort('failed');
  });
  await shared.goto(`${base}/?view=perform`);
  await shared.locator('.bigpad').first().waitFor();
  await shared.locator('[title="Output disabled — engine not transmitting"]').waitFor();
  const showName = shared.getByTitle('Rename show', { exact: true });
  const originalName = await showName.innerText();
  const recoveryName = `Recovery proof ${Date.now()}`;
  await showName.click();
  await shared.getByLabel('Show name', { exact: true }).fill(recoveryName);
  await shared.getByLabel('Show name', { exact: true }).press('Enter');
  await shared.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  await shared.getByRole('button', { name: 'Trigger Graph', exact: true }).click();
  await shared.getByRole('alert').filter({ hasText: 'Reopen the app when it’s safe to interrupt. Saved edits are kept.' }).waitFor();
  assert.equal(await shared.getByRole('button', { name: 'Try again', exact: true }).count(), 0);
  await shared.screenshot({ path: `${output}/trigger-reopen-guidance.png` });
  await shared.getByRole('button', { name: 'Perform', exact: true }).click();
  await shared.locator('.bigpad').first().click();
  await shared.getByRole('button', { name: 'Trigger Graph', exact: true }).click();
  assert.equal(sharedRequests, 1);
  assert.equal(sharedNavigations, 1);
  assert.deepEqual(sharedErrors, []);
  assert.equal(sharedConsole.length, 1, JSON.stringify(sharedConsole));
  assert.match(sharedConsole[0], /Failed to load resource: net::ERR_FAILED/);
  results.push('failed shared dependency: safe reopen guidance, no fake retry/reload, Perform still usable');
  // Explicit operator-controlled reload, never a side effect of a load failure.
  await shared.reload();
  await shared.locator('[title="Output disabled — engine not transmitting"]').waitFor();
  assert.equal(await showName.innerText(), recoveryName, 'saved edits survive explicit reload');
  await showName.click();
  await shared.getByLabel('Show name', { exact: true }).fill(originalName);
  await shared.getByLabel('Show name', { exact: true }).press('Enter');
  await shared.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  results.push('explicit reload preserves a show-name edit made through the real production UI');
  assert.deepEqual(sharedErrors, []);
  assert.equal(sharedConsole.length, 1);
  await sharedContext.close();
  console.log(JSON.stringify({ results, expectedNetworkErrors: [...consoleErrors, ...recoveryConsole, ...sharedConsole] }, null, 2));
} finally { await browser.close(); }
