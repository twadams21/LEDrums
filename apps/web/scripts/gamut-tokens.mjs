/* Gamut-safe colour tokens — generate (or verify) the explicit sRGB / P3 renditions.

   Why: `oklch()` values that fall outside the target display's gamut are gamut-mapped
   by the engine, and WebKit (the desktop shell's WKWebView) and Chromium (where we
   develop) map differently. Same CSS, two looks. The fix is to author every rendition
   explicitly so no engine has to guess.

   Shape of the output — `:root` and the `[data-accent]` blocks stay the hand-authored
   reference (the design intent, in OKLCH). This script appends ONE generated region
   holding only the tokens that need a different rendition somewhere:

     @media not all and (color-gamut: p3)  → sRGB-gamut-mapped fallback
     @media (color-gamut: p3)              → P3-gamut-mapped, only for tokens that
                                             exceed P3 as well as sRGB

   Mapping is CSS Color 4 style: hold L and H, reduce C until the colour is inside the
   destination gamut (culori's `clampChroma`), never naive RGB channel clipping — which
   shifts hue. Alpha is carried through untouched.

   Usage:
     node apps/web/scripts/gamut-tokens.mjs           # rewrite the generated region
     node apps/web/scripts/gamut-tokens.mjs --check   # verify it is current (CI / tests)
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse, converter, clampChroma, inGamut } from 'culori';

const here = dirname(fileURLToPath(import.meta.url));
export const TOKENS_PATH = join(here, '../src/styles/tokens.css');

const BEGIN = '/* === BEGIN generated gamut renditions — do not edit by hand ============== */';
const END = '/* === END generated gamut renditions ====================================== */';

/* A fallback sits at least this far inside its destination gamut, in channel units.
   Engines' OKLab→RGB matrices agree to ~1e-6, so this is ample headroom against a
   value landing on the wrong side of the boundary and being clipped after all. */
const SAFETY = 0.001;

const toRgb = converter('rgb');
const toP3 = converter('p3');
const GAMUTS = {
  rgb: { convert: toRgb, inside: inGamut('rgb') },
  p3: { convert: toP3, inside: inGamut('p3') },
};

/** How far outside [0,1] the worst channel sits once converted into `gamut`. */
function excursion(color, gamut) {
  const c = GAMUTS[gamut].convert(color);
  return Math.max(0, ...[c.r, c.g, c.b].map((v) => Math.max(-v, v - 1)));
}

const round = (n, dp) => Number(n.toFixed(dp));

function formatOklch({ l, c, h, alpha }) {
  const base = `oklch(${round(l, 4)} ${round(c, 4)} ${round(h ?? 0, 2)}`;
  return alpha === undefined || alpha === 1 ? `${base})` : `${base} / ${round(alpha, 4)})`;
}

/**
 * Map one OKLCH colour into `gamut` by reducing chroma (L and H held), leaving at
 * least SAFETY headroom so the result survives rounding on either engine.
 */
export function mapIntoGamut(color, gamut) {
  if (excursion(color, gamut) === 0) return { ...color };
  let mapped = clampChroma({ ...color, mode: 'oklch' }, 'oklch', gamut);
  // clampChroma lands ON the boundary; shave chroma until we are safely inside.
  for (let i = 0; i < 200 && excursionAfterRounding(mapped, gamut) > -SAFETY; i++) {
    mapped = { ...mapped, c: Math.max(0, mapped.c - 0.0005) };
  }
  return mapped;
}

/** Excursion of the value *as it will be written* (i.e. after rounding to 4dp). */
function excursionAfterRounding(color, gamut) {
  const written = parse(formatOklch(color));
  const c = GAMUTS[gamut].convert(written);
  // negative = inside with headroom; we want <= -SAFETY
  return Math.max(...[c.r, c.g, c.b].map((v) => Math.max(-v, v - 1)));
}

/**
 * Split the authored part of tokens.css into `{ selector, declarations }` groups.
 * Only top-level selector blocks are read; `@media` blocks (reduced-motion, and the
 * generated region itself) are skipped — nothing in them authors a colour.
 */
export function readAuthoredBlocks(css) {
  // Comments are stripped first so a block's leading comment cannot be swallowed
  // into its selector. Nothing we read lives inside a comment.
  const authored = css.split(BEGIN)[0].replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  // Selector blocks at column 0 that are not at-rules.
  for (const m of authored.matchAll(/^([^@\s][^{}]*?)\{([^{}]*)\}/gm)) {
    const selector = m[1].trim();
    const declarations = [];
    for (const d of m[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      if (d[2].includes('oklch(')) declarations.push({ name: d[1], value: d[2].trim() });
    }
    if (declarations.length) blocks.push({ selector, declarations });
  }
  return blocks;
}

/**
 * Rewrite every `oklch()` inside a declaration value into `gamut`.
 * Returns null when nothing in the value was out of gamut.
 */
function renditionFor(value, gamut) {
  let changed = false;
  const out = value.replace(/oklch\([^)]*\)/g, (lit) => {
    const color = parse(lit);
    if (!color) throw new Error(`unparseable colour: ${lit}`);
    if (excursion(color, gamut) === 0) return lit;
    changed = true;
    return formatOklch(mapIntoGamut(color, gamut));
  });
  return changed ? out : null;
}

