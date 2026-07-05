import { describe, expect, it } from 'vitest';
import { VoicePool, type SpawnDeps } from './voice-pool';
import type { PlayAction } from './eval-graph';
import type { Bus, EffectDef, ResolvedModifier } from './types';

// S25 — mono steal resets voice age. With voice timebase, a voice's animation clock is
// `timeMs - bornAtMs`, so a fast retrigger only "restarts" the effect if the reused/new
// voice gets a fresh bornAtMs. spawn() stamps `bornAtMs = deps.timeMs` on every spawn,
// including the mono-steal path; these tests lock that so retrigger-restart can't regress.

const monoBus: Bus = { id: 'lead', name: 'Lead', polyphony: 'mono', crossfadeMs: 0 };

const effect: EffectDef = {
  id: 'fx',
  name: 'fx',
  generatorId: 'chase',
  busId: 'lead',
  scope: 'kit',
  params: [],
  attackMs: 0,
  sustainMs: 1000,
  releaseMs: 100,
};

const action: PlayAction = {
  kind: 'play',
  effectId: 'fx',
  mode: 'oneshot',
  scope: 'kit',
  busId: '',
  params: {},
  via: '',
  latchKey: null,
};

const deps = (timeMs: number): SpawnDeps => ({
  effectsById: new Map([['fx', effect]]),
  busById: new Map([['lead', monoBus]]),
  latched: new Map(),
  timeMs,
});

describe('VoicePool — mono steal resets voice age (S25)', () => {
  it('a mono retrigger spawns a voice born at the retrigger time (its hit-relative clock restarts from 0)', () => {
    const pool = new VoicePool();

    const a = pool.spawn(action, null, 1, deps(0));
    expect(a).not.toBeNull();
    expect(a!.bornAtMs).toBe(0);
    expect(a!.phase).toBe('attack');

    // Retrigger on the same mono bus 1000ms later: the old voice is stolen (released) and a
    // fresh voice is born at 1000 — so age = timeMs - bornAtMs starts from 0, not 1000.
    const b = pool.spawn(action, null, 1, deps(1000));
    expect(b).not.toBeNull();
    expect(b!.bornAtMs).toBe(1000);
    expect(b!.phase).toBe('attack'); // fresh envelope
    expect(a!.phase).toBe('release'); // mono steal released the first voice
    expect(b!.id).not.toBe(a!.id); // distinct voice

    // Sanity: at any later time the two voices report different ages — the new one younger.
    const sampleAt = 1200;
    expect(sampleAt - b!.bornAtMs).toBe(200);
    expect(sampleAt - a!.bornAtMs).toBe(1200);
  });
});

// S28 — spawn carries the resolved modifier chain (the S29 graph→voice seam) and resets
// per-voice modifier state on (re)spawn so a reused pool slot never inherits a previous
// voice's accumulators (same lifecycle as genState).
describe('VoicePool — modifier chain plumbing (S28)', () => {
  const chain: ResolvedModifier[] = [{ modifierId: 'trail', params: { decayMs: 250, mode: 'add' } }];
  const withMods: PlayAction = { ...action, modifiers: chain };

  it('copies PlayAction.modifiers onto the spawned voice and starts with no modifier state', () => {
    const pool = new VoicePool();
    const v = pool.spawn(withMods, null, 1, deps(0));
    expect(v!.modifiers).toBe(chain);
    expect(v!.modState).toBeUndefined();
  });

  it('a spawn without modifiers leaves the voice unmodified (hot path)', () => {
    const pool = new VoicePool();
    const v = pool.spawn(action, null, 1, deps(0));
    expect(v!.modifiers).toBeUndefined();
    expect(v!.modState).toBeUndefined();
  });

  it('carries playType and hosts a canvas node\'s scene as a canvas:<sceneId> generator id (D3/D4)', () => {
    const pool = new VoicePool();
    const canvasAction: PlayAction = { ...action, playType: 'canvas', canvasScene: 'stripe-band' };
    const v = pool.spawn(canvasAction, null, 1, deps(0));
    expect(v!.playType).toBe('canvas');
    expect(v!.canvasScene).toBe('stripe-band');
    // The scene resolves through the SAME generatorId seam a hosted effect uses — the
    // compositor/bridge dispatch never forks on playType.
    expect(v!.generatorId).toBe('canvas:stripe-band');

    // A reused slot never inherits the previous voice's canvas identity.
    v!.active = false;
    const w = pool.spawn(action, null, 1, deps(50));
    expect(w).toBe(v);
    expect(w!.playType).toBeUndefined();
    expect(w!.canvasScene).toBeUndefined();
    expect(w!.generatorId).toBe('chase');
  });

  it('reusing a pool slot clears the previous voice\'s modifier state', () => {
    const pool = new VoicePool();
    const a = pool.spawn(withMods, null, 1, deps(0));
    a!.modState = [{ some: 'accumulator' }]; // simulate state built during the voice's life
    a!.active = false; // free the slot so acquireSlot reuses it
    const b = pool.spawn(action, null, 1, deps(100));
    expect(b).toBe(a); // same reused slot
    expect(b!.modifiers).toBeUndefined(); // no chain on the new voice
    expect(b!.modState).toBeUndefined(); // stale accumulators cleared
  });
});
