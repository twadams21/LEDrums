import { describe, expect, it, vi } from 'vitest';
import { initMidi, parseMidiMessage } from './webmidi';

class FakeInput {
  onmidimessage: ((ev: { data: Uint8Array }) => void) | null = null;
  constructor(public name: string) {}
  emit(data: number[]): void {
    this.onmidimessage?.({ data: new Uint8Array(data) });
  }
}

function fakeAccess(inputs: FakeInput[]) {
  const map = new Map<string, FakeInput>();
  inputs.forEach((i, idx) => map.set(String(idx), i));
  return { inputs: map, onstatechange: null as unknown };
}

describe('parseMidiMessage', () => {
  it('parses note-on with velocity', () => {
    expect(parseMidiMessage([0x90, 38, 100])).toEqual({ kind: 'note', note: 38, velocity: 100, on: true });
  });
  it('treats note-on velocity 0 as note-off', () => {
    expect(parseMidiMessage([0x90, 38, 0])).toEqual({ kind: 'note', note: 38, velocity: 0, on: false });
  });
  it('parses note-off', () => {
    expect(parseMidiMessage([0x80, 38, 64])).toEqual({ kind: 'note', note: 38, velocity: 0, on: false });
  });
  it('parses Control Change (0xB0) as a cc event', () => {
    expect(parseMidiMessage([0xb0, 0, 5])).toEqual({ kind: 'cc', controller: 0, value: 5 });
    expect(parseMidiMessage([0xb3, 7, 100])).toEqual({ kind: 'cc', controller: 7, value: 100 }); // channel masked off
  });
  it('parses Program Change (0xC0) as a 2-byte programChange event', () => {
    expect(parseMidiMessage([0xc0, 2])).toEqual({ kind: 'programChange', value: 2 });
    expect(parseMidiMessage([0xc5, 0])).toEqual({ kind: 'programChange', value: 0 }); // channel masked off
  });
  it('ignores unknown statuses and short payloads', () => {
    expect(parseMidiMessage([0x90, 38])).toBeNull(); // note needs 3 bytes
    expect(parseMidiMessage([0xa0, 1, 2])).toBeNull(); // poly aftertouch (not forwarded)
    expect(parseMidiMessage([0xc0])).toBeNull(); // program change needs the program byte
    expect(parseMidiMessage(null)).toBeNull();
  });
});

describe('initMidi', () => {
  it('forwards a single note-on from a fake MIDIAccess input', async () => {
    const input = new FakeInput('Pad');
    const access = fakeAccess([input]);
    const nav = { requestMIDIAccess: vi.fn().mockResolvedValue(access) };
    const handler = vi.fn();

    const result = await initMidi(handler, nav);
    expect(result.available).toBe(true);
    expect(result.inputs).toEqual(['Pad']);

    input.emit([0x90, 36, 120]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ kind: 'note', note: 36, velocity: 120, on: true });
  });

  it('forwards Program Change and Control Change events from a fake input', async () => {
    const input = new FakeInput('Controller');
    const nav = { requestMIDIAccess: vi.fn().mockResolvedValue(fakeAccess([input])) };
    const handler = vi.fn();
    await initMidi(handler, nav);

    input.emit([0xc0, 3]); // Program Change → song 3
    input.emit([0xb0, 0, 2]); // CC#0 value 2 → section 2
    expect(handler).toHaveBeenNthCalledWith(1, { kind: 'programChange', value: 3 });
    expect(handler).toHaveBeenNthCalledWith(2, { kind: 'cc', controller: 0, value: 2 });
  });

  it('degrades gracefully when requestMIDIAccess is absent', async () => {
    const result = await initMidi(vi.fn(), {} as never);
    expect(result.available).toBe(false);
    expect(result.reason).toBe('no-api');
    expect(() => result.stop()).not.toThrow();
  });

  it('surfaces an access error without throwing', async () => {
    const nav = { requestMIDIAccess: vi.fn().mockRejectedValue(new Error('denied')) };
    const result = await initMidi(vi.fn(), nav);
    expect(result.available).toBe(false);
    expect(result.reason).toBe('denied');
  });

  it('stop() detaches handlers so no further events forward', async () => {
    const input = new FakeInput('Pad');
    const nav = { requestMIDIAccess: vi.fn().mockResolvedValue(fakeAccess([input])) };
    const handler = vi.fn();
    const result = await initMidi(handler, nav);
    result.stop();
    input.emit([0x90, 36, 120]);
    expect(handler).not.toHaveBeenCalled();
  });
});
