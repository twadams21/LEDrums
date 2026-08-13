/* Minimal PNG reader — enough to sample pixels out of a Playwright screenshot.
 *
 * Screenshots are the only honest measurement of an engine's colour: a computed style
 * is what the engine says it will paint, and the whole class of bug we chase here is an
 * engine painting something other than what the spec says it should. Playwright emits
 * 8-bit non-interlaced PNGs, so that is the only shape supported; anything else throws
 * rather than returning plausible-looking wrong pixels.
 */
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per pixel for the colour types we accept. */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Paeth predictor, per the PNG spec's filter type 4. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * @param {Buffer} buf a PNG file
 * @returns {{ width: number, height: number, channels: number, data: Buffer }}
 *          `data` is row-major, `channels` bytes per pixel, unfiltered.
 */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat = [];

  for (let off = 8; off + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len; // length + type + data + CRC
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      if (body[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const row = data.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : data.subarray((y - 1) * stride, y * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`unknown filter ${filter} on row ${y}`);
      row[i] = v & 0xff;
    }
  }

  return { width, height, channels, data };
}

/** `[r, g, b]` (0–255) at a pixel. Out-of-bounds throws — a silently clamped sample would lie. */
export function pixelAt(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) {
    throw new Error(`sample (${x},${y}) outside ${img.width}x${img.height}`);
  }
  const i = (y * img.width + x) * img.channels;
  if (img.channels <= 2) return [img.data[i], img.data[i], img.data[i]];
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** Mean `[r, g, b]` over a box — averages away the odd antialiased edge pixel. */
export function meanPixel(img, x, y, w, h) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const [pr, pg, pb] = pixelAt(img, x + dx, y + dy);
      r += pr;
      g += pg;
      b += pb;
      n++;
    }
  }
  return [r / n, g / n, b / n];
}
