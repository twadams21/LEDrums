import { describe, expect, it } from 'vitest';
import { selectDockVoices, voiceStatToDockVoice } from './dock-voices';
import type { VoiceStat } from '../ws/protocol-types';

/* S17 — the Layers dock voice source-selection. Pure: no store, no Svelte. The dock's authority
   rule mirrors the firing gate (doc 03 / S12) — connected ⇒ the server engine's streamed voices
   are the truth (the Sim no longer fires), offline ⇒ the Sim engine's voices. */

/** A wire VoiceStat with sane defaults (levels already folded by the engine). */
function stat(over: Partial<VoiceStat> = {}): VoiceStat {
  return { id: 'v1', busId: '@effect-chain', effectId: '@chain:solid', mode: 'oneshot', level: 0.4, hue: 120, releasing: false, via: 'Effect: Pulse', pad: '', ...over };
}

describe('selectDockVoices — source selection', () => {
  it('offline: reads the Sim voices and ignores any server voices', () => {
    const out = selectDockVoices({ connected: false, simVoices: [stat({ via: 'sim-via' })], serverVoices: [stat({ via: 'server-via' })] });
    expect(out.map((v) => v.via)).toEqual(['sim-via']);
  });

  it('connected: the server voices show and the Sim voices never do', () => {
    const out = selectDockVoices({ connected: true, simVoices: [stat({ via: 'sim-via' })], serverVoices: [stat({ via: 'server-via' })] });
    expect(out.map((v) => v.via)).toEqual(['server-via']);
  });

  it('connected with no server voices shows nothing, even while the Sim still holds voices', () => {
    expect(selectDockVoices({ connected: true, simVoices: [stat(), stat({ id: 'v2' })], serverVoices: [] })).toEqual([]);
  });
});

describe('voiceStatToDockVoice', () => {
  it('adopts the pre-folded engine fields verbatim', () => {
    expect(voiceStatToDockVoice(stat({ level: 0.4, hue: 120, releasing: true, mode: 'hold' }))).toEqual({
      id: 'v1',
      busId: '@effect-chain',
      effectId: '@chain:solid',
      mode: 'hold',
      level: 0.4,
      hue: 120,
      releasing: true,
      via: 'Effect: Pulse',
    });
  });
});
