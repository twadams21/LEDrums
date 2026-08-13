#!/usr/bin/env node
/* engine-color-parity — does a colour expression paint the same in WebKit and Chromium?
 *
 * We develop in Chromium and ship a WKWebView desktop app, so any colour the two engines
 * disagree about is invisible here and obvious on the machines that run the show. This
 * measures that disagreement directly: render swatches in both engines, screenshot, and
 * sample the actual pixels. A computed style is only what an engine SAYS it will paint.
 *
 * Two independent questions, deliberately kept apart, because they have different answers
 * and different fixes:
 *
 *   Section A — colour maths. Tokens are PINNED to one rendition in both engines, so the
 *     only variable left is how each engine evaluates the expression. This is where a
 *     claim like "color-mix() toward `transparent` resolves differently in WebKit" gets
 *     tested. (Measured 2026-08-13: it does not. `color-mix(in oklch, X N%, transparent)`
 *     and `oklch(from X l c h / N%)` compute to the same value in both engines — premultiplied
 *     alpha cancels the transparent-black endpoint exactly as spec'd. Both forms are kept as
 *     cases so that stays a regression test rather than a memory.)
 *
 *   Section B — which rendition each engine picks. tokens.css carries an sRGB rendition
 *     behind `@media not all and (color-gamut: p3)`, and the engines do NOT answer that
 *     query alike: WebKit reports P3 where Chromium reports sRGB on the same machine. Then
 *     each paints a different token value — a real divergence that no amount of correct
 *     colour maths prevents, and the one this script actually catches today.
 *
 * Exit status is Section A's alone: a non-zero exit means an expression form is not
 * engine-stable. Section B is reported with numbers rather than enforced, because the
 * answer to "is this display P3" legitimately differs per machine; see the report at
 * docs/color/2026-08-13-webkit-colour-divergence.md for what to do about it.
 *
 * Usage: node apps/web/scripts/engine-color-parity.mjs [--verbose]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, meanPixel } from './png-pixels.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const OUT_DIR = join(repoRoot, '.ui-shots');
export const TOKENS_PATH = join(here, '../src/styles/tokens.css');

/** Backdrop the swatches composite over — mid grey, so a shift either way shows. */
const BACKDROP = 'rgb(58, 58, 58)';

/** Largest per-channel difference (0–255) we call "the same colour". */
export const TOLERANCE = 2;

/**
 * One per transparent-endpoint shape the app uses: both interpolation spaces, both
 * argument orders, high and low chroma, heavy and feather-light alphas, and the bare
 * `black` literal used for scrims. `old` and `new` must agree — that equivalence is the
 * evidence that rewriting one form to the other would change nothing on screen.
 */
export const CASES = [
  { name: 'accent 55%', base: 'var(--accent)', old: 'color-mix(in oklch, var(--accent) 55%, transparent)', new: 'oklch(from var(--accent) l c h / 55%)' },
  { name: 'accent 22%', base: 'var(--accent)', old: 'color-mix(in oklch, var(--accent) 22%, transparent)', new: 'oklch(from var(--accent) l c h / 22%)' },
  { name: 'accent 6%', base: 'var(--accent)', old: 'color-mix(in oklch, var(--accent) 6%, transparent)', new: 'oklch(from var(--accent) l c h / 6%)' },
  { name: 'live 45%', base: 'var(--live)', old: 'color-mix(in oklch, var(--live) 45%, transparent)', new: 'oklch(from var(--live) l c h / 45%)' },
  { name: 'live-bright 70%', base: 'var(--live-bright)', old: 'color-mix(in oklch, var(--live-bright) 70%, transparent)', new: 'oklch(from var(--live-bright) l c h / 70%)' },
  { name: 'warn 55%', base: 'var(--warn)', old: 'color-mix(in oklch, var(--warn) 55%, transparent)', new: 'oklch(from var(--warn) l c h / 55%)' },
  { name: 'ok 60%', base: 'var(--ok)', old: 'color-mix(in oklch, var(--ok) 60%, transparent)', new: 'oklch(from var(--ok) l c h / 60%)' },
  { name: 'role-mod 65%', base: 'var(--role-mod)', old: 'color-mix(in oklch, var(--role-mod) 65%, transparent)', new: 'oklch(from var(--role-mod) l c h / 65%)' },
  { name: 'surface 86%', base: 'var(--surface)', old: 'color-mix(in oklch, var(--surface) 86%, transparent)', new: 'oklch(from var(--surface) l c h / 86%)' },
  { name: 'bg 62%', base: 'var(--bg)', old: 'color-mix(in oklch, var(--bg) 62%, transparent)', new: 'oklch(from var(--bg) l c h / 62%)' },
  { name: 'text-faint 22% (oklab)', base: 'var(--text-faint)', old: 'color-mix(in oklab, var(--text-faint) 22%, transparent)', new: 'oklch(from var(--text-faint) l c h / 22%)' },
  { name: 'accent 45% (oklab)', base: 'var(--accent)', old: 'color-mix(in oklab, var(--accent) 45%, transparent)', new: 'oklch(from var(--accent) l c h / 45%)' },
  { name: 'accent, transparent 58% (oklab)', base: 'var(--accent)', old: 'color-mix(in oklab, var(--accent), transparent 58%)', new: 'oklch(from var(--accent) l c h / 42%)' },
  { name: 'accent, transparent 90% (oklab)', base: 'var(--accent)', old: 'color-mix(in oklab, var(--accent), transparent 90%)', new: 'oklch(from var(--accent) l c h / 10%)' },
  { name: 'black 18% (scrim)', base: 'black', old: 'color-mix(in oklch, black 18%, transparent)', new: 'rgb(0 0 0 / 18%)' },
  { name: 'black 26% (scrim)', base: 'black', old: 'color-mix(in oklch, black 26%, transparent)', new: 'rgb(0 0 0 / 26%)' },
];

