'use strict';

// Max for Live `.amxd` DEVICE CONTAINER — pure byte work, no Max/Live invocation.
//
// Layout: a flat sequence of chunks, each `4-byte ASCII tag` + `little-endian uint32 byte
// length` + that many payload bytes. Lengths are BYTES, never characters.
//
//   ampf | 4                 | device type fourcc: "aaaa" audio, "mmmm" MIDI, "iiii" instrument
//   meta | 4                 | little-endian uint32, value not agreed across sources (see below)
//   ptch | patcher byte size | patcher JSON as UTF-8, NUL-terminated
//
// Verified against four independent public implementations:
//   1. Ableton/maxdevtools `maxdiff/amxd_textconv.py` (Ableton's own reader) — AUTHORITATIVE for
//      the chunk loop: read 4 ASCII bytes, read a little-endian uint32 size, read that many bytes;
//      `ampf` datasize must be 4 and its payload is the device fourcc; the device-type table is
//      aaaa/mmmm/iiii plus nagg/natt (MIDI tools); a `ptch` payload beginning "mx@c" is a FROZEN
//      device; otherwise the payload is patcher JSON whose FINAL NUL BYTE IS STRIPPED BEFORE
//      PARSING; `ciph` marks an encrypted device. Its `meta` handler ignores the payload entirely.
//   2. ktamas77/js2max `src/amxd/writer.ts` — same three chunks, little-endian lengths, same
//      fourcc table; writes `meta` = 7.
//   3. Provokke/tether-m4l `tools/amxd.mjs` — same 32-byte ampf/meta/ptch header, unfrozen JSON
//      body; writes `meta` = 1 by default.
//   4. shakfu/py2max `docs/notes/amxd.md` — byte-for-byte re-pack of two real Max-exported
//      devices: "NUL-terminated UTF-8 patcher JSON"; those fixtures carry NO `meta` chunk at all.
//   (audiocontrol-org/audiocontrol `create-amxd-binary.cjs` writes `meta` = 1; dreamrec/LivePilot
//   and pnomolos/live-wire write `meta` = 0. See README for the citation list.)
//
// UNKNOWN, recorded rather than papered over: the `meta` payload value. Observed 0, 1 and 7 in the
// wild, absent from Ableton's own byte-exact fixtures, and ignored by Ableton's own reader. We
// write the most common stated value and accept any value — or no `meta` chunk — when reading.
// Only a real Live load can settle whether Live itself cares.

const TAG_BYTES = 4;
const LENGTH_BYTES = 4;
const CHUNK_HEADER_BYTES = TAG_BYTES + LENGTH_BYTES;
const META_VALUE = 1;
const FROZEN_TAG = 'mx@c';
const NUL = 0;

// Device fourcc per Ableton's own device_types table. MIDI-tool types (nagg/natt) are read-only
// here: LEDrums ships an audio effect and a MIDI effect, and never claims to author MIDI tools.
const DEVICE_TYPES = { audio: 'aaaa', midi: 'mmmm', instrument: 'iiii' };
const KIND_BY_TYPE = new Map(Object.entries(DEVICE_TYPES).map(([kind, type]) => [type, kind]));
const READ_ONLY_TYPES = new Map([['nagg', 'MIDI Tool Generator'], ['natt', 'MIDI Tool Transformation']]);
const KNOWN_TAGS = new Set(['ampf', 'meta', 'ptch', 'ciph']);

function deviceTypeFor(kind) {
  const type = DEVICE_TYPES[kind];
  if (!type) throw new Error(`Unknown device kind "${kind}"; expected ${Object.keys(DEVICE_TYPES).join(', ')}`);
  return type;
}

function chunk(tag, payload) {
  const header = Buffer.alloc(CHUNK_HEADER_BYTES);
  header.write(tag, 0, TAG_BYTES, 'latin1');
  header.writeUInt32LE(payload.length, TAG_BYTES);
  return Buffer.concat([header, payload]);
}

function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

/**
 * Wrap patcher JSON text in an unfrozen device container.
 * `json` is written as UTF-8 and terminated with a single NUL byte, which is what Ableton's own
 * reader strips. Pass the text exactly as it should round-trip; nothing else is appended.
 */
