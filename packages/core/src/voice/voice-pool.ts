/**
 * Object-pooled voice store — the fixed-size voice slab plus its spawn/acquire/release
 * lifecycle (ported from `sim.spawn`/`release`). The pool is pre-sized once and reused:
 * zero allocation on the hot path, no GC churn, voice-capped. {@link VoiceBusEngine}
 * owns one {@link VoicePool}; the per-frame envelope advance lives in `envelope-tick.ts`.
 *
 * Pure + deterministic: no IO, no wall-clock — `timeMs` is always supplied by the caller
 * (the engine, which owns transport), never read from a global clock.
 */
import { canvasEffectId } from '../canvas/ids';
import type { PlayAction } from './eval-graph';
import { deriveSeed } from './prng';
import type { Bus, EffectDef, MixInput, ParamSpec, Voice } from './types';

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
  /** Eval state prefix (pad / slot key) the spawning action belongs to — tagged onto the
      voice so origin-keyed liveness scans (R13 delay-overlap Mix) can be pad-scoped. `''`
      for non-graph spawns (section looks). */
  pad?: string;
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
   * Is a layer origin node still live for this pad? True when an active voice spawned under
   * `pad` represents `originNodeId` — either as its own producing node or as one of a Mix
   * voice's members. The delay-overlap Mix evaluator (R13) reads this to keep still-live
   * siblings in a delayed composition and drop decayed ones.
   */
  isLayerLive(pad: string, originNodeId: string): boolean {
    for (const v of this.pool) {
      if (!v.active || v.pad !== pad) continue;
      if (v.originNodeId === originNodeId) return true;
      if (v.mixInputs?.some((mi) => mi.originNodeId === originNodeId)) return true;
    }
    return false;
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

    // B1 — a delayed Mix re-composition supersedes the prior still-live composite at the same
    // (pad, originNodeId): release it so their shared members aren't composited twice (double
    // brightness across the overlap window). Poly buses never steal, so without this the
    // immediate Mix[A] voice and the re-composed Mix[A,B] voice both render A. The two composites
    // are one evolving timeline voice, not siblings. Release the OLDEST still-live match — a
    // single delayed fire has exactly one; the (pad, originNodeId) key can't distinguish trigger
    // instances (S2), so under rapid multi-fires this releases the oldest composite at that key.
    // Immediate/`delay 0` spawns never set the flag, so genuine multiplicity is untouched.
    if (a.supersedePriorVoice && a.originNodeId) {
      const pad = deps.pad ?? '';
      let prior: Voice | null = null;
      for (const v of this.pool) {
        if (!v.active || v.phase === 'release') continue;
        if (v.pad !== pad || v.originNodeId !== a.originNodeId) continue;
        if (!prior || v.bornAtMs < prior.bornAtMs) prior = v;
      }
      if (prior) releaseVoice(prior, deps.timeMs);
    }

    const slot = this.acquireSlot();
    if (!slot) return null;

    slot.active = true;
    slot.id = `v${++this.voiceSeq}`;
    slot.effectId = a.effectId;
    slot.playType = a.playType;
    slot.canvasScene = a.canvasScene;
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
    // A canvas play node's scene doc is authoritative: it hosts the scene's adapter id
    // (`canvas:<sceneId>`, resolved by the effects registry) through the SAME bridge path
    // a hosted generator takes — no dispatch fork (locked dec 7).
    slot.generatorId = a.mixInputs?.length
      ? (effect.generatorId ?? null)
      : a.canvasScene ? canvasEffectId(a.canvasScene) : (effect.generatorId ?? null);
    slot.genState = null;
    slot.mixInputs = a.mixInputs?.map((input, index): MixInput | null => {
      const inputEffect = deps.effectsById.get(input.effectId);
      if (!inputEffect) return null;
      const generatorId = input.canvasScene ? canvasEffectId(input.canvasScene) : inputEffect.generatorId;
      if (!generatorId) return null;
      return {
        generatorId,
        scope: input.scope,
        targetId: input.targetId,
        sourceDrumId,
        velocity,
        seed: deriveSeed(slot.seed, index + 1),
        params: { ...input.params },
        liveParams: {},
        specs: inputEffect.params,
        modulations: input.modulations,
        genState: null,
        modifiers: input.modifiers,
        modState: undefined,
        opacity: input.opacity,
        originNodeId: input.originNodeId,
      };
    }).filter((input): input is MixInput => input !== null);
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
    slot.mixBlendMode = a.mixBlendMode;
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
    slot.pad = deps.pad ?? '';
    slot.originNodeId = a.originNodeId;

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
    playType: undefined,
    canvasScene: undefined,
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
    mixBlendMode: undefined,
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
    mixInputs: undefined,
  };
}

const EMPTY_SPECS: ParamSpec[] = [];
