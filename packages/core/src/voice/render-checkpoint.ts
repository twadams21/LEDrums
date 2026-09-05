import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { Prng } from './prng';
import { ensureGeometryState, type GeometryState } from './geometry-state';
import type { Voice } from './types';

/** Copy runtime DATA, not a serialized show. structuredClone loses class methods and
 * cannot fork RNG closures; sharing either would secretly advance a paused simulation.
 * Only the concrete state carriers used by the built-ins are supported. Unknown opaque
 * objects/functions fail explicitly rather than claiming a safe but aliased checkpoint.
 * Model revisions are immutable and deliberately retain identity (including grid refs).
 */
export function cloneRenderState<T>(value: T, model: PixelModel): T {
  const seen = new Map<object, unknown>([[model, model]]);
  function copy(value: unknown): unknown {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (seen.has(value)) return seen.get(value);
    if (typeof value === 'function') {
      if (!('clone' in value) || typeof value.clone !== 'function') throw new Error('Render state contains a non-forkable function');
      const result: unknown = value.clone();
      seen.set(value, result);
      return result;
    }
    if (value instanceof Prng) {
      const result = value.clone();
      seen.set(value, result);
      return result;
    }
    if (value instanceof ArrayBuffer) {
      const result = value.slice(0);
      seen.set(value, result);
      return result;
    }
    if (ArrayBuffer.isView(value)) {
      // Preserve shared backing buffers and view offsets, not just the visible bytes.
      const buffer = copy(value.buffer) as ArrayBuffer;
      const result = value instanceof DataView
        ? new DataView(buffer, value.byteOffset, value.byteLength)
        : new (value.constructor as new (b: ArrayBuffer, offset: number, length: number) => ArrayBufferView)(
          buffer, value.byteOffset, value.byteLength / (value as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT);
      seen.set(value, result);
      return result;
    }
    if (value instanceof Map) {
      const result = new Map();
      seen.set(value, result);
      for (const [k, v] of value) result.set(copy(k), copy(v));
      return result;
    }
    if (value instanceof Set) {
      const result = new Set();
      seen.set(value, result);
      for (const v of value) result.add(copy(v));
      return result;
    }
    const proto = Object.getPrototypeOf(value) as object | null;
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null &&
      !(value instanceof Framebuffer)) {
      throw new Error('Render state contains an unsupported opaque object');
    }
    const result: object = Array.isArray(value) ? [] : Object.create(proto);
    seen.set(value, result);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) throw new Error('Render state contains an opaque accessor');
      Object.defineProperty(result, key, { ...descriptor, value: copy(descriptor.value) });
    }
    return result;
  }
  return copy(value) as T;
}

interface Snapshot {
  genState: unknown;
  modState: unknown[] | undefined;
  renderGenerator: GeometryState['renderGenerator'];
  mixInputs?: Snapshot[];
  spliceInputs?: Snapshot[];
}
function capture(state: GeometryState, model: PixelModel): Snapshot {
  return {
    genState: cloneRenderState(state.genState, model),
    modState: cloneRenderState(state.modState, model),
    renderGenerator: state.renderGenerator,
    mixInputs: state.mixInputs?.map((m) => capture(m, model)),
    spliceInputs: state.spliceInputs?.map((m) => capture(m, model)),
  };
}
function restore(state: GeometryState, snapshot: Snapshot, model: PixelModel): void {
  state.genState = cloneRenderState(snapshot.genState, model);
  state.modState = cloneRenderState(snapshot.modState, model);
  state.renderGenerator = snapshot.renderGenerator;
  state.mixInputs?.forEach((m, i) => { if (snapshot.mixInputs?.[i]) restore(m, snapshot.mixInputs[i], model); });
  state.spliceInputs?.forEach((m, i) => { if (snapshot.spliceInputs?.[i]) restore(m, snapshot.spliceInputs[i], model); });
}

/** Bounded to one pre-render checkpoint per live voice in the current tick/model.
 * A dirty presentation replaces that tick's candidate state. The next tick therefore
 * resumes exactly as if only the final presentation had been rendered once. Lifecycle,
 * eval PRNG, latches and splice motion are NEVER rolled back or advanced here.
 */
export function createRenderCheckpoint(): (voices: readonly Voice[], model: PixelModel, tick: number) => void {
  let revision = -1;
  let geometry: PixelModel | null = null;
  const snapshots = new Map<string, Snapshot>();
  return (voices, model, tick) => {
    if (revision !== tick || geometry !== model) {
      snapshots.clear();
      revision = tick;
      geometry = model;
    }
    const alive = new Set(voices.filter((v) => v.active).map((v) => v.id));
    for (const id of snapshots.keys()) if (!alive.has(id)) snapshots.delete(id);
    for (const v of voices) {
      if (!v.active) continue;
      ensureGeometryState(v, model);
      const snapshot = snapshots.get(v.id);
      if (snapshot) restore(v, snapshot, model);
      else snapshots.set(v.id, capture(v, model));
    }
  };
}
