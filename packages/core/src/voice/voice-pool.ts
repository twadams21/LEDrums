/**
 * Object-pooled voice store — the fixed-size voice slab plus its spawn/acquire/release
 * lifecycle (ported from `sim.spawn`/`release`). The pool is pre-sized once and reused:
 * zero allocation on the hot path, no GC churn, voice-capped. {@link VoiceBusEngine}
 * owns one {@link VoicePool}; the per-frame envelope advance lives in `envelope-tick.ts`.
 *
 * Pure + deterministic: no IO, no wall-clock — `timeMs` is always supplied by the caller
 * (the engine, which owns transport), never read from a global clock.
 */
import type { PlayAction } from './eval-graph';
import { deriveSeed } from './prng';
import type { Bus, EffectDef, ParamSpec, Voice } from './types';

const VOICE_CAP = 256;
/** Base mixed with the monotonic voice counter into each voice's per-trigger seed. */
const VOICE_SEED_BASE = 0x1ed5eed5;

/** The engine-owned lookups + frame time {@link VoicePool.spawn} needs to realise a
    {@link PlayAction} into a live voice. Held by reference, not copied. */
export interface SpawnDeps {
  effectsById: Map<string, EffectDef>;
  busById: Map<string, Bus>;
  latched: Map<string, string | null>;
  timeMs: number;
}

/**
 * Move a voice into its release phase (idempotent). Pulled out as a free function so
 * both the pool's mono-steal and the per-frame envelope tick share one definition.
 */
export function releaseVoice(v: Voice, timeMs: number): void {
  if (v.phase === 'release') return;
  v.phase = 'release';
  v.releaseAtMs = timeMs;
  v.releaseFromLevel = v.level;
}

export class VoicePool {
  /** Fixed-size slab; `active` marks occupancy. Iterated directly by the engine for
      envelope tick, compositing, and stats. */
  readonly pool: Voice[] = [];
  private voiceSeq = 0;

  constructor() {
    for (let i = 0; i < VOICE_CAP; i++) this.pool.push(makeVoiceSlot());
  }

  /** Authored content changed: free every slot so eval starts clean & deterministic. */
  reset(): void {
    for (const v of this.pool) v.active = false;
  }

  findActiveVoice(id: string): Voice | null {
    for (const v of this.pool) if (v.active && v.id === id) return v;
    return null;
  }

  isVoiceAlive(id: string): boolean {
    return this.findActiveVoice(id) != null;
  }

  /**
   * Find a free pool slot; if the pool is saturated, steal the oldest releasing
   * voice, else the oldest voice overall (voice-capped, no GC churn).
   */
  acquireSlot(): Voice | null {
    let free: Voice | null = null;
    let oldestReleasing: Voice | null = null;
    let oldest: Voice | null = null;
    for (const v of this.pool) {
      if (!v.active) {
        free = v;
        break;
      }
      if (v.phase === 'release' && (!oldestReleasing || v.bornAtMs < oldestReleasing.bornAtMs)) {
        oldestReleasing = v;
      }
      if (!oldest || v.bornAtMs < oldest.bornAtMs) oldest = v;
    }
    return free ?? oldestReleasing ?? oldest;
  }

  spawn(a: PlayAction, sourceDrumId: string | null, velocity: number, deps: SpawnDeps): Voice | null {
    const effect = deps.effectsById.get(a.effectId);
    if (!effect) return null;
    const bus = deps.busById.get(a.busId || effect.busId);
    if (!bus) return null;

    if (bus.polyphony === 'mono') {
      for (const v of this.pool) {
        if (v.active && v.busId === bus.id && v.phase !== 'release') releaseVoice(v, deps.timeMs);
      }
    }

    const slot = this.acquireSlot();
    if (!slot) return null;

    slot.active = true;
    slot.id = `v${++this.voiceSeq}`;
    slot.effectId = a.effectId;
    slot.pattern = effect.pattern;
    slot.busId = bus.id;
    slot.mode = a.mode;
    slot.scope = a.scope;
    slot.targetId = a.targetId;
    slot.sourceDrumId = sourceDrumId;
    slot.velocity = velocity;
    // Per-trigger seed (item C): a fresh derived stream per spawn — deterministic given the
    // same input sequence (the counter advances identically), different on every fire.
    slot.seed = deriveSeed(VOICE_SEED_BASE, this.voiceSeq);
    // Generator-backed effects host a legacy EffectGenerator; the compositor reads
    // `generatorId` + `genState`. Reset state on (re)spawn so a reused pool slot never
    // inherits a previous voice's accumulation buffers / RNG cursor.
    slot.generatorId = effect.generatorId ?? null;
    slot.genState = null;
    // Resolved modifier chain (S29 populates `a.modifiers` from graph topology). Reset
    // per-voice modifier state on (re)spawn so a reused slot never inherits a previous
    // voice's accumulators — same lifecycle as `genState` (per-voice-state rule).
    slot.modifiers = a.modifiers;
    slot.modState = undefined;
    // Resolved modulation mappings (S34 populates `a.modulations` from graph topology); no
    // per-voice state — envelopes sample the voice's own life phase, so a reused slot just
    // takes the new list (or undefined) with nothing to reset.
    slot.modulations = a.modulations;
    slot.params = { ...a.params };
    slot.specs = effect.params;
    slot.attackMs = effect.attackMs;
    slot.sustainMs = effect.sustainMs;
    slot.releaseMs = effect.releaseMs;
    slot.phase = 'attack';
    slot.level = 0;
    slot.bornAtMs = deps.timeMs;
    slot.releaseAtMs = null;
    slot.releaseFromLevel = 1;
    slot.via = a.via;
    slot.deckGain = 1;

    if (a.latchKey) deps.latched.set(a.latchKey, slot.id);
    return slot;
  }
}

/** Pre-allocated voice pool slot (inactive). */
function makeVoiceSlot(): Voice {
  return {
    active: false,
    id: '',
    effectId: '',
    pattern: 'flash',
    busId: '',
    mode: 'oneshot',
    scope: 'kit',
    targetId: undefined,
    sourceDrumId: null,
    velocity: 1,
    seed: 0,
    generatorId: null,
    genState: null,
    modifiers: undefined,
    modState: undefined,
    modulations: undefined,
    params: {},
    liveParams: {},
    specs: EMPTY_SPECS,
    attackMs: 0,
    sustainMs: 0,
    releaseMs: 0,
    phase: 'attack',
    level: 0,
    bornAtMs: 0,
    releaseAtMs: null,
    releaseFromLevel: 1,
    via: '',
    deckGain: 1,
  };
}

const EMPTY_SPECS: ParamSpec[] = [];
