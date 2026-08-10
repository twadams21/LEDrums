/* Audit every `color-mix(in oklch|oklab, …)` in the web app for gamut safety.
 *
 * The trap this exists to catch: a mix of two perfectly in-gamut colours can land
 * OUTSIDE the gamut. `color-mix(in oklch, var(--accent) 50%, var(--border))` blends
 * phosphor lime with a blue-grey; the shorter hue arc runs through teal, and the
 * interpolated chroma at that hue exceeds sRGB by 8% of a channel. The engine then
 * gamut-maps the result — WebKit and Chromium differently — which is exactly the
 * defect tokens.css is written to avoid, reintroduced one call site at a time.
 *
 * Mixes are resolved statically against the authored tokens. Endpoints that only
 * exist at runtime (a custom property set from JS) can't be checked here; they are
 * returned as `unresolved` so the caller can assert on the known set rather than
 * silently skipping new ones.
 *
 * Usage: node apps/web/scripts/color-mix-audit.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { parse, converter } from 'culori';
import { computeRenditions } from './gamut-tokens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SRC = join(here, '../src');

const toRgb = converter('rgb');
/** How far outside [0,1] the worst channel sits once converted to sRGB. */
const excursion = (color) => {
  const c = toRgb(color);
  return Math.max(0, ...[c.r, c.g, c.b].map((v) => Math.max(-v, v - 1)));
};

/**
 * Token values as they resolve ON AN SRGB DISPLAY — i.e. the authored `:root` values
 * with the generated sRGB fallbacks applied over them. That is the case worth auditing:
 * custom properties are substituted after the cascade has picked a media block, so a mix
 * over `var(--live-bright)` sees the already-mapped fallback, not the wide-gamut original.
 * On P3 the authored values are used, and those are in-gamut by construction there.
 */
function readTokens() {
  const raw = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
  const css = stripComments(raw);
  const tokens = new Map();
  for (const m of css.matchAll(/(--[\w-]+):\s*(oklch\([^)]*\));/g)) {
    if (!tokens.has(m[1])) tokens.set(m[1], m[2]);
  }
  for (const { name, value } of computeRenditions(raw).srgb.get(':root') ?? []) {
    const lit = value.match(/oklch\([^)]*\)/);
    if (lit) tokens.set(name, lit[0]);
  }
  return tokens;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(svelte|css|ts)$/.test(entry) && !entry.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Every balanced `color-mix(…)` expression in `text`. */
function extractMixes(text) {
  const found = [];
  let i = 0;
  while ((i = text.indexOf('color-mix(', i)) !== -1) {
    let depth = 0;
    let j = i + 'color-mix'.length;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')' && --depth === 0) {
        j++;
        break;
      }
    }
    if (depth !== 0) break; // unbalanced — not our business to diagnose
    found.push(text.slice(i, j));
    i = j;
  }
  return found;
}

/** Top-level comma-separated arguments of a `color-mix(…)` expression. */
function splitArgs(expr) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of expr.slice('color-mix('.length, -1)) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

/** `var(--token) 55%` → `{ weight, color }`, resolving through the token table. */
function resolveEndpoint(text, tokens) {
  let s = text.trim();
  let weight = null;
  const pct = s.match(/\s(\d+(?:\.\d+)?)%$/);
  if (pct) {
    weight = Number(pct[1]) / 100;
    s = s.slice(0, pct.index).trim();
  }
  const v = s.match(/^var\((--[\w-]+)(?:\s*,[^)]*)?\)$/);
  if (v) {
    const authored = tokens.get(v[1]);
    return authored ? { weight, color: parse(authored) } : { weight, unresolved: v[1] };
  }
  const color = parse(s);
  return color ? { weight, color } : { weight, unresolved: s };
}

/** CSS Color 4 mixing: premultiplied alpha, and for oklch the shorter hue arc. */
function mix(a, b, wa, polar) {
  const wb = 1 - wa;
  const aa = a.alpha ?? 1;
  const ab = b.alpha ?? 1;
  const alpha = wa * aa + wb * ab;
  const blend = (x, y) => (alpha === 0 ? 0 : (wa * x * aa + wb * y * ab) / alpha);
  if (!polar) {
    const A = converter('oklab')(a);
    const B = converter('oklab')(b);
    return { mode: 'oklab', l: blend(A.l, B.l), a: blend(A.a, B.a), b: blend(A.b, B.b), alpha };
  }
  const A = converter('oklch')(a);
  const B = converter('oklch')(b);
  const h1 = A.h ?? 0;
  const h2 = h1 + ((((B.h ?? 0) - h1) % 360) + 540) % 360 - 180;
  return { mode: 'oklch', l: blend(A.l, B.l), c: blend(A.c ?? 0, B.c ?? 0), h: blend(h1, h2), alpha };
}

/**
 * @returns {{ outOfGamut: Array, unresolved: string[], examined: number }}
 */
export function auditColorMixes() {
  const tokens = readTokens();
  const outOfGamut = [];
  const unresolved = new Set();
  let examined = 0;

  for (const file of sourceFiles(SRC)) {
    for (const expr of extractMixes(stripComments(readFileSync(file, 'utf8')))) {
      const args = splitArgs(expr);
      const space = args[0].replace(/^in\s+/, '').trim();
      if (space !== 'oklch' && space !== 'oklab') continue; // rectangular sRGB spaces can't leave the gamut
      const A = resolveEndpoint(args[1] ?? '', tokens);
      const B = resolveEndpoint(args[2] ?? '', tokens);
      if (A.unresolved || B.unresolved) {
        unresolved.add(A.unresolved ?? B.unresolved);
        continue;
      }
      examined++;
      const wa = A.weight ?? (B.weight != null ? 1 - B.weight : 0.5);
      const ex = excursion(mix(A.color, B.color, wa, space === 'oklch'));
      if (ex > 0.0005) {
        outOfGamut.push({ file: relative(SRC, file), expr: expr.replace(/\s+/g, ' '), excursion: ex });
      }
    }
  }
  return { outOfGamut, unresolved: [...unresolved].sort(), examined };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { outOfGamut, unresolved, examined } = auditColorMixes();
  console.log(`\ncolor-mix gamut audit — ${examined} statically resolvable mix(es)`);
  if (unresolved.length) console.log(`  endpoints set at runtime (unchecked): ${unresolved.join(', ')}`);
  for (const r of outOfGamut) {
    console.log(`  ✗ +${r.excursion.toFixed(4)} outside sRGB  ${r.file}\n      ${r.expr}`);
  }
  console.log(outOfGamut.length ? `\n✗ ${outOfGamut.length} mix(es) out of gamut\n` : '\n✓ every resolvable mix is in gamut\n');
  process.exit(outOfGamut.length ? 1 : 0);
}
