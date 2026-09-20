'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { write, read, deviceTypeFor, DEVICE_TYPES, META_VALUE } = require('./amxd.cjs');
const { buildPatch, renderPatch } = require('./generate.cjs');

// Deliberately non-ASCII: "≤" is 3 UTF-8 bytes and "é" is 2, so a character count would understate
// the payload. The real patches carry "—", "·" and "≤" for the same reason.
const UNICODE_PATCH = JSON.stringify({ patcher: { comment: 'café ≤ 30 Hz — ok' } });
const TAG = (buffer, at) => buffer.toString('latin1', at, at + 4);

test('header bytes are exact per device kind: ampf/meta/ptch, little-endian byte lengths', () => {
  for (const [kind, type] of Object.entries({ midi: 'mmmm', audio: 'aaaa', instrument: 'iiii' })) {
    const bytes = write(UNICODE_PATCH, kind);
    assert.equal(deviceTypeFor(kind), type);
    assert.equal(TAG(bytes, 0), 'ampf');
    assert.equal(bytes.readUInt32LE(4), 4, 'ampf declares a 4-byte device type');
    assert.equal(TAG(bytes, 8), type);
    assert.equal(TAG(bytes, 12), 'meta');
    assert.equal(bytes.readUInt32LE(16), 4);
    assert.equal(bytes.readUInt32LE(20), META_VALUE);
    assert.equal(TAG(bytes, 24), 'ptch');
  }
  assert.deepEqual(Object.keys(DEVICE_TYPES).sort(), ['audio', 'instrument', 'midi']);
});

test('ptch declares UTF-8 BYTES, not characters, and the payload ends exactly at the declared end', () => {
  const bytes = write(UNICODE_PATCH, 'midi');
  const declared = bytes.readUInt32LE(28);
  const utf8 = Buffer.byteLength(UNICODE_PATCH, 'utf8');
  assert.ok(utf8 > UNICODE_PATCH.length, 'the fixture must be non-ASCII for this test to mean anything');
  assert.equal(declared, utf8 + 1, 'JSON bytes plus one NUL terminator');
  assert.equal(bytes.length, 32 + declared, 'nothing follows the declared ptch payload');
  assert.equal(bytes[bytes.length - 1], 0);
  assert.equal(bytes.toString('utf8', 32, bytes.length - 1), UNICODE_PATCH);
});

test('round trip returns the kind and the identical patcher for both generated devices', () => {
  for (const kind of ['midi', 'audio']) {
    const source = renderPatch(kind);
    const parsed = read(write(source, kind));
    assert.equal(parsed.kind, kind);
    assert.equal(parsed.type, DEVICE_TYPES[kind]);
    assert.equal(parsed.meta, META_VALUE);
    assert.equal(parsed.json, source, 'the NUL terminator is the only thing added');
    assert.deepEqual(parsed.patcher, buildPatch(kind));
  }
});

test('a payload with no NUL terminator still parses; a stray NUL is never left in the text', () => {
  const bare = Buffer.concat([
    Buffer.from('ampf'), Buffer.from([4, 0, 0, 0]), Buffer.from('mmmm'),
    Buffer.from('ptch'), (() => { const l = Buffer.alloc(4); l.writeUInt32LE(Buffer.byteLength(UNICODE_PATCH)); return l; })(),
    Buffer.from(UNICODE_PATCH, 'utf8'),
  ]);
  const parsed = read(bare);
  assert.equal(parsed.json, UNICODE_PATCH);
  assert.equal(parsed.meta, null, 'a device with no meta chunk is accepted; Live-exported fixtures omit it');
  assert.equal(read(write(UNICODE_PATCH, 'midi')).json, UNICODE_PATCH);
});

test('the reader refuses frozen devices instead of mis-parsing them', () => {
  const frozen = Buffer.concat([Buffer.from('mx@c'), Buffer.alloc(12), Buffer.from('{"patcher":{}}')]);
  const bytes = Buffer.concat([
    Buffer.from('ampf'), Buffer.from([4, 0, 0, 0]), Buffer.from('aaaa'),
    Buffer.from('ptch'), (() => { const l = Buffer.alloc(4); l.writeUInt32LE(frozen.length); return l; })(), frozen,
  ]);
  assert.throws(() => read(bytes), /Frozen \.amxd \(mx@c payload\)/);
});

test('the reader refuses truncation, bad magic, length overrun and other damage', () => {
  const good = write(UNICODE_PATCH, 'audio');
  assert.throws(() => read(good.subarray(0, 6)), /shorter than one chunk header/);
  assert.throws(() => read(good.subarray(0, good.length - 1)), /Truncated \.amxd: chunk "ptch" declares/);
  assert.throws(() => read(Buffer.concat([good, Buffer.from([1, 2, 3])])), /3 trailing byte\(s\)/);

  const badMagic = Buffer.from(good); badMagic.write('AMPF', 0, 4, 'latin1');
  assert.throws(() => read(badMagic), /expected an "ampf" chunk first, found "AMPF"/);

  const overrun = Buffer.from(good); overrun.writeUInt32LE(good.length, 28);
  assert.throws(() => read(overrun), /Truncated \.amxd: chunk "ptch" declares/);

  const badType = Buffer.from(good); badType.write('zzzz', 8, 4, 'latin1');
  assert.throws(() => read(badType), /Unknown \.amxd device type "zzzz"/);

  const midiTool = Buffer.from(good); midiTool.write('nagg', 8, 4, 'latin1');
  assert.throws(() => read(midiTool), /MIDI Tool Generator/);

  // A wrong ampf length usually desyncs the whole chunk stream; keep the stream aligned so the
  // device-type check itself is what rejects an 8-byte ampf payload.
  const chunk = (tag, data) => { const size = Buffer.alloc(4); size.writeUInt32LE(data.length); return Buffer.concat([Buffer.from(tag, 'latin1'), size, data]); };
  const wideAmpf = Buffer.concat([chunk('ampf', Buffer.from('aaaaaaaa')), chunk('ptch', Buffer.from('{}\0'))]);
  assert.throws(() => read(wideAmpf), /"ampf" chunk declares 8 byte\(s\), expected 4/);
  assert.throws(() => read(Buffer.concat([chunk('ampf', Buffer.from('aaaa')), chunk('meta', Buffer.from([1, 2]))])), /"meta" chunk declares 2 byte\(s\)/);
  assert.throws(() => read(chunk('ampf', Buffer.from('aaaa'))), /expected exactly one "ptch" chunk, found 0/);

  const unknownChunk = Buffer.from(good); unknownChunk.write('junk', 12, 4, 'latin1');
  assert.throws(() => read(unknownChunk), /Unsupported \.amxd chunk "junk"/);

  const encrypted = Buffer.from(good); encrypted.write('ciph', 12, 4, 'latin1');
  assert.throws(() => read(encrypted), /Encrypted \.amxd/);

  const notJson = write('{ not json', 'midi');
  assert.throws(() => read(notJson), /the "ptch" payload is not JSON/);

  assert.throws(() => write(UNICODE_PATCH, 'video'), /Unknown device kind "video"/);
  assert.throws(() => write({ patcher: {} }, 'midi'), /Patcher JSON must be a string/);
});
