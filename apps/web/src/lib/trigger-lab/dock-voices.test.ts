import { describe, expect, it } from 'vitest';
import { selectDockVoices, simVoiceToDockVoice, serverVoiceToDockVoice } from './dock-voices';
import type { Voice } from './sim';
import type { VoiceStat } from '../ws/protocol-types';

/* S17 — the Layers/Buses dock voice source-selection. Pure: no store, no Svelte. The dock's
   authority rule mirrors the firing gate (doc 03 / S12) — connected ⇒ the server engine's streamed
   voices are the truth (the sim no longer fires), offline ⇒ the local sim's voices. */

/** A full sim Voice with sane defaults; override only the fields under test. */
function simVoice(over: Partial<Voice> = {}): Voice {
  return {
    id: 'sv1',
    effectId: 'flash',
    pattern: 'flash',
    busId: 'base',
    mode: 'loop',
    scope: 'kit',
    sourceDrumId: null,
    velocity: 1,
    seed: 0,
    params: { hue: 200 },
    attackMs: 0,
    sustainMs: 0,
    releaseMs: 0,
    phase: 'sustain',
    level: 0.5,
    bornAtMs: 0,
    releaseAtMs: null,
    releaseFromLevel: 0,
    via: 'sim-via',
    deckGain: 0.8,
    ...over,
  };
}

/** A wire VoiceStat with sane defaults (levels already folded server-side). */
function serverVoice(over: Partial<VoiceStat> = {}): VoiceStat {
  return { id: 'srv1', busId: 'trigger', effectId: 'sparkle', mode: 'oneshot', level: 0.4, hue: 120, releasing: false, via: 'server-via', ...over };
}

describe('selectDockVoices — source selection', () => {
  it('offline: reads the local sim voices and ignores any server voices', () => {
    const out = selectDockVoices({ connected: false, simVoices: [simVoice()], serverVoices: [serverVoice()] });
    expect(out).toHaveLength(1);
    expect(out[0]!.via).toBe('sim-via');
    expect(out[0]!.effectId).toBe('flash');
  });

  it('connected: a server-spawned voice appears; stale local sim voices never show', () => {
    const out = selectDockVoices({
      connected: true,
      simVoices: [simVoice({ id: 'stale', effectId: 'flash', via: 'sim-via' })],
      serverVoices: [serverVoice({ effectId: 'aurora', busId: 'base' })],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.effectId).toBe('aurora');
    expect(out[0]!.busId).toBe('base');
    expect(out.some((v) => v.via === 'sim-via')).toBe(false);
  });

  it('connected with no server voices shows nothing, even while the sim still holds voices', () => {
    // The S12 interim state: the sim may still carry stale look voices, but connected the dock is
    // server-truth — so an empty server list means an empty dock (no local sim voice leaks through).
    const out = selectDockVoices({ connected: true, simVoices: [simVoice(), simVoice({ id: 'sv2' })], serverVoices: [] });
    expect(out).toEqual([]);
  });
});

describe('voice → DockVoice mapping', () => {
  it('simVoiceToDockVoice folds level*deckGain, defaults absent hue to 0, and maps the release phase', () => {
    const dv = simVoiceToDockVoice(simVoice({ level: 0.5, deckGain: 0.5, params: {}, phase: 'release' }));
    expect(dv.level).toBeCloseTo(0.25);
    expect(dv.hue).toBe(0);
    expect(dv.releasing).toBe(true);
  });

  it('simVoiceToDockVoice passes a numeric hue through and marks non-release voices live', () => {
    const dv = simVoiceToDockVoice(simVoice({ params: { hue: 200 }, phase: 'attack' }));
    expect(dv.hue).toBe(200);
    expect(dv.releasing).toBe(false);
  });

  it('serverVoiceToDockVoice adopts the pre-folded server fields verbatim', () => {
    const dv = serverVoiceToDockVoice(serverVoice({ level: 0.4, hue: 120, releasing: true, mode: 'hold' }));
    expect(dv).toEqual({ id: 'srv1', busId: 'trigger', effectId: 'sparkle', mode: 'hold', level: 0.4, hue: 120, releasing: true, via: 'server-via' });
  });
});
