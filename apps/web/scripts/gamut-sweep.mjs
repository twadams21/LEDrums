#!/usr/bin/env node
/* gamut-sweep — prove, against the RUNNING app, that no colour is left for the engine
 * to gamut-map.
 *
 * The static checks (tokens-gamut.test.ts, color-mix-audit.mjs) only see colours we
 * author. This sees every colour that actually reaches the screen — including ones from
 * third-party CSS (@xyflow/svelte, bits-ui) and anything computed at runtime — by walking
 * the live DOM and reading resolved computed styles.
 *
 * It runs each view twice, with Chrome's `color-gamut` media feature emulated to `p3` and
 * to `srgb`. That is the whole defect in miniature: `srgb` is what a narrow-gamut display
 * gets, `p3` is the reference. If a colour is inside its gamut under both, no engine has a
 * mapping decision to make — which is what makes WebKit and Chromium agree.
 *
 * Screenshots of both renditions land in .ui-shots/gamut-<view>-<gamut>.png so the two can
 * be compared by eye as well.
 *
 * Usage: node apps/web/scripts/gamut-sweep.mjs [--base http://localhost:5173]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { converter, parse } from 'culori';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const OUT_DIR = join(repoRoot, '.ui-shots');

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};
const BASE = argOf('--base', process.env.UI_SHOT_BASE ?? 'http://localhost:5173');
const VIEWS = ['perform', 'objects', 'sections', 'trigger', 'patch', 'monitor'];
const GAMUTS = ['p3', 'srgb'];

const COLOUR_PROPS = [
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  'column-rule-color',
  'fill',
  'stroke',
  'box-shadow',
  'background-image',
  'text-shadow',
];

const toRgb = converter('rgb');
const toP3 = converter('p3');

/** Every colour-looking token inside a computed value (a box-shadow holds several). */
function coloursIn(value) {
  const out = [];
  // Functional colours (may nest, e.g. color-mix) plus hex.
  const re = /\b(?:oklch|oklab|lch|lab|color|rgba?|hsla?|hwb|color-mix)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-fA-F]{3,8}\b/g;
  for (const m of value.matchAll(re)) out.push(m[0]);
  return out;
}

/** How far outside [0,1] the worst channel sits, or null if we can't parse it. */
function excursion(literal, gamut) {
  const c = parse(literal);
  if (!c) return null;
  const v = gamut === 'p3' ? toP3(c) : toRgb(c);
  if (v == null || [v.r, v.g, v.b].some((x) => typeof x !== 'number' || Number.isNaN(x))) return null;
  if ((c.alpha ?? 1) === 0) return 0; // fully transparent — never painted
  return Math.max(0, ...[v.r, v.g, v.b].map((x) => Math.max(-x, x - 1)));
}

