#!/usr/bin/env node
/* ui-shot — one-command screenshots of the running app for agent UI verification.
   Uses playwright-core with the SYSTEM Chrome (channel:'chrome') so no browser
   binaries are ever downloaded. Named shots live in shots.json; ad-hoc capture
   via --route/--select. Ensures the dev server is up (starts `pnpm dev` if not).
   Console errors + uncaught page errors during capture are surfaced per shot. */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const OUT_DIR = join(repoRoot, '.ui-shots');
const BASE = process.env.UI_SHOT_BASE ?? 'http://localhost:5173';

const CATALOGUE = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));

function usage() {
  console.log(`Usage:
  pnpm ui-shot <name...>            capture named shot(s) from shots.json
  pnpm ui-shot --all                capture every named shot
  pnpm ui-shot --list               list named shots
  pnpm ui-shot --route "?view=patch" [--select "css"] [--name out]   ad-hoc capture
Options: --full (full page), --strict (exit 1 if any console/page errors)
Output: .ui-shots/<name>.png (gitignored)`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}
if (args.includes('--list')) {
  for (const [name, s] of Object.entries(CATALOGUE)) console.log(`${name.padEnd(24)} ${s.route ?? '/'}${s.select ? `  [${s.select}]` : ''}`);
  process.exit(0);
}

const flag = (f) => args.includes(f);
const opt = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

let shots;
if (opt('--route') !== undefined) {
  shots = [{ name: opt('--name') ?? 'adhoc', route: opt('--route'), select: opt('--select') }];
} else if (flag('--all')) {
  shots = Object.entries(CATALOGUE).map(([name, s]) => ({ name, ...s }));
} else {
  const names = args.filter((a) => !a.startsWith('--'));
  shots = names.map((name) => {
    if (!CATALOGUE[name]) {
      console.error(`Unknown shot "${name}". Use --list.`);
      process.exit(1);
    }
    return { name, ...CATALOGUE[name] };
  });
}

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

async function runActions(page, actions = []) {
  for (const a of actions) {
    if (a.click) await page.locator(a.click).first().click({ timeout: 5000 });
    else if (a.scrollTo) await page.locator(a.scrollTo).first().scrollIntoViewIfNeeded({ timeout: 5000 });
    else if (a.wait) await page.waitForTimeout(a.wait);
  }
}

await ensureServer();
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

let totalErrors = 0;
for (const shot of shots) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`UNCAUGHT: ${e.message}`));
  const out = join(OUT_DIR, `${shot.name}.png`);
  try {
    await page.goto(`${BASE}/${shot.route ?? ''}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(shot.settle ?? 700);
    await runActions(page, shot.actions);
    if (shot.actions?.length) await page.waitForTimeout(300);
    const target = shot.select ? page.locator(shot.select).first() : page;
    await target.screenshot({ path: out, ...(shot.select ? {} : { fullPage: flag('--full') }) });
    console.log(out);
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
