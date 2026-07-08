#!/usr/bin/env node
/* ui-shot — one-command screenshots of the running app for agent UI verification.

   Uses playwright-core with the SYSTEM Chrome (channel:'chrome') so no browser
   binaries are ever downloaded. Ensures the dev server is up (starts `pnpm dev`).

   The interface is semantic, not maintenance-driven (see README.md):
     · --target   resolves an element by accessible name / role / text — no CSS
                  registration needed. `[data-shot]→[data-ui]→role/name→aria-label
                  →text→title→CSS`; prefixes (role: dialog: text: node: button:)
                  pick a resolver explicitly.
     · --state    drives the app into a state via the dev-only window.__LEDRUMS_SHOT__
                  seam ("view:trigger,add:scope,select:scope"), replacing click chains.
     · --discover lists the capturable targets of a view from the DOM / a11y tree.
     · shots.json holds named presets { state, target, name?, viewport? } for CI/sweeps.

   Console errors + uncaught page errors during capture are surfaced per shot. */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const OUT_DIR = join(repoRoot, '.ui-shots');
const BASE = process.env.UI_SHOT_BASE ?? 'http://localhost:5173';

const CATALOGUE = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
const DEFAULT_VIEWPORT = { width: 1600, height: 1000 };

function usage() {
  console.log(`Usage:
  pnpm ui-shot <name...>            capture named preset(s) from shots.json
  pnpm ui-shot --all                capture every named preset
  pnpm ui-shot --list               list named presets
  pnpm ui-shot --view trigger --target "Node editor" [--name out]     semantic capture
  pnpm ui-shot --state "view:trigger,add:scope,select:scope" --target "Node editor" --name scope
  pnpm ui-shot --route "?view=patch" --target "main.center" --name my-shot   ad-hoc (raw route)
  pnpm ui-shot --discover --view trigger        list capturable targets of a view

Target resolution (bare string walks the chain; prefix forces a resolver):
  [data-shot] → [data-ui] → role+name → [aria-label] → visible text → [title] → CSS
  role:region[name='Trigger graph canvas']   dialog:Change effect   text:Mix
  node:controller   button:Add Scope

Options: --full (full page), --strict (exit 1 on any console/page error), --viewport WxH,
         --settle MS (extra wait before capture — for animated canvases: visualizer, patch, gallery)
Output: .ui-shots/<name>.png (gitignored); --discover also writes .ui-shots/discover-<view>.html`);
}

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const OPTS_WITH_VALUE = ['--route', '--name', '--select', '--target', '--state', '--view', '--viewport', '--settle'];

if (args.length === 0 || flag('--help')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}
if (flag('--list')) {
  for (const [name, s] of Object.entries(CATALOGUE)) {
    console.log(`${name.padEnd(28)} ${s.state ?? ''}${s.target ? `  → ${s.target}` : ''}`);
  }
  process.exit(0);
}

function parseViewport(spec) {
  const m = /^(\d+)x(\d+)$/.exec(spec ?? '');
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}
const cliViewport = parseViewport(opt('--viewport'));
const cliSettle = opt('--settle') !== undefined ? Number(opt('--settle')) : undefined;

/** view name → deep-link route. */
const routeForView = (view) => (view ? `?view=${view}` : undefined);

// --- build the shot request list -------------------------------------------
// A request is { name, route?, state?, target?, viewport? }. `--select` is a
// back-compat alias for `--target` (a raw CSS string resolves via the CSS fallback).
let shots;
const discovering = flag('--discover');

if (discovering) {
  const view = opt('--view');
  const route = opt('--route') ?? routeForView(view);
  shots = [{ name: `discover-${view ?? 'root'}`, route, state: opt('--state'), viewport: cliViewport }];
} else if (opt('--route') !== undefined || opt('--target') !== undefined || opt('--state') !== undefined || opt('--view') !== undefined || opt('--select') !== undefined) {
  shots = [
    {
      name: opt('--name') ?? 'adhoc',
      route: opt('--route') ?? routeForView(opt('--view')),
      state: opt('--state'),
      target: opt('--target') ?? opt('--select'),
      viewport: cliViewport,
      settle: cliSettle,
    },
  ];
} else if (flag('--all')) {
  shots = Object.entries(CATALOGUE).map(([name, s]) => shotFromPreset(name, s));
} else {
  const names = args.filter((a, i) => !a.startsWith('--') && !OPTS_WITH_VALUE.includes(args[i - 1]));
  shots = names.map((name) => {
    if (!CATALOGUE[name]) {
      console.error(`Unknown preset "${name}". Use --list.`);
      process.exit(1);
    }
    return shotFromPreset(name, CATALOGUE[name]);
  });
}

