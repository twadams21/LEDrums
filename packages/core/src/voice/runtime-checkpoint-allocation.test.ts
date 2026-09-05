import { expect, it, vi } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { createDefaultCompositor } from './compositor';
import { createRenderCheckpoint } from './render-checkpoint';
import { runtimeAction, runtimeFrame, runtimeModel, runtimeVoice } from './runtime-test-fixtures';

it('allocates no payload buffers on warm ordinary ticks or dirty restores (16 × 4096 × Echo64)', () => {
  const model = runtimeModel([4096]);
  const voices = Array.from({ length: 16 }, (_, i) => runtimeVoice({ id: `v${i + 1}`, renderModel: model,
    modState: [{ buf: new Float32Array(64 * 4096 * 4), rangeLen: 4096, pos: 0 }],
  }));
  const checkpoint = createRenderCheckpoint();
  checkpoint(voices, model, 0);
  const slice = ArrayBuffer.prototype.slice;
  let allocated = 0;
  const spy = vi.spyOn(ArrayBuffer.prototype, 'slice').mockImplementation(function (this: ArrayBuffer, start, end) {
    const result = slice.call(this, start, end);
    allocated += result.byteLength;
    return result;
  });
  try {
    for (let tick = 1; tick <= 3; tick++) checkpoint(voices, model, tick);
    expect(allocated, 'ordinary tick payload allocations').toBe(0);
    for (let paint = 0; paint < 3; paint++) checkpoint(voices, model, 3);
    expect(allocated, 'dirty restore payload allocations').toBe(0);
  } finally { spy.mockRestore(); }
});

/** Count backing stores, not view wrappers. Covers constructors AND native slice paths;
 * spying on ArrayBuffer.slice alone would miss a regression using new Float32Array(n).
 * Warm-up registers existing payloads so constructing a view doesn't count as allocation.
 * set-byte counts are checkpoint traffic (these two real modifiers render via scalar loops).
 */
function measurePayloads(warm: () => void, measured: () => void) {
  const seen = new WeakSet<object>();
  let measuring = false;
  let allocated = 0;
  let copied = 0;
  function record(value: unknown) {
    const buffer = ArrayBuffer.isView(value) ? value.buffer : value instanceof ArrayBuffer ? value : null;
    if (buffer && !seen.has(buffer)) {
      seen.add(buffer);
      if (measuring) allocated += buffer.byteLength;
    }
    return value;
  }
  const constructors = ['ArrayBuffer', 'DataView', 'Float32Array', 'Float64Array', 'Int8Array', 'Uint8Array',
    'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'BigInt64Array', 'BigUint64Array'] as const;
  for (const name of constructors) {
    vi.stubGlobal(name, new Proxy(globalThis[name], {
      construct(target, args, newTarget) { return record(Reflect.construct(target, args, newTarget)) as object; },
    }));
  }
  const slice = ArrayBuffer.prototype.slice;
  const sliceSpy = vi.spyOn(ArrayBuffer.prototype, 'slice').mockImplementation(function (this: ArrayBuffer, start, end) {
    return record(slice.call(this, start, end)) as ArrayBuffer;
  });
  const typed = Object.getPrototypeOf(Uint8Array.prototype) as {
    slice(start?: number, end?: number): ArrayBufferView;
    set(source: ArrayLike<number>, offset?: number): void;
  };
  const typedSlice = typed.slice;
  const typedSliceSpy = vi.spyOn(typed, 'slice').mockImplementation(function (this: ArrayBufferView, start, end) {
    return record(typedSlice.call(this, start, end)) as ArrayBufferView;
  });
  const set = typed.set;
  const setSpy = vi.spyOn(typed, 'set').mockImplementation(function (this: { BYTES_PER_ELEMENT: number }, source, offset) {
    if (measuring) copied += source.length * this.BYTES_PER_ELEMENT;
    set.call(this, source, offset);
  });
  try {
    warm();
    measuring = true;
    measured();
    return { allocated, copied };
  } finally {
    setSpy.mockRestore();
    typedSliceSpy.mockRestore();
    sliceSpy.mockRestore();
    vi.unstubAllGlobals();
  }
}

it('the allocation meter detects constructors and native slices, but not views', () => {
  let data: Float32Array;
  const result = measurePayloads(() => { data = new Float32Array(100); }, () => {
    data.subarray(1);
    new Uint8Array(data.buffer);
    new Float32Array(3);
    data.slice(0, 4);
    data.buffer.slice(0, 8);
  });
  expect(result.allocated).toBe(12 + 16 + 8);
});

for (const modifierId of ['echo', 'feedback']) {
  it(`${modifierId}: actual warm renders and restores allocate zero payload bytes and copy only one frame`, () => {
    const model = runtimeModel([4096]);
    const voices = Array.from({ length: 16 }, (_, i) => runtimeVoice({ id: `v${i + 1}`,
      modifiers: [{ modifierId, params: { delayMs: 32, feedback: 0.5, amount: 0.5, shift: 1 } }],
    }, runtimeAction({ params: { brightness: 0.1 } }), 'solid-colour'));
    const compositor = createDefaultCompositor();
    const dst = new Framebuffer(model.pixelCount);
    const render = (tick: number) => compositor.renderPresentation(voices, model, runtimeFrame(tick * 16), dst, tick);
    // First render lazily creates effect state; the next capture warms its checkpoint.
    // The pre-initialized parent probe above needs only its single tick-0 capture.
    const result = measurePayloads(() => { render(0); render(1); render(1); }, () => {
      for (let tick = 2; tick <= 4; tick++) render(tick);
      for (let paint = 0; paint < 3; paint++) render(4);
    });
    expect(result.allocated).toBe(0);
    expect(result.copied).toBe(6 * 16 * 4096 * 4 * 4);
  });
}

