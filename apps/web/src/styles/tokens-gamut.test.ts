/* Gamut parity for the colour tokens.
 *
 * The rule this enforces: a colour must never be left for the engine to gamut-map,
 * because WKWebView (the desktop shell) and Chromium (where we develop) map differently
 * and the app then looks like two different apps. Every way a colour can reach the screen
 * gets checked here — the authored tokens, the generated fallbacks, the color-mix() call
 * sites, and the tints computed at runtime — so a colour can't drift in through one path
 * while the others stay honest.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { converter, parse } from 'culori';
import {
  TOKENS_PATH,
  applyRegion,
  computeRenditions,
  readAuthoredBlocks,
  renderRegion,
} from '../../scripts/gamut-tokens.mjs';
import { auditColorMixes } from '../../scripts/color-mix-audit.mjs';
import { gamutSafeOklch, inGamut, maxChroma } from '../lib/ui/oklch-gamut';

const css = readFileSync(TOKENS_PATH, 'utf8');
const toRgb = converter('rgb');
const toP3 = converter('p3');
const toOklch = converter('oklch');

/** Parse a CSS colour into OKLCH, failing loudly rather than silently yielding undefined. */
function asOklch(literal: string) {
  const c = parse(literal);
  if (!c) throw new Error(`unparseable colour: ${literal}`);
  return toOklch(c);
}

/** How far outside [0,1] the worst channel sits in the given gamut. */
function excursion(literal: string, gamut: 'rgb' | 'p3'): number {
  const src = asOklch(literal);
  const c = gamut === 'p3' ? toP3(src) : toRgb(src);
  return Math.max(0, ...[c.r, c.g, c.b].map((v: number) => Math.max(-v, v - 1)));
}

const literalsIn = (value: string): string[] => value.match(/oklch\([^)]*\)/g) ?? [];

/** `selector → Set<token name>` for one of the generated rendition maps. */
function names(map: Map<string, { name: string }[]>): Set<string> {
  const out = new Set<string>();
  for (const [selector, decls] of map) for (const d of decls) out.add(`${selector} ${d.name}`);
  return out;
}

describe('tokens.css gamut renditions', () => {
  it('is current — regenerate with `pnpm --filter @ledrums/web gamut-tokens`', () => {
    expect(applyRegion(css, renderRegion(computeRenditions(css)))).toBe(css);
  });

  it('covers exactly the tokens that are out of gamut — no more, no less', () => {
    const { srgb, p3 } = computeRenditions(css);

    // Derive the expected set independently of the generator's own bookkeeping.
    const expectedSrgb = new Set<string>();
    const expectedP3 = new Set<string>();
    for (const { selector, declarations } of readAuthoredBlocks(css)) {
      for (const { name, value } of declarations) {
        for (const lit of literalsIn(value)) {
          if (excursion(lit, 'rgb') > 0) expectedSrgb.add(`${selector} ${name}`);
          if (excursion(lit, 'p3') > 0) expectedP3.add(`${selector} ${name}`);
        }
      }
    }
    expect(names(srgb)).toEqual(expectedSrgb);
    expect(names(p3)).toEqual(expectedP3);
    // A token needing a P3 override must need an sRGB one too — P3 encloses sRGB.
    for (const key of expectedP3) expect(expectedSrgb).toContain(key);
  });

  it('emits fallbacks that are inside their destination gamut', () => {
    const { srgb, p3 } = computeRenditions(css);
    for (const [gamut, map] of [
      ['rgb', srgb],
      ['p3', p3],
    ] as const) {
      for (const [, decls] of map) {
        for (const { name, value } of decls) {
          for (const lit of literalsIn(value)) {
            expect(`${name} ${lit} ${excursion(lit, gamut)}`).toBe(`${name} ${lit} 0`);
          }
        }
      }
    }
  });

  it('preserves lightness, hue and alpha — only chroma is reduced', () => {
    for (const [, decls] of computeRenditions(css).srgb) {
      for (const { name, value } of decls) {
        for (const lit of literalsIn(value)) {
          const mapped = asOklch(lit);
          // Find the authored literal this one was derived from: same L and H.
          const source = readAuthoredBlocks(css)
            .flatMap((b: { declarations: { name: string; value: string }[] }) => b.declarations)
            .filter((d) => d.name === name)
            .flatMap((d) => literalsIn(d.value))
            .map(asOklch)
            .find((c) => Math.abs(c.l - mapped.l) < 1e-3 && Math.abs((c.h ?? 0) - (mapped.h ?? 0)) < 0.5);
          expect(source, `no authored source found for ${name}: ${lit}`).toBeTruthy();
          expect(mapped.alpha ?? 1).toBeCloseTo(source!.alpha ?? 1, 4);
          expect(mapped.c).toBeLessThanOrEqual(source!.c + 1e-9);
        }
      }
    }
  });
});