const SWATCH = 60;
const GAP = 8;
export const KINDS = ['base', 'old', 'new'];

/**
 * The generated sRGB rendition block, re-emitted with NO media query around it.
 * Applying this pins every dual-rendition token to one value in both engines, which is
 * what makes Section A a controlled experiment instead of two variables at once.
 * @param {string} css contents of tokens.css
 */
export function pinnedRenditions(css) {
  const marker = '@media not all and (color-gamut: p3) {';
  const i = css.indexOf(marker);
  if (i === -1) throw new Error('tokens.css has no generated sRGB rendition block to pin');
  const rest = css.slice(i + marker.length);
  const end = rest.indexOf('\n}\n');
  if (end === -1) throw new Error('unterminated sRGB rendition block in tokens.css');
  // Raise specificity so these win over the authored `:root` above them.
  return rest.slice(0, end).replace(/:root\s*\{/g, ':root:root {').replace(/\[data-accent='(\w+)'\]/g, ":root:root [data-accent='$1']");
}

/** A standalone page of swatches, with the real tokens inlined so `var()` resolves. */
export function buildPage(cases, tokensCss, { pin = true } = {}) {
  const rows = cases
    .map(
      (c, i) => `<div class="row" data-case="${i}">
    <div class="label">${c.name}</div>
    ${KINDS.map((k) => `<div class="sw" data-kind="${k}" style="background:${c[k]}"></div>`).join('\n    ')}
  </div>`,
    )
    .join('\n  ');
  return `<!doctype html><meta charset="utf-8"><title>engine colour parity</title>
<style>
${tokensCss}
${pin ? pinnedRenditions(tokensCss) : ''}
html, body { margin: 0; background: ${BACKDROP}; }
body { font: 12px/1.4 system-ui, sans-serif; color: #fff; padding: ${GAP}px; }
.row { display: flex; align-items: center; gap: ${GAP}px; margin-bottom: ${GAP}px; }
.label { width: 220px; flex: none; }
.sw { width: ${SWATCH}px; height: ${SWATCH}px; flex: none; }
</style>
<body>
  ${rows}
</body>`;
}

/** Largest per-channel difference between two `[r,g,b]` samples. */
export const maxDelta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

const fmt = (p) => `(${p.map((v) => Math.round(v)).join(',')})`;

/** Sample every swatch in one engine, plus what it thinks the display gamut is. */
async function sampleEngine(browserType, html, shotPath) {
  const browser = await browserType.launch();
  const page = await browser.newPage({
    viewport: { width: 700, height: 40 + CASES.length * (SWATCH + GAP) },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: 'load' });
  const { boxes, p3 } = await page.evaluate(() => ({
    p3: matchMedia('(color-gamut: p3)').matches,
    boxes: [...document.querySelectorAll('.sw')].map((el) => {
      const r = el.getBoundingClientRect();
      return { key: `${el.closest('.row').dataset.case}:${el.dataset.kind}`, x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  }));
  const png = await page.screenshot({ fullPage: true, type: 'png' });
  writeFileSync(shotPath, png);
  const img = decodePng(png);
  const samples = {};
  for (const b of boxes) {
    // Inset well clear of the edges — an antialiased border pixel is not the fill colour.
    const inset = 8;
    samples[b.key] = meanPixel(img, Math.round(b.x) + inset, Math.round(b.y) + inset, Math.round(b.w) - 2 * inset, Math.round(b.h) - 2 * inset);
  }
  await browser.close();
  return { samples, p3 };
}

/** Run one section (pinned or free) and return per-case deltas. */
async function measure({ pin }) {
  const { chromium, webkit } = await import('playwright-core');
  mkdirSync(OUT_DIR, { recursive: true });
  const html = buildPage(CASES, readFileSync(TOKENS_PATH, 'utf8'), { pin });
  const tag = pin ? 'pinned' : 'free';
  const chrome = await sampleEngine(chromium, html, join(OUT_DIR, `color-parity-${tag}-chromium.png`));
  const wk = await sampleEngine(webkit, html, join(OUT_DIR, `color-parity-${tag}-webkit.png`));

  const rows = CASES.map((c, i) => {
    const per = Object.fromEntries(
      KINDS.map((k) => {
        const pair = { chromium: chrome.samples[`${i}:${k}`], webkit: wk.samples[`${i}:${k}`] };
        return [k, { ...pair, delta: maxDelta(pair.chromium, pair.webkit) }];
      }),
    );
    // Do the two FORMS agree, within one engine? That is the rewrite question.
    const formDelta = Math.max(maxDelta(per.old.chromium, per.new.chromium), maxDelta(per.old.webkit, per.new.webkit));
    return { name: c.name, ...per, formDelta };
  });
  return { rows, p3: { chromium: chrome.p3, webkit: wk.p3 } };
}

export async function measureParity({ verbose = false } = {}) {
  const pinned = await measure({ pin: true });
  const free = await measure({ pin: false });
  const worst = (rows, kind) => Math.max(...rows.map((r) => (kind === 'form' ? r.formDelta : r[kind].delta)));

  if (verbose) {
    for (const r of pinned.rows) {
      console.log(`\n  ${r.name}`);
      for (const k of KINDS) {
        console.log(`    ${k.padEnd(5)} chromium ${fmt(r[k].chromium)}  webkit ${fmt(r[k].webkit)}  Δ ${r[k].delta.toFixed(1)}`);
      }
    }
  }
  return {
    pinned: pinned.rows,
    free: free.rows,
    p3: pinned.p3,
    worstBase: worst(pinned.rows, 'base'),
    worstOld: worst(pinned.rows, 'old'),
    worstNew: worst(pinned.rows, 'new'),
    worstForm: worst(pinned.rows, 'form'),
    worstFreeBase: worst(free.rows, 'base'),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const verbose = process.argv.includes('--verbose');
  const r = await measureParity({ verbose });

  console.log(`\nchromium vs webkit — ${CASES.length} cases, tolerance ±${TOLERANCE}/255`);
  console.log(`\nSECTION A — colour maths (tokens pinned to one rendition in both engines)`);
  console.log(`  base  — control, must be ~0            worst Δ ${r.worstBase.toFixed(1)}`);
  console.log(`  color-mix(…, transparent) across engines  worst Δ ${r.worstOld.toFixed(1)}`);
  console.log(`  oklch(from … / a)         across engines  worst Δ ${r.worstNew.toFixed(1)}`);
  console.log(`  the two forms vs each other, same engine  worst Δ ${r.worstForm.toFixed(1)}`);

  console.log(`\nSECTION B — rendition choice (each engine answers color-gamut for itself)`);
  console.log(`  matchMedia('(color-gamut: p3)')  chromium ${r.p3.chromium}  webkit ${r.p3.webkit}`);
  console.log(`  worst token divergence once unpinned     worst Δ ${r.worstFreeBase.toFixed(1)}`);
  if (r.p3.chromium !== r.p3.webkit) {
    const bad = r.free.filter((x) => x.base.delta > TOLERANCE).map((x) => `${x.name.replace(/ \d+%.*/, '')} Δ${x.base.delta.toFixed(0)}`);
    console.log(`  ⚠ the engines disagree about the display gamut, so they paint different token`);
    console.log(`    values on the SAME machine${bad.length ? `: ${[...new Set(bad)].join(', ')}` : ''}`);
  }
  if (!verbose) console.log('\n  (re-run with --verbose for per-case sampled RGB)');
  console.log(`  screenshots: .ui-shots/color-parity-{pinned,free}-{chromium,webkit}.png`);

  if (r.worstBase > TOLERANCE) {
    console.log(`\n✗ the CONTROL diverged (Δ ${r.worstBase.toFixed(1)}) — pinning failed, so Section A proves nothing\n`);
    process.exit(2);
  }
  if (r.worstNew > TOLERANCE || r.worstOld > TOLERANCE || r.worstForm > TOLERANCE) {
    console.log(`\n✗ a colour expression is NOT engine-stable — see the per-case table\n`);
    process.exit(1);
  }
  console.log(`\n✓ Section A: every form agrees across engines, and with each other\n`);
}
