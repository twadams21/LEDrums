/* Tests for the cross-engine colour tooling.
 *
 * These scripts exist to decide whether a reported colour bug is real, so a quiet defect
 * in them is worse than no tool at all: a harness that compares nothing, or that reads a
 * screenshot's pixels wrongly, produces a confident answer to a question it never asked.
 * Everything checkable without launching a browser is checked here.
 */
import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { decodePng, meanPixel, pixelAt } from '../../scripts/png-pixels.mjs';
import { buildPage, CASES, KINDS, maxDelta, pinnedRenditions, TOKENS_PATH } from '../../scripts/engine-color-parity.mjs';
import { compare, paintedRgb } from '../../scripts/engine-color-diff.mjs';

/* ---- a real PNG, built by hand, so the decoder is tested against the format ---------- */

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/**
 * An 8-bit RGBA PNG of `pixels`, each scanline written with the given filter type, so the
 * decoder's unfiltering is exercised rather than just its container parsing.
 */
function makePng(pixels: number[][][], filters: number[]): Buffer {
  const height = pixels.length;
  const width = pixels[0]!.length;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));

  for (let y = 0; y < height; y++) {
    const filter = filters[y]!;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < 4; ch++) {
        const i = x * 4 + ch;
        const value = pixels[y]![x]![ch]!;
        const a = i >= 4 ? pixels[y]![x - 1]![ch]! : 0;
        const b = y > 0 ? pixels[y - 1]![x]![ch]! : 0;
        const c = y > 0 && i >= 4 ? pixels[y - 1]![x - 1]![ch]! : 0;
        let encoded = value;
        if (filter === 1) encoded = value - a;
        else if (filter === 2) encoded = value - b;
        else if (filter === 3) encoded = value - ((a + b) >> 1);
        else if (filter === 4) {
          const p = a + b - c;
          const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
          encoded = value - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        raw[y * (stride + 1) + 1 + i] = encoded & 0xff;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const grid = (w: number, h: number, f: (x: number, y: number) => number[]) =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => f(x, y)));

describe('decodePng', () => {
  const pixels = grid(6, 5, (x, y) => [x * 40, y * 50, (x * y * 7) % 256, 255]);

  it('round-trips pixels through every scanline filter', () => {
    // One image per filter type, plus a mixed one — a decoder that only ever sees filter 0
    // (what a flat-colour screenshot compresses to) would pass a weaker test and still be wrong.
    for (const filters of [[0, 0, 0, 0, 0], [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [3, 3, 3, 3, 3], [4, 4, 4, 4, 4], [0, 1, 2, 3, 4]]) {
      const img = decodePng(makePng(pixels, filters));
      expect(img.width).toBe(6);
      expect(img.height).toBe(5);
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 6; x++) {
          expect(`${filters}@${x},${y} ${pixelAt(img, x, y)}`).toBe(`${filters}@${x},${y} ${pixels[y]![x]!.slice(0, 3)}`);
        }
      }
    }
  });

  it('rejects anything that is not a PNG it can read honestly', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow(/not a PNG/);
    const interlaced = makePng(pixels, [0, 0, 0, 0, 0]);
    interlaced[8 + 4 + 4 + 12] = 1; // signature + chunk length + chunk type, then IHDR's interlace byte
    expect(() => decodePng(interlaced)).toThrow(/interlaced/);
  });
});

describe('pixel sampling', () => {
  const img = decodePng(makePng(grid(4, 4, (x, y) => [x === 0 || y === 0 ? 0 : 200, 100, 50, 255]), [0, 0, 0, 0]));

  it('refuses to sample outside the image instead of clamping', () => {
    // A clamped sample is silently the wrong pixel, which is exactly how a parity harness
    // reports "identical" for two swatches it never actually measured.
    expect(() => pixelAt(img, 4, 0)).toThrow(/outside/);
    expect(() => pixelAt(img, -1, 0)).toThrow(/outside/);
  });

  it('averages a box, so one antialiased edge pixel cannot decide a verdict', () => {
    expect(meanPixel(img, 1, 1, 3, 3)).toEqual([200, 100, 50]);
    // The box including the dark border row/column must NOT read as the flat fill.
    expect(meanPixel(img, 0, 0, 4, 4)[0]).toBeLessThan(200);
  });
});

describe('maxDelta', () => {
  it('reports the worst channel, not the average', () => {
    expect(maxDelta([0, 0, 0], [0, 0, 9])).toBe(9);
    expect(maxDelta([10, 20, 30], [10, 20, 30])).toBe(0);
  });
});

