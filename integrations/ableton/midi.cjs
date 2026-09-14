'use strict';

/** MIDI 1 byte-stream tap. At most two data bytes are retained, even inside endless SysEx.
 * Running status is channel-message-only; real-time bytes do not disturb partial messages.
 * Unsupported messages are consumed correctly but never sent to the track-input protocol.
 * The Max performance path is a separate, DIRECT midiin -> midiout cord, not this parser. */
function createMidiParser(emit) {
  let running = 0;
  let status = 0;
  let expected = 0;
  let count = 0;
  let first = 0;
  let sysex = false;
  function reset() {
    running = status = expected = count = first = 0;
    sysex = false;
  }
  function push(byte) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) return;
    // Clock, Start/Continue/Stop, active sensing, reset and reserved real-time slots.
    // They pass downstream in Max; this protocol has no clock or system-message variant.
    if (byte >= 0xf8) return;
    if (byte >= 0x80) {
      count = 0;
      sysex = false;
      status = byte;
      if (byte < 0xf0) {
        running = byte;
        expected = (byte & 0xe0) === 0xc0 ? 1 : 2;
      } else {
        running = 0; // System common, including EOX, cancels channel running status.
        sysex = byte === 0xf0;
        expected = byte === 0xf2 ? 2 : byte === 0xf1 || byte === 0xf3 ? 1 : 0;
      }
      return;
    }
    if (sysex || expected === 0) return;
    if (count === 0) first = byte;
    count += 1;
    if (count < expected) return;
    const command = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    if (command === 0x80 || command === 0x90) {
      emit({ t: 'midi', note: first, velocity: byte, on: command === 0x90 && byte > 0, channel });
    } else if (command === 0xb0) {
      emit({ t: 'cc', controller: first, value: byte, channel });
    }
    count = 0;
    status = running;
    if (!running) expected = 0;
  }
  return { push, reset };
}

module.exports = { createMidiParser };
