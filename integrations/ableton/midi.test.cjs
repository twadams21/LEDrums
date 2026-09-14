'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMidiParser } = require('./midi.cjs');
function harness() {
  const events = [];
  const parser = createMidiParser((event) => events.push(event));
  return { events, parser, feed: (bytes) => bytes.forEach(parser.push) };
}

test('channels 1–16, note-off release velocity, velocity-zero note-on, and CC', () => {
  const h = harness();
  for (let channel = 1; channel <= 16; channel++) {
    h.feed([0x90 + channel - 1, 38, 100, 38, 0, 0x80 + channel - 1, 38, 64, 0xb0 + channel - 1, 74, 127]);
    assert.deepEqual(h.events.splice(0), [
      { t: 'midi', note: 38, velocity: 100, on: true, channel },
      { t: 'midi', note: 38, velocity: 0, on: false, channel },
      { t: 'midi', note: 38, velocity: 64, on: false, channel },
      { t: 'cc', controller: 74, value: 127, channel },
    ]);
  }
});

test('running status/partial messages survive every real-time interleaving position', () => {
  for (let rt = 0xf8; rt <= 0xff; rt++) {
    const h = harness();
    h.feed([rt, 0x99, rt, 36, rt]);
    assert.equal(h.events.length, 0);
    h.feed([100, rt, 38, rt, 80, rt]);
    assert.deepEqual(h.events, [
      { t: 'midi', note: 36, velocity: 100, on: true, channel: 10 },
      { t: 'midi', note: 38, velocity: 80, on: true, channel: 10 },
    ]);
  }
});

test('unsupported channel messages consume correct byte lengths instead of becoming notes', () => {
  const h = harness();
  h.feed([0xa0, 1, 2, 3, 4, 0xc0, 20, 21, 22, 0xd0, 60, 61, 0xe0, 0, 64, 0, 65]);
  assert.deepEqual(h.events, []);
  h.feed([0x90, 60, 100]);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].note, 60);
});

test('system common cancels running status; new status abandons incomplete messages', () => {
  for (const common of [[0xf1, 1], [0xf2, 1, 2], [0xf3, 1], [0xf4], [0xf5], [0xf6], [0xf7]]) {
    const h = harness();
    h.feed([0x90, 36, 100, ...common, 38, 100]);
    assert.equal(h.events.length, 1);
    h.feed([0x90, 40, 0x81, 60, 64]);
    assert.deepEqual(h.events[1], { t: 'midi', note: 60, velocity: 64, on: false, channel: 2 });
  }
});

test('endless SysEx retains no payload, allows realtime, and recovers at EOX/new status', () => {
  const h = harness();
  h.feed([0x90, 36, 100, 0xf0]);
  for (let i = 0; i < 100_000; i++) { h.parser.push(i % 128); h.parser.push(0xf8); }
  assert.equal(h.events.length, 1);
  h.feed([0xf7, 38, 100]);
  assert.equal(h.events.length, 1, 'EOX does not restore old running status');
  h.feed([0xf0, 1, 2, 0x90, 40, 90]);
  assert.equal(h.events[1].note, 40, 'channel status aborts malformed unterminated SysEx');
});

test('invalid bytes are ignored and reset cannot complete stale partial notes', () => {
  const h = harness();
  h.feed([-1, 256, NaN, 60.5, '60', 60, 100]);
  assert.deepEqual(h.events, []);
  h.feed([0x90, 60]); h.parser.reset(); h.feed([100, 61, 100]);
  assert.deepEqual(h.events, []);
});
