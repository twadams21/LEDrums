/* Verify token contrast (WCAG 2.1).
 *
 * Checked against the sRGB rendition, not the authored one. That is the rendition that
 * actually reaches a narrow-gamut display — and it is the darker/duller of the two, so
 * it is where contrast is worst. Gating on the authored wide-gamut value would pass a
 * palette that fails on the machines most likely to be running it.
 *
 * Usage: node apps/web/scripts/contrast-check.mjs
 */
import { readFileSync } from 'node:fs';
import { converter, parse } from 'culori';
import { TOKENS_PATH, computeRenditions } from './gamut-tokens.mjs';

const css = readFileSync(TOKENS_PATH, 'utf8');
const toRgb = converter('rgb');

/* --- token table, as an sRGB display resolves it -------------------------- */
const tokens = new Map();
for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+):\s*(oklch\([^)]*\))/g)) {
  if (!tokens.has(m[1])) tokens.set(m[1], m[2]);
}
for (const { name, value } of computeRenditions(css).srgb.get(':root') ?? []) {
  const lit = value.match(/oklch\([^)]*\)/);
  if (lit) tokens.set(name, lit[0]);
}

/* --- WCAG relative luminance (needs LINEARISED sRGB, not the encoded value) */
const linearise = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function luminance(literal) {
  const c = toRgb(parse(literal));
  const [r, g, b] = [c.r, c.g, c.b].map((v) => linearise(Math.min(1, Math.max(0, v))));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

const get = (name) => tokens.get(`--${name}`);

const surfaces = ['bg-perform', 'bg', 'surface', 'surface-2', 'surface-3', 'surface-inset'];
const inks = ['ink', 'text', 'text-muted', 'text-faint', 'text-disabled'];

const AA_BODY = 4.5;
const AA_LARGE = 3.0;
let fails = 0;
const pad = (s, n) => String(s).padEnd(n);

console.log('\nWCAG contrast — sRGB rendition, ink ramp vs surfaces (AA body 4.5, large 3.0)\n');
console.log(pad('ink \\ surface', 14) + surfaces.map((s) => pad(s, 13)).join(''));
for (const ink of inks) {
  if (!get(ink)) continue;
  let row = pad(ink, 14);
  for (const s of surfaces) {
    const r = contrast(get(ink), get(s));
    const body = r >= AA_BODY;
    const large = r >= AA_LARGE;
    // Primary text must pass body; faint must pass large; disabled is
    // WCAG-exempt (inactive control) so it's report-only.
    const mustBody = ink === 'ink' || ink === 'text' || ink === 'text-muted';
    const exempt = ink === 'text-disabled';
    const ok = exempt ? true : mustBody ? body : large;
    if (!ok) fails++;
    const tag = body ? 'AA' : large ? 'AA+' : exempt ? '·' : '✗';
    row += pad(`${r.toFixed(2)} ${tag}`, 13);
  }
  console.log(row);
}

// state / accent vs their typical surfaces (text use)
console.log('\nState & accent text vs --surface / --bg-perform\n');
for (const t of [
  'accent',
  'accent-bright',
  'live',
  'live-bright',
  'ok',
  'warn',
  'role-input',
  'role-content',
  'role-effect',
  'role-layer',
  'role-output',
]) {
  if (!get(t)) continue;
  console.log(
    `${pad(t, 14)} surface ${contrast(get(t), get('surface')).toFixed(2)}   perform ${contrast(get(t), get('bg-perform')).toFixed(2)}`,
  );
}

console.log(`\n${fails === 0 ? '✓ all required pairs pass' : `✗ ${fails} required pair(s) below target`}\n`);
process.exit(fails === 0 ? 0 : 1);