describe('color-mix() call sites', () => {
  const audit = auditColorMixes();

  it('checks a meaningful number of mixes (guards against the scan silently finding nothing)', () => {
    expect(audit.examined).toBeGreaterThan(50);
  });

  it('never mixes out of the sRGB gamut', () => {
    // Two in-gamut endpoints can still blend outside the gamut: an oklch mix takes the
    // shorter hue arc, and the interpolated chroma at the midpoint hue can exceed what
    // sRGB can show. Resolve the mix into a token instead of leaving it to the engine.
    expect(audit.outOfGamut).toEqual([]);
  });

  it('has only the known runtime-set endpoints it cannot check statically', () => {
    // --tint and --rc are written from JS. If this list grows, the new one needs either a
    // static endpoint or a runtime clamp (see lib/ui/oklch-gamut.ts) — not a silent skip.
    expect(audit.unresolved).toEqual(['--rc', '--tint']);
  });
});

describe('gamutSafeOklch (runtime tints)', () => {
  // The exact ramp LayersDock paints per voice: hue comes from the show, so it sweeps
  // the whole wheel — including regions where sRGB runs out well before the ramp does.
  const ramp = () => {
    const out: [number, number, number][] = [];
    for (let i = 0; i <= 20; i++) {
      const L = i / 20;
      for (let hue = 0; hue < 360; hue += 5) {
        out.push([0.26 + 0.52 * L, 0.04 + 0.16 * L, hue]);
        out.push([0.75, 0.15, hue]);
      }
    }
    return out;
  };

  it('has something to clamp — the raw ramp really does leave sRGB', () => {
    const worst = Math.max(...ramp().map(([l, c, h]) => excursion(`oklch(${l} ${c} ${h})`, 'rgb')));
    expect(worst).toBeGreaterThan(0.1);
  });

  it('returns an in-gamut colour for every point on the ramp', () => {
    for (const gamut of ['srgb', 'p3'] as const) {
      for (const [l, c, h] of ramp()) {
        const out = gamutSafeOklch(l, c, h, undefined, gamut);
        expect(excursion(out, gamut === 'p3' ? 'p3' : 'rgb')).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('holds lightness and hue, and never raises chroma', () => {
    for (const [l, c, h] of ramp()) {
      const parsed = asOklch(gamutSafeOklch(l, c, h, undefined, 'srgb'));
      expect(parsed.l).toBeCloseTo(l, 3);
      expect(parsed.h ?? 0).toBeCloseTo(h, 1);
      expect(parsed.c).toBeLessThanOrEqual(c + 1e-9);
    }
  });

  it('carries alpha through', () => {
    expect(gamutSafeOklch(0.5, 0.05, 200, 0.42, 'srgb')).toContain('/ 0.42');
    expect(gamutSafeOklch(0.5, 0.05, 200, 1, 'srgb')).not.toContain('/');
  });

  it('agrees with its own in-gamut predicate at the boundary it finds', () => {
    for (const gamut of ['srgb', 'p3'] as const) {
      for (const h of [0, 60, 128, 200, 256, 300]) {
        const max = maxChroma(0.7, h, gamut);
        expect(inGamut(0.7, max, h, gamut)).toBe(true);
        expect(inGamut(0.7, max + 0.01, h, gamut)).toBe(false);
      }
    }
  });

  it('grants P3 displays more chroma than sRGB ones', () => {
    // If these ever matched, the P3 path would be silently doing nothing.
    expect(maxChroma(0.7, 25, 'p3')).toBeGreaterThan(maxChroma(0.7, 25, 'srgb'));
  });
});
