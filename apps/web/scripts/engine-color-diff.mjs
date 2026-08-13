#!/usr/bin/env node
/* engine-color-diff — every colour the RUNNING app resolves differently in WebKit than in
 * Chromium, attributed to the element that paints it.
 *
 * `engine-color-parity.mjs` answers "does this expression paint the same in both engines"
 * for expressions we hand it. This answers the question that actually matters: across the
 * whole app, on real markup, what actually differs? It is the tool that tells you whether
 * a colour-divergence report is a real bug or a hypothesis, before anyone rewrites 69 call
 * sites on a hunch. (It was written after exactly that near-miss; see
 * docs/color/2026-08-13-webkit-colour-divergence.md.)
 *
 * Two passes, because there are two independent ways engines can disagree:
 *
 *   free   — each engine answers `color-gamut` for itself, i.e. what ships today. A
 *            difference here can be either engine choosing a different token rendition
 *            OR evaluating a colour differently; this pass alone can't tell you which.
 *   pinned — both engines forced onto identical token values. Anything still differing
 *            here is the engines PAINTING differently, which is the far more serious
 *            failure and the one no media query can fix.
 *
 * Two controls keep app state from masquerading as a colour bug: elements are matched on
 * tag AND class (a differing class is different app state, not a different colour), and
 * animations/transitions are frozen (a pulsing dot sampled at two phases is not evidence).
 * Skipped-on-mismatch counts are printed, never hidden — a pass that silently compared
 * nothing would look identical to a pass that found nothing wrong.
 *
 * Needs the dev server up: `pnpm dev` (or point --base at one).
 * Usage: node apps/web/scripts/engine-color-diff.mjs [--base http://localhost:5173] [--json]
 */
import { readFileSync } from 'node:fs';
import { converter, parse } from 'culori';
import { pinnedRenditions, TOKENS_PATH } from './engine-color-parity.mjs';

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};
const BASE = argOf('--base', process.env.UI_SHOT_BASE ?? 'http://localhost:5173');
const VIEWS = ['perform', 'objects', 'sections', 'trigger', 'patch', 'monitor'];

/** Difference below this is rounding, not a colour. */
export const TOLERANCE = 1;

const COLOUR_PROPS = [
  'color', 'background-color',
  'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color',
  'outline-color', 'fill', 'stroke', 'box-shadow', 'background-image', 'text-shadow',
];

/** Nothing may animate: a pulsing dot sampled at two phases is not a colour divergence. */
const FREEZE = '*, *::before, *::after { animation: none !important; transition: none !important; }';

const toRgb = converter('rgb');
const COLOUR_RE = /\b(?:oklch|oklab|lch|lab|color|rgba?|hsla?|hwb|color-mix)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-fA-F]{3,8}\b/g;

/** A colour literal as it lands on screen: sRGB 0–255, alpha already applied. */
export function paintedRgb(literal) {
  const c = parse(literal);
  if (!c) return null;
  const v = toRgb(c);
  if (!v || [v.r, v.g, v.b].some((x) => typeof x !== 'number' || Number.isNaN(x))) return null;
  const a = c.alpha ?? 1;
  const clamp = (x) => Math.min(1, Math.max(0, x));
  return [clamp(v.r) * 255 * a, clamp(v.g) * 255 * a, clamp(v.b) * 255 * a];
}

const delta = (a, b) => (a && b ? Math.max(...a.map((x, i) => Math.abs(x - b[i])))  : 0);

/** Every painted colour in the document, in tree order, tagged with tag+class identity. */
const COLLECT = (props) => {
  const out = [];
  document.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    const rec = {};
    let any = false;
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      if (v && v !== 'none' && v !== 'rgba(0, 0, 0, 0)') {
        rec[p] = v;
        any = true;
      }
    }
    if (any) out.push({ tag: el.tagName, cls: el.getAttribute('class') || '', props: rec });
  });
  return { out, p3: matchMedia('(color-gamut: p3)').matches };
};