/** Collect (selector, property, value) for every painted colour in the document. */
const COLLECT = (props) => {
  const seen = new Set();
  const out = [];
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? `.${cls}` : '');
  };
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      if (!v || v === 'none' || v === 'normal') continue;
      const key = `${p}|${v}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ where: describe(el), prop: p, value: v });
    }
  }
  return out;
};

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const findings = [];
  const accentResolved = [];
  let checked = 0;
  let unparsed = 0;

  for (const gamut of GAMUTS) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'color-gamut', value: gamut }] });

    for (const view of VIEWS) {
      await page.goto(`${BASE}/?view=${view}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);

      // Sanity: the emulation must actually be taking effect, or this whole sweep is
      // measuring the same rendition twice and proving nothing.
      const matched = await page.evaluate(() => matchMedia('(color-gamut: p3)').matches);
      if (matched !== (gamut === 'p3')) {
        throw new Error(`color-gamut emulation not applied: asked for ${gamut}, page reports p3=${matched}`);
      }

      for (const { where, prop, value } of await page.evaluate(COLLECT, COLOUR_PROPS)) {
        for (const literal of coloursIn(value)) {
          const ex = excursion(literal, gamut);
          if (ex === null) {
            unparsed++;
            continue;
          }
          checked++;
          if (ex > 0.001) findings.push({ gamut, view, where, prop, literal, excursion: ex });
        }
      }
      await page.screenshot({ path: join(OUT_DIR, `gamut-${view}-${gamut}.png`) });
    }

    /* Accent-preview cascade, in the real engine. `:root` and `[data-accent='violet']`
       tie on specificity, so a generated `:root` fallback placed later in the file
       would quietly win and drag a theme onto the default accent's hue. Setting the
       attribute is how the styleguide previews these, so check what the browser
       actually resolves rather than trusting the generator's bookkeeping. */
    for (const accent of ['violet', 'amber', 'lime']) {
      const resolved = await page.evaluate((a) => {
        const root = document.documentElement;
        const previous = root.dataset.accent;
        root.dataset.accent = a;
        const cs = getComputedStyle(root);
        const out = {};
        for (const t of ['--accent', '--accent-bright', '--accent-ring', '--border-accent']) {
          out[t] = cs.getPropertyValue(t).trim();
        }
        if (previous === undefined) delete root.dataset.accent;
        else root.dataset.accent = previous;
        return out;
      }, accent);

      for (const [token, literal] of Object.entries(resolved)) {
        if (!literal) continue;
        accentResolved.push({ gamut, accent, token, literal });
        const ex = excursion(literal, gamut);
        if (ex !== null && ex > 0.001) {
          findings.push({ gamut, view: `accent:${accent}`, where: ':root', prop: token, literal, excursion: ex });
        }
      }
    }
    await context.close();
  }
  await browser.close();

  /* The sRGB rendition may lose chroma; it must never change hue. A hue shift means the
     wrong declaration won the cascade, not that a colour was gamut-mapped. */
  const toOklch = converter('oklch');
  const byKey = new Map();
  for (const r of accentResolved) byKey.set(`${r.gamut}|${r.accent}|${r.token}`, r.literal);
  for (const { accent, token } of accentResolved.filter((r) => r.gamut === 'p3')) {
    const ref = parse(byKey.get(`p3|${accent}|${token}`));
    const fb = parse(byKey.get(`srgb|${accent}|${token}`) ?? '');
    if (!ref || !fb) continue;
    const a = toOklch(ref);
    const b = toOklch(fb);
    const dh = Math.abs(((((a.h ?? 0) - (b.h ?? 0)) % 360) + 540) % 360 - 180);
    if (dh > 0.5) {
      findings.push({
        gamut: 'srgb',
        view: `accent:${accent}`,
        where: 'cascade',
        prop: token,
        literal: `${byKey.get(`srgb|${accent}|${token}`)} (P3 rendition is ${byKey.get(`p3|${accent}|${token}`)} — hue moved ${dh.toFixed(1)}°)`,
        excursion: dh,
      });
    }
  }

  console.log(
    `\naccent-preview cascade — ${accentResolved.length / 2} token(s) × p3/srgb resolved in real Chrome`,
  );
  console.log(`\ngamut sweep — ${checked} computed colour value(s) across ${VIEWS.length} views × ${GAMUTS.join('/')}`);
  if (unparsed) console.log(`  ${unparsed} value(s) not parseable as a colour (skipped)`);
  const worst = new Map();
  for (const f of findings) {
    const key = `${f.gamut}|${f.literal}`;
    if (!worst.has(key) || worst.get(key).excursion < f.excursion) worst.set(key, f);
  }
  for (const f of worst.values()) {
    console.log(`  ✗ [${f.gamut}] +${f.excursion.toFixed(4)} outside gamut  ${f.view} ${f.where} {${f.prop}}\n      ${f.literal}`);
  }
  console.log(
    findings.length
      ? `\n✗ ${worst.size} distinct colour(s) would be gamut-mapped by the engine\n`
      : '\n✓ every painted colour is inside the display gamut — nothing left for the engine to map\n',
  );
  process.exit(findings.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