function shotFromPreset(name, preset) {
  return {
    name: preset.name ?? name,
    route: preset.route,
    state: preset.state,
    target: preset.target,
    viewport: parseViewport(preset.viewport) ?? cliViewport,
    settle: preset.settle ?? cliSettle,
  };
}

// --- dev server -------------------------------------------------------------
async function serverUp() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}
async function ensureServer() {
  if (await serverUp()) return;
  console.log(`dev server not detected at ${BASE} — starting \`pnpm dev\`…`);
  const child = spawn('pnpm', ['dev'], { cwd: repoRoot, detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await serverUp()) {
      await new Promise((r) => setTimeout(r, 2000)); // let vite finish first-compile
      return;
    }
  }
  console.error(`dev server did not come up at ${BASE} within 60s`);
  process.exit(1);
}

// --- state seam -------------------------------------------------------------
async function applyState(page, state) {
  if (!state) return;
  await page.waitForFunction(() => !!window.__LEDRUMS_SHOT__, { timeout: 8000 });
  await page.evaluate((spec) => window.__LEDRUMS_SHOT__.apply(spec), state);
  await page.waitForTimeout(400); // let the last op's render settle before resolving the target
}

// --- target resolver --------------------------------------------------------
// Returns { locator, how } for the first strategy that matches, or null. Bare
// strings walk the accessibility-first chain; a `prefix:` forces one resolver.
const COMMON_ROLES = [
  'region', 'button', 'dialog', 'link', 'heading', 'tab', 'tabpanel',
  'navigation', 'textbox', 'menu', 'menuitem', 'list', 'listitem', 'article', 'group', 'img',
];