async function collect(browserType, extraCss) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const byView = {};
  for (const view of VIEWS) {
    await page.goto(`${BASE}/?view=${view}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: extraCss });
    await page.waitForTimeout(1000);
    byView[view] = await page.evaluate(COLLECT, COLOUR_PROPS);
  }
  await browser.close();
  return byView;
}

/**
 * Compare two engines' collections.
 * @returns {{ diffs: Array, compared: number, skipped: number }}
 */
export function compare(chrome, wk, views = VIEWS) {
  const diffs = new Map();
  let compared = 0;
  let skipped = 0;
  for (const view of views) {
    const a = chrome[view].out;
    const b = wk[view].out;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      // A differing class is different app state — not something this tool can compare.
      if (a[i].tag !== b[i].tag || a[i].cls !== b[i].cls) {
        skipped++;
        continue;
      }
      compared++;
      for (const prop of Object.keys(a[i].props)) {
        const va = a[i].props[prop];
        const vb = b[i].props[prop];
        if (!vb || va === vb) continue;
        const la = va.match(COLOUR_RE) ?? [];
        const lb = vb.match(COLOUR_RE) ?? [];
        if (la.length !== lb.length) continue; // different shape (e.g. shadow count) — not a colour claim
        la.forEach((lit, k) => {
          const d = delta(paintedRgb(lit), paintedRgb(lb[k]));
          if (d <= TOLERANCE) return;
          const key = `${prop}|${lit}|${lb[k]}`;
          const e = diffs.get(key) ?? { prop, chromium: lit, webkit: lb[k], delta: d, count: 0, views: new Set(), where: [] };
          e.count++;
          e.views.add(view);
          if (e.where.length < 2) e.where.push(`${a[i].tag}.${a[i].cls.slice(0, 40)}`);
          diffs.set(key, e);
        });
      }
    }
  }
  return { diffs: [...diffs.values()].sort((x, y) => y.delta - x.delta), compared, skipped };
}

async function pass(label, extraCss) {
  const { chromium, webkit } = await import('playwright-core');
  const chrome = await collect(chromium, extraCss);
  const wk = await collect(webkit, extraCss);
  const { diffs, compared, skipped } = compare(chrome, wk);
  console.log(`\n===== ${label} =====`);
  console.log(`  color-gamut p3: chromium ${chrome[VIEWS[0]].p3}, webkit ${wk[VIEWS[0]].p3}`);
  console.log(`  ${compared} elements compared, ${skipped} skipped on state mismatch`);
  console.log(`  distinct diverging colours: ${diffs.length}`);
  for (const e of diffs.slice(0, 30)) {
    console.log(`\n  Δ${e.delta.toFixed(1)}/255  x${e.count}  [${[...e.views].join(', ')}]  ${e.prop}`);
    console.log(`      chromium  ${e.chromium}`);
    console.log(`      webkit    ${e.webkit}`);
    console.log(`      e.g.      ${e.where.join(' | ')}`);
  }
  return { diffs, compared, skipped };
}

if (process.argv[1] && (await import('node:url')).fileURLToPath(import.meta.url) === process.argv[1]) {
  const pin = pinnedRenditions(readFileSync(TOKENS_PATH, 'utf8'));
  const free = await pass('PASS 1 — free (each engine answers color-gamut for itself)', FREEZE);
  const pinned = await pass('PASS 2 — pinned (both engines on identical token values)', `${FREEZE}\n${pin}`);

  console.log('\n----------------------------------------------------------------');
  if (!free.compared || !pinned.compared) {
    console.log('✗ compared nothing — is the dev server up at ' + BASE + '?\n');
    process.exit(2);
  }
  if (pinned.diffs.length) {
    console.log(`✗ ${pinned.diffs.length} colour(s) differ even with identical token values:`);
    console.log('  the engines are painting differently — a media query cannot fix this.\n');
    process.exit(1);
  }
  console.log('✓ with identical token values the engines paint identically.');
  console.log(free.diffs.length
    ? `  The ${free.diffs.length} difference(s) in pass 1 are rendition CHOICE (color-gamut), not colour maths.\n`
    : '  No divergence in either pass.\n');
}