function write(json, kind, { meta = META_VALUE } = {}) {
  if (typeof json !== 'string') throw new Error('Patcher JSON must be a string');
  const type = deviceTypeFor(kind);
  const patcher = Buffer.concat([Buffer.from(json, 'utf8'), Buffer.from([NUL])]);
  return Buffer.concat([
    chunk('ampf', Buffer.from(type, 'latin1')),
    chunk('meta', uint32(meta)),
    chunk('ptch', patcher),
  ]);
}

function splitChunks(buffer) {
  const chunks = [];
  let at = 0;
  while (at < buffer.length) {
    const remaining = buffer.length - at;
    if (remaining < CHUNK_HEADER_BYTES) {
      throw new Error(`Truncated .amxd: ${remaining} trailing byte(s) are not an 8-byte chunk header`);
    }
    const tag = buffer.toString('latin1', at, at + TAG_BYTES);
    if (!/^[\x20-\x7e]{4}$/.test(tag)) {
      throw new Error(`Not an .amxd: chunk tag at byte ${at} is not four printable ASCII characters`);
    }
    const length = buffer.readUInt32LE(at + TAG_BYTES);
    const start = at + CHUNK_HEADER_BYTES;
    if (length > buffer.length - start) {
      throw new Error(`Truncated .amxd: chunk "${tag}" declares ${length} byte(s), ${buffer.length - start} remain`);
    }
    chunks.push({ tag, data: buffer.subarray(start, start + length) });
    at = start + length;
  }
  return chunks;
}

/**
 * Parse an unfrozen device container. Frozen (`mx@c`) and encrypted (`ciph`) devices are REFUSED
 * with a named error rather than mis-parsed. Returns the device kind/type, the `meta` value as
 * stored (null when the chunk is absent), the patcher JSON text without its NUL terminator, and
 * the parsed patcher.
 */
function read(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < CHUNK_HEADER_BYTES) {
    throw new Error(`Not an .amxd: ${buffer.length} byte(s) is shorter than one chunk header`);
  }
  const chunks = splitChunks(buffer);
  const [first] = chunks;
  if (first.tag !== 'ampf') throw new Error(`Not an .amxd: expected an "ampf" chunk first, found "${first.tag}"`);
  for (const { tag } of chunks) {
    if (!KNOWN_TAGS.has(tag)) throw new Error(`Unsupported .amxd chunk "${tag}"`);
  }
  if (chunks.some(({ tag }) => tag === 'ciph')) {
    throw new Error('Encrypted .amxd (ciph chunk): the patcher cannot be read');
  }

  if (first.data.length !== 4) {
    throw new Error(`Malformed .amxd: the "ampf" chunk declares ${first.data.length} byte(s), expected 4`);
  }
  const type = first.data.toString('latin1');
  const kind = KIND_BY_TYPE.get(type);
  if (!kind) {
    const known = READ_ONLY_TYPES.get(type);
    throw new Error(known
      ? `Unsupported .amxd device type "${type}" (${known}); LEDrums handles ${[...KIND_BY_TYPE.keys()].join(', ')}`
      : `Unknown .amxd device type "${type}"`);
  }

  const metaChunks = chunks.filter(({ tag }) => tag === 'meta');
  if (metaChunks.length > 1) throw new Error('Malformed .amxd: more than one "meta" chunk');
  let meta = null;
  if (metaChunks.length === 1) {
    if (metaChunks[0].data.length !== 4) {
      throw new Error(`Malformed .amxd: the "meta" chunk declares ${metaChunks[0].data.length} byte(s), expected 4`);
    }
    meta = metaChunks[0].data.readUInt32LE(0);
  }

  const patchChunks = chunks.filter(({ tag }) => tag === 'ptch');
  if (patchChunks.length !== 1) {
    throw new Error(`Malformed .amxd: expected exactly one "ptch" chunk, found ${patchChunks.length}`);
  }
  const payload = patchChunks[0].data;
  if (payload.toString('latin1', 0, TAG_BYTES) === FROZEN_TAG) {
    throw new Error('Frozen .amxd (mx@c payload): unfreeze the device in Max before reading it here');
  }
  const text = payload.length && payload[payload.length - 1] === NUL
    ? payload.toString('utf8', 0, payload.length - 1)
    : payload.toString('utf8');
  let patcher;
  try { patcher = JSON.parse(text); }
  catch (error) { throw new Error(`Malformed .amxd: the "ptch" payload is not JSON (${error.message})`); }
  return { kind, type, meta, json: text, patcher };
}

module.exports = { DEVICE_TYPES, META_VALUE, CHUNK_HEADER_BYTES, deviceTypeFor, write, read };