function parseRoleSpec(spec) {
  const m = /^([a-z]+)(?:\[name=(['"])(.*)\2\])?$/i.exec(spec.trim());
  if (!m) return { role: spec.trim() };
  return { role: m[1], name: m[3] };
}

async function firstHit(candidates) {
  for (const { locator, how } of candidates) {
    try {
      if ((await locator.count()) > 0) return { locator: locator.first(), how };
    } catch {
      /* invalid selector for this strategy — skip */
    }
  }
  return null;
}

async function resolveTarget(page, target) {
  const prefixIdx = target.indexOf(':');
  const prefix = prefixIdx > 0 ? target.slice(0, prefixIdx) : '';
  const rest = prefixIdx > 0 ? target.slice(prefixIdx + 1) : target;

  switch (prefix) {
    case 'role': {
      const { role, name } = parseRoleSpec(rest);
      return firstHit([{ locator: page.getByRole(role, name ? { name } : {}), how: `role:${role}` }]);
    }
    case 'dialog':
      return firstHit([
        { locator: page.getByRole('dialog', { name: rest }), how: 'dialog(role+name)' },
        { locator: page.locator(`[role="dialog"]:has-text("${rest}")`), how: 'dialog(has-text)' },
      ]);
    case 'text':
      return firstHit([{ locator: page.getByText(rest), how: 'text' }]);
    case 'node':
      return firstHit([{ locator: page.locator(`.svelte-flow__node:has-text(${JSON.stringify(rest)})`), how: 'node' }]);
    case 'button':
      return firstHit([{ locator: page.getByRole('button', { name: rest }), how: 'button' }]);
    default:
      break;
  }

  // Bare string: walk the chain, accessibility first, CSS last.
  const chain = [
    { locator: page.locator(`[data-shot="${target}"]`), how: 'data-shot' },
    { locator: page.locator(`[data-ui="${target}"]`), how: 'data-ui' },
    ...COMMON_ROLES.map((role) => ({ locator: page.getByRole(role, { name: target }), how: `role:${role}` })),
    { locator: page.locator(`[aria-label="${target}"]`), how: 'aria-label' },
    { locator: page.getByText(target), how: 'text' },
    { locator: page.locator(`[title="${target}"]`), how: 'title' },
    { locator: page.locator(target), how: 'css' },
  ];
  return firstHit(chain);
}

// --- discovery --------------------------------------------------------------
// Collect the capturable targets of the current page from the DOM + a11y hints.
function discoverInPage() {
  const seen = new Set();
  const out = [];
  const push = (type, name, target, rect) => {
    const key = `${type} ${name}`;
    if (!name || seen.has(key)) return;
    seen.add(key);
    out.push({ type, name, target, x: rect.x, y: rect.y, w: rect.width, h: rect.height });
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 ? r : null;
  };
  const accName = (el) => {
    const label = el.getAttribute('aria-label');
    if (label) return label.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const ref = document.getElementById(by);
      if (ref) return ref.textContent.trim();
    }
    const heading = el.querySelector('h1,h2,h3,[role="heading"]');
    return heading ? heading.textContent.trim() : '';
  };

  for (const el of document.querySelectorAll('[data-shot]')) {
    const r = visible(el);
    if (r) push('shot', el.getAttribute('data-shot'), `${el.getAttribute('data-shot')}`, r);
  }
  for (const el of document.querySelectorAll('[data-ui]')) {
    const r = visible(el);
    if (r) push('ui', el.getAttribute('data-ui'), `${el.getAttribute('data-ui')}`, r);
  }
  for (const el of document.querySelectorAll('[role="region"], main, section[aria-label], aside[aria-label], nav[aria-label]')) {
    const r = visible(el);
    const name = accName(el);
    if (r && name) push('region', name, `${name}`, r);
  }
  for (const el of document.querySelectorAll('[role="dialog"]')) {
    const r = visible(el);
    const name = accName(el);
    if (r && name) push('dialog', name, `dialog:${name}`, r);
  }
  for (const el of document.querySelectorAll('button, [role="button"]')) {
    const r = visible(el);
    if (!r) continue;
    const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
    if (name && name.length <= 40) push('button', name, `button:${name}`, r);
  }
  for (const el of document.querySelectorAll('.svelte-flow__node')) {
    const r = visible(el);
    if (!r) continue;
    const name = (el.textContent || '').trim().split('\n')[0].trim();
    if (name) push('node', name, `node:${name}`, r);
  }
  return out;
}

function printDiscovery(entries) {
  const order = { region: 0, dialog: 1, button: 2, node: 3, ui: 4, shot: 5 };
  const rows = [...entries].sort((a, b) => (order[a.type] - order[b.type]) || a.name.localeCompare(b.name));
  if (rows.length === 0) {
    console.log('(no capturable targets found — is the view rendered?)');
    return;
  }
  for (const r of rows) {
    console.log(`${r.type.padEnd(8)} ${r.name.padEnd(28)} --target "${r.target}"`);
  }
}

function writeDiscoveryOverlay(name, entries, screenshotB64, viewport) {
  const boxes = entries
    .map(
      (e) =>
        `<div class="box" style="left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px">` +
        `<span class="tag">${e.type}: ${e.target.replace(/</g, '&lt;')}</span></div>`,
    )
    .join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>ui-shot discover — ${name}</title>
<style>
  body{margin:0;background:#0b0b0d;font:12px/1.3 ui-monospace,monospace;color:#eee}
  .stage{position:relative;width:${viewport.width}px}
  .stage img{display:block;width:100%;opacity:.55}
  .box{position:absolute;border:1px solid #4ade80;box-sizing:border-box}
  .box .tag{position:absolute;top:-16px;left:0;background:#4ade80;color:#0b0b0d;padding:0 4px;white-space:nowrap;font-weight:600}
</style>
<div class="stage"><img src="data:image/png;base64,${screenshotB64}"/>
${boxes}
</div>`;
  const out = join(OUT_DIR, `${name}.html`);
  writeFileSync(out, html);
  return out;
}

// --- capture ----------------------------------------------------------------
await ensureServer();
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT, deviceScaleFactor: 2 });

let totalErrors = 0;
for (const shot of shots) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`UNCAUGHT: ${e.message}`));
  const viewport = shot.viewport ?? DEFAULT_VIEWPORT;
  try {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE}/${shot.route ?? ''}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(700);
    await applyState(page, shot.state);
    if (shot.settle) await page.waitForTimeout(shot.settle);

    if (discovering) {
      const entries = await page.evaluate(discoverInPage);
      console.log(`\n${shot.name}  (${entries.length} targets)`);
      printDiscovery(entries);
      try {
        const b64 = (await page.screenshot({ fullPage: false })).toString('base64');
        console.log(`overlay: ${writeDiscoveryOverlay(shot.name, entries, b64, viewport)}`);
      } catch (e) {
        console.error(`(overlay skipped: ${e.message.split('\n')[0]})`);
      }
    } else {
      const out = join(OUT_DIR, `${shot.name}.png`);
      let locator = null;
      if (shot.target) {
        const hit = await resolveTarget(page, shot.target);
        if (!hit) throw new Error(`target not found: ${shot.target}`);
        locator = hit.locator;
        const box = await locator.boundingBox();
        if (!box || box.width < 1 || box.height < 1) throw new Error(`target has zero size: ${shot.target} (${hit.how})`);
      }
      if (locator) await locator.screenshot({ path: out });
      else await page.screenshot({ path: out, fullPage: flag('--full') });
      console.log(out);
    }
  } catch (e) {
    console.error(`✗ ${shot.name}: ${e.message.split('\n')[0]}`);
    totalErrors++;
  }
  if (errors.length) {
    totalErrors += errors.length;
    console.error(`⚠ ${shot.name}: ${errors.length} console/page error(s):`);
    for (const err of [...new Set(errors)].slice(0, 10)) console.error(`   ${err.slice(0, 300)}`);
  }
  await page.close();
}

await browser.close();
process.exit(flag('--strict') && totalErrors > 0 ? 1 : 0);