describe('pinnedRenditions', () => {
  const css = readFileSync(TOKENS_PATH, 'utf8');

  it('lifts the generated sRGB block out of its media query', () => {
    const pinned = pinnedRenditions(css);
    expect(pinned).not.toContain('@media');
    expect(pinned).toContain('--live-bright');
    // Specificity must beat the authored `:root`, or pinning silently does nothing and
    // the control looks like it held when it never applied.
    expect(pinned).toContain(':root:root');
  });

  it('pins every token the generator emitted a fallback for', () => {
    const block = css.split('@media not all and (color-gamut: p3) {')[1]!.split('\n}\n')[0]!;
    const emitted = [...block.matchAll(/(--[\w-]+):/g)].map((m) => m[1]!);
    expect(emitted.length).toBeGreaterThan(0);
    const pinned = pinnedRenditions(css);
    for (const name of new Set(emitted)) expect(pinned).toContain(`${name}:`);
  });

  it('throws rather than pinning nothing if the generated block ever moves', () => {
    expect(() => pinnedRenditions(':root { --a: red; }')).toThrow(/no generated sRGB rendition block/);
    expect(() => pinnedRenditions('@media not all and (color-gamut: p3) {\n  :root { --a: red; }')).toThrow(/unterminated/);
  });
});

describe('buildPage', () => {
  const css = readFileSync(TOKENS_PATH, 'utf8');

  it('renders one swatch per kind for every case', () => {
    const html = buildPage(CASES, css);
    for (const kind of KINDS) {
      expect((html.match(new RegExp(`data-kind="${kind}"`, 'g')) ?? []).length).toBe(CASES.length);
    }
    expect(html).toContain('--accent');
  });

  it('includes the pinned block only when pinning is asked for', () => {
    expect(buildPage(CASES, css, { pin: true })).toContain(':root:root');
    expect(buildPage(CASES, css, { pin: false })).not.toContain(':root:root');
  });

  it('gives every case a base control alongside the two forms it compares', () => {
    // Without a control, a divergence in the token itself reads as a divergence in the
    // expression — the mistake that nearly cost a 69-site rewrite.
    for (const c of CASES) {
      expect(c.base, c.name).toBeTruthy();
      expect(c.old, c.name).toContain('color-mix(');
      expect(c.new, c.name).not.toContain('color-mix(');
    }
  });
});

describe('paintedRgb', () => {
  it('applies alpha, because that is what reaches the screen', () => {
    const [r, g, b] = paintedRgb('rgb(255 0 0 / 50%)')!;
    expect(r).toBeCloseTo(127.5, 1);
    expect([g, b]).toEqual([0, 0]);
  });

  it('returns null for something it cannot parse, rather than a plausible zero', () => {
    expect(paintedRgb('not-a-colour')).toBeNull();
  });
});

describe('compare', () => {
  const el = (tag: string, cls: string, props: Record<string, string>) => ({ tag, cls, props });
  const view = (out: ReturnType<typeof el>[]) => ({ perform: { out, p3: false } });

  it('reports a genuine divergence with its element and delta', () => {
    const { diffs, compared, skipped } = compare(
      view([el('DIV', 'card', { color: 'oklch(0.7 0.23 25)' })]),
      view([el('DIV', 'card', { color: 'oklch(0.7 0.19 25)' })]),
      ['perform'],
    );
    expect(compared).toBe(1);
    expect(skipped).toBe(0);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.delta).toBeGreaterThan(1);
    expect(diffs[0]!.where[0]).toBe('DIV.card');
  });

  it('skips elements whose class differs — that is app state, not colour', () => {
    // The failure this prevents: a status pill reading "connecting" in one engine and
    // "offline" in the other, reported as a 129/255 colour divergence.
    const { diffs, compared, skipped } = compare(
      view([el('SPAN', 'dot dot-muted', { color: 'oklch(0.77 0.009 256)' })]),
      view([el('SPAN', 'dot dot-warn', { color: 'oklch(0.81 0.15 80)' })]),
      ['perform'],
    );
    expect(diffs).toEqual([]);
    expect(compared).toBe(0);
    expect(skipped).toBe(1);
  });

  it('ignores differences below the rounding tolerance', () => {
    const { diffs } = compare(
      view([el('DIV', 'a', { color: 'rgb(100 100 100)' })]),
      view([el('DIV', 'a', { color: 'rgb(100 100 101)' })]),
      ['perform'],
    );
    expect(diffs).toEqual([]);
  });

  it('groups repeats of one divergence and counts them', () => {
    const many = Array.from({ length: 5 }, () => el('DIV', 'x', { color: 'oklch(0.7 0.23 25)' }));
    const other = Array.from({ length: 5 }, () => el('DIV', 'x', { color: 'oklch(0.7 0.19 25)' }));
    const { diffs } = compare(view(many), view(other), ['perform']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.count).toBe(5);
  });
});
