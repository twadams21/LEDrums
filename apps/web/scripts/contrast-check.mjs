/* Verify token contrast (WCAG 2.1) by converting OKLCH tokens → sRGB → ratio.
   Usage: node apps/web/scripts/contrast-check.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/styles/tokens.css'), 'utf8');

// --- OKLCH → linear sRGB → WCAG luminance ---------------------------------
function oklchToLinearRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
}
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function contrast(fg, bg) {
  const L1 = luminance(oklchToLinearRgb(...fg));
  const L2 = luminance(oklchToLinearRgb(...bg));
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// --- parse `--name: oklch(L C H ...);` (ignores alpha/var aliases) ----------
const tokens = {};
for (const m of css.matchAll(/--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)) {
  const [, name, L, C, H] = m;
  if (!(name in tokens)) tokens[name] = [Number(L), Number(C), Number(H)];
}

const surfaces = ['bg-perform', 'bg', 'surface', 'surface-2', 'surface-3', 'surface-inset'];
const inks = ['ink', 'text', 'text-muted', 'text-faint', 'text-disabled'];

const AA_BODY = 4.5;
const AA_LARGE = 3.0;
let fails = 0;
const pad = (s, n) => String(s).padEnd(n);

console.log('\nWCAG contrast — ink ramp vs surfaces (AA body 4.5, large 3.0)\n');
console.log(pad('ink \\ surface', 14) + surfaces.map((s) => pad(s, 13)).join(''));
for (const ink of inks) {
  if (!tokens[ink]) continue;
  let row = pad(ink, 14);
  for (const s of surfaces) {
    const r = contrast(tokens[ink], tokens[s]);
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
for (const t of ['accent', 'accent-bright', 'live', 'live-bright', 'ok', 'warn', 'role-input', 'role-content', 'role-effect', 'role-layer', 'role-output']) {
  if (!tokens[t]) continue;
  const onSurface = contrast(tokens[t], tokens['surface']);
  const onPerform = contrast(tokens[t], tokens['bg-perform']);
  console.log(`${pad(t, 14)} surface ${onSurface.toFixed(2)}   perform ${onPerform.toFixed(2)}`);
}

console.log(`\n${fails === 0 ? '✓ all required pairs pass' : `✗ ${fails} required pair(s) below target`}\n`);
process.exit(fails === 0 ? 0 : 1);