/**
 * The full set of renditions the file needs, derived from the authored blocks.
 * `srgb` and `p3` each map selector → [{ name, value }].
 */
export function computeRenditions(css) {
  const srgb = new Map();
  const p3 = new Map();
  for (const { selector, declarations } of readAuthoredBlocks(css)) {
    for (const { name, value } of declarations) {
      const asSrgb = renditionFor(value, 'rgb');
      if (asSrgb) {
        if (!srgb.has(selector)) srgb.set(selector, []);
        srgb.get(selector).push({ name, value: asSrgb });
      }
      const asP3 = renditionFor(value, 'p3');
      if (asP3) {
        if (!p3.has(selector)) p3.set(selector, []);
        p3.get(selector).push({ name, value: asP3 });
      }
    }
  }
  const blocks = readAuthoredBlocks(css);
  restateOverriddenTokens(srgb, blocks, 'rgb');
  restateOverriddenTokens(p3, blocks, 'p3');
  return { srgb, p3 };
}

/**
 * Stop a generated `:root` fallback from silently overriding a themed block.
 *
 * `:root` and `[data-accent='violet']` both score (0,1,0) — a pseudo-class against an
 * attribute selector — so the cascade falls through to source order, and the generated
 * region sits at the END of the file. A `:root` fallback for a token that a
 * `[data-accent]` block also authors would therefore win everywhere, dragging that
 * theme's token to the default accent's hue on narrow-gamut displays while wide-gamut
 * ones kept the authored one. The two renditions would then differ in HUE, which is
 * worse than the gamut mapping this file exists to remove.
 *
 * So: wherever `:root` gets a fallback for a token, every other block that authors the
 * same token restates it — mapped if it needs mapping, verbatim if it was already fine.
 * Restating a value that needed no change is redundant but harmless, and it is the only
 * thing that keeps the block's own value winning.
 */
function restateOverriddenTokens(map, blocks, gamut) {
  const shadowed = new Set((map.get(':root') ?? []).map((d) => d.name));
  if (!shadowed.size) return;
  for (const { selector, declarations } of blocks) {
    if (selector === ':root') continue;
    for (const { name, value } of declarations) {
      if (!shadowed.has(name)) continue;
      const existing = map.get(selector) ?? [];
      if (existing.some((d) => d.name === name)) continue;
      if (!map.has(selector)) map.set(selector, existing);
      map.get(selector).push({ name, value: renditionFor(value, gamut) ?? value });
    }
  }
}

function renderBlocks(map) {
  const out = [];
  for (const [selector, decls] of map) {
    out.push(`  ${selector} {`);
    for (const { name, value } of decls) out.push(`    ${name}: ${value};`);
    out.push('  }');
  }
  return out.join('\n');
}

export function renderRegion({ srgb, p3 }) {
  const lines = [BEGIN];
  lines.push(
    '/* Written by `pnpm --filter @ledrums/web gamut-tokens`; checked by tokens-gamut.test.ts.',
    '   The authored values above are the reference (P3) rendition. Only tokens whose',
    '   authored value falls outside a destination gamut appear below — everything else',
    '   renders identically on both engines and needs no second rendition.',
    '',
    '   Chroma is reduced (L and H held, CSS Color 4 style) rather than RGB-clipped, so a',
    '   fallback keeps its hue and brightness and only loses the saturation it could not',
    '   have shown anyway.',
    '',
    "   Note the negative media query: an engine that doesn't know `color-gamut` at all",
    '   evaluates it false and keeps the authored value — i.e. exactly the behaviour we',
    '   have today, never a regression. */',
  );
  if (srgb.size) {
    lines.push('', '@media not all and (color-gamut: p3) {', renderBlocks(srgb), '}');
  }
  if (p3.size) {
    lines.push(
      '',
      '/* Out of P3 as well — mapped into P3 so wide-gamut displays also get an explicit value. */',
      '@media (color-gamut: p3) {',
      renderBlocks(p3),
      '}',
    );
  }
  lines.push('', END);
  return lines.join('\n');
}

export function applyRegion(css, region) {
  const start = css.indexOf(BEGIN);
  if (start === -1) return `${css.trimEnd()}\n\n${region}\n`;
  const end = css.indexOf(END, start);
  if (end === -1) throw new Error('tokens.css has a BEGIN marker with no END marker');
  return `${css.slice(0, start)}${region}${css.slice(end + END.length)}`;
}

// ---------------------------------------------------------------------------

function main() {
  const check = process.argv.includes('--check');
  const css = readFileSync(TOKENS_PATH, 'utf8');
  const renditions = computeRenditions(css);
  const next = applyRegion(css, renderRegion(renditions));

  const count = (m) => [...m.values()].reduce((n, d) => n + d.length, 0);
  const summary = `${count(renditions.srgb)} sRGB fallback(s), ${count(renditions.p3)} P3 override(s)`;

  if (check) {
    if (next !== css) {
      console.error(`✗ tokens.css gamut region is stale — run \`pnpm --filter @ledrums/web gamut-tokens\``);
      process.exit(1);
    }
    console.log(`✓ tokens.css gamut renditions current — ${summary}`);
    return;
  }
  if (next === css) {
    console.log(`✓ tokens.css already current — ${summary}`);
    return;
  }
  writeFileSync(TOKENS_PATH, next);
  console.log(`✓ tokens.css gamut region written — ${summary}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
