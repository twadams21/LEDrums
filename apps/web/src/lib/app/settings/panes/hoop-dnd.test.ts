import { describe, expect, it } from 'vitest';
import { HOOP_MIME, isHoopDrag, readHoopDrag, writeHoopDrag, type DragPayloadCarrier } from './hoop-dnd';

/* A drop commits a routing change, so the read side has to be strict: only our own MIME,
   only a payload that still looks like a hoop. Anything else is not a hoop drag. */

function carrier(seed: Record<string, string> = {}): DragPayloadCarrier {
  const store = new Map(Object.entries(seed));
  return {
    setData: (f, d) => void store.set(f, d),
    getData: (f) => store.get(f) ?? '',
    get types() {
      return [...store.keys()];
    },
  };
}

describe('hoop drag payload', () => {
  it('round-trips a chain-row drag', () => {
    const dt = carrier();
    const drag = { hoop: { drumId: 'kick', hoop: 2 }, from: { outputId: 'o1', index: 3 } };
    writeHoopDrag(dt, drag);
    expect(readHoopDrag(dt)).toEqual(drag);
  });

  it('round-trips a pool drag (no source chain)', () => {
    const dt = carrier();
    writeHoopDrag(dt, { hoop: { drumId: 'snare', hoop: 1 }, from: null });
    expect(readHoopDrag(dt)).toEqual({ hoop: { drumId: 'snare', hoop: 1 }, from: null });
  });

  it('advertises itself under our MIME so a target can accept mid-drag', () => {
    const dt = carrier();
    writeHoopDrag(dt, { hoop: { drumId: 'kick', hoop: 1 }, from: null });
    expect(isHoopDrag(dt)).toBe(true);
    expect(isHoopDrag(carrier({ 'text/plain': 'kick' }))).toBe(false);
    expect(isHoopDrag(null)).toBe(false);
  });

  it('refuses a foreign drag, malformed JSON, and a payload that is not a hoop', () => {
    expect(readHoopDrag(carrier({ 'text/plain': 'kick' }))).toBeNull();
    expect(readHoopDrag(carrier({ [HOOP_MIME]: '{oops' }))).toBeNull();
    expect(readHoopDrag(carrier({ [HOOP_MIME]: '{"hoop":{"drumId":"kick"},"from":null}' }))).toBeNull();
    expect(readHoopDrag(carrier({ [HOOP_MIME]: '{"hoop":{"drumId":"kick","hoop":1}}' }))).toBeNull();
    expect(readHoopDrag(null)).toBeNull();
  });
});
