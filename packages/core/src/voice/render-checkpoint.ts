import { Framebuffer } from '../engine/framebuffer';
import { tryGetModifier } from '../modifiers/registry';
import { tryGetEffect } from '../effects/registry';
import type { ModifierDef, ModifierCheckpoint, ResolvedModifier } from '../modifiers/types';
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
  return copyRenderState(value, model);
}

/** Recycle payloads, NOT object graphs or RNG closures. Rebuilding the small wrappers
 * preserves descriptors/cycles/alias topology even when a state changes shape. The spare
 * graph is private checkpoint/live storage; never recycle a buffer reachable from source.
 * Dropped or resized buffers are not kept in a high-water pool. */
function copyRenderState<T>(value: T, model: PixelModel, spare?: T): T {
  const sourceBuffers = new Set(stateBuffers(value, model));
  const buffers = stateBuffers(spare, model).filter((b) => !sourceBuffers.has(b));
  const seen = new Map<object, unknown>([[model, model]]);
  function copy(value: unknown): unknown {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (seen.has(value)) return seen.get(value);
    if (typeof value === 'function') {
      if (!('clone' in value) || typeof value.clone !== 'function') throw new Error('Render state contains a non-forkable function');
      const result: unknown = value.clone();
      if (result === value) throw new Error('Render state function did not fork its cursor');
      seen.set(value, result);
      return result;
    }
    if (value instanceof Prng) {
      const result = value.clone();
      seen.set(value, result);
      return result;
    }
    if (value instanceof ArrayBuffer) {
      const index = buffers.findIndex((b) => b.byteLength === value.byteLength);
      const result = index < 0 ? value.slice(0) : buffers.splice(index, 1)[0]!;
      if (index >= 0) new Uint8Array(result).set(new Uint8Array(value));
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

/** Enumerate backing stores once, without invoking getters or walking pixel elements. */
function stateBuffers(value: unknown, model: PixelModel): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  const seen = new Set<unknown>([model]);
  function visit(v: unknown): void {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v instanceof ArrayBuffer) { buffers.push(v); return; }
    if (ArrayBuffer.isView(v)) { visit(v.buffer); return; }
    if (v instanceof Map) { for (const [k, entry] of v) { visit(k); visit(entry); } return; }
    if (v instanceof Set) { for (const entry of v) visit(entry); return; }
    for (const key of Reflect.ownKeys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if ('value' in d) visit(d.value);
    }
  }
  visit(value);
  return buffers;
}

interface RenderState extends GeometryState {
  generatorId?: string | null;
  modifiers?: ResolvedModifier[];
  mixInputs?: RenderState[];
  spliceInputs?: RenderState[];
}
interface Journal {
  definition: ModifierDef;
  state: unknown;
  checkpoint: ModifierCheckpoint;
}
interface Snapshot {
  owner: RenderState;
  data: { genState: unknown; materialCycle: GeometryState['materialCycle']; modState: unknown[] | undefined };
  journals: (Journal | undefined)[];
  renderGenerator: GeometryState['renderGenerator'];
  mixInputs?: Snapshot[];
  spliceInputs?: Snapshot[];
}
function capture(state: RenderState, model: PixelModel, previous?: Snapshot): Snapshot {
  if (previous?.owner !== state) previous = undefined;
  const generator = state.generatorId ? tryGetEffect(state.generatorId) : undefined;
  if (state.renderGenerator && state.renderGenerator !== generator) {
    // The bridge would reset this too. Do it before copying so a registry upsert/removal
    // cannot retain (or copy) a retired sampler/history until some later tick.
    state.genState = null;
    state.materialCycle = undefined;
    state.renderGenerator = generator;
    if (previous) {
      previous.data.genState = null;
      previous.data.materialCycle = undefined;
    }
  }
  const journals: Snapshot['journals'] = [];
  const modState = state.modState?.map((value, i) => {
    const link = state.modifiers?.[i];
    const definition = link && tryGetModifier(link.modifierId);
    // The scoped runner invokes full-output links once; range-local slots are maps and
    // use the general copier. Only the declaring modifier may journal its internals.
    if (value == null || definition?.scopePolicy !== 'full-output' || !definition.createCheckpoint) return value;
    const old = previous?.journals[i];
    const journal = old?.state === value && old.definition === definition ? old : {
      definition, state: value, checkpoint: definition.createCheckpoint(value),
    };
    journal.checkpoint.capture();
    journals[i] = journal;
    return undefined;
  });
  return {
    owner: state,
    data: copyRenderState({ genState: state.genState, materialCycle: state.materialCycle, modState }, model, previous?.data),
    journals,
    renderGenerator: state.renderGenerator,
    mixInputs: state.mixInputs?.map((m, i) => capture(m, model, previous?.mixInputs?.[i])),
    spliceInputs: state.spliceInputs?.map((m, i) => capture(m, model, previous?.spliceInputs?.[i])),
  };
}
function restore(state: RenderState, snapshot: Snapshot, model: PixelModel): void {
  const generator = state.generatorId ? tryGetEffect(state.generatorId) : undefined;
  if (snapshot.renderGenerator && snapshot.renderGenerator !== generator) {
    snapshot.data.genState = null;
    snapshot.data.materialCycle = undefined;
    snapshot.renderGenerator = generator;
  }
  const data = copyRenderState(snapshot.data, model, {
    genState: state.genState,
    materialCycle: state.materialCycle,
    // Journal-owned live rings must never enter the generic spare-buffer pool.
    modState: state.modState?.map((v, i) => snapshot.journals[i] ? undefined : v),
  });
  state.genState = data.genState;
  state.materialCycle = data.materialCycle;
  state.modState = data.modState;
  for (let i = 0; i < snapshot.journals.length; i++) {
    const journal = snapshot.journals[i];
    if (journal) state.modState![i] = journal.checkpoint.restore();
  }
  state.renderGenerator = snapshot.renderGenerator;
  for (const key of ['mixInputs', 'spliceInputs'] as const) {
    state[key]?.forEach((m, i) => {
      const member = snapshot[key]?.[i];
      if (member?.owner === m) restore(m, member, model);
      else (snapshot[key] ??= [])[i] = capture(m, model);
    });
    if (snapshot[key]) snapshot[key].length = state[key]?.length ?? 0;
  }
}

/** Bounded to one pre-render checkpoint per live voice generation in the current model.
 * Ordinary ticks overwrite retained storage; same-tick presentations restore into the
 * live payloads. Only shape/model/generation changes allocate new payload storage.
 * A dirty presentation replaces that tick's candidate state. The next tick therefore
 * resumes exactly as if only the final presentation had been rendered once. Lifecycle,
 * eval PRNG, latches and splice motion are NEVER rolled back or advanced here.
 */
export interface RenderCheckpoint {
  (voices: readonly Voice[], model: PixelModel, tick: number): void;
  /** Ownership-only: never capture/restore state or execute effects. Call after retirement
   * or generation/model replacement even when presentation is suspended. Unchanged live
   * baselines (including Echo's exclusive one-slot journal) must survive dirty replay.
   * Opaque state is not inspected here; capture's explicit rejection contract is unchanged. */
  prune(voices: readonly Voice[], model: PixelModel | null): void;
  /** Release all checkpoints AND the model identity immediately. */
  reset(): void;
}

export function createRenderCheckpoint(): RenderCheckpoint {
  let geometry: PixelModel | null = null;
  const snapshots = new Map<Voice, { id: string; seed: number; bornAtMs: number; tick: number; snapshot: Snapshot }>();
  const reset = (): void => { snapshots.clear(); geometry = null; };
  const prune = (voices: readonly Voice[], model: PixelModel | null): void => {
    if (geometry !== model || !model) {
      reset();
      geometry = model;
      return;
    }
    const alive = new Set(voices.filter((v) => v.active));
    for (const [v, entry] of snapshots) {
      // renderModel also fences an explicitly reset/reused slab with equal id/seed/birth.
      if (!alive.has(v) || v.renderModel !== model || entry.id !== v.id ||
        entry.seed !== v.seed || entry.bornAtMs !== v.bornAtMs) snapshots.delete(v);
    }
  };
  const checkpoint = (voices: readonly Voice[], model: PixelModel, tick: number): void => {
    prune(voices, model);
    for (const v of voices) {
      if (!v.active) continue;
      ensureGeometryState(v, model);
      const entry = snapshots.get(v);
      if (entry?.tick === tick) restore(v, entry.snapshot, model);
      else snapshots.set(v, { id: v.id, seed: v.seed, bornAtMs: v.bornAtMs, tick,
        snapshot: capture(v, model, entry?.snapshot) });
    }
  };
  return Object.assign(checkpoint, { prune, reset });
}
