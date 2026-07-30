import { describe, expect, it } from 'vitest';
import { selectDockVoices, serverVoiceToDockVoice } from './dock-voices';
import type { VoiceStat } from '../ws/protocol-types';

/* S17 — the Layers/Buses dock voice source. Pure: no store, no Svelte. There is ONE source, the
   engine's streamed voices (doc 03 / S12 authority rule; INIT-01 Decision 3 retired the offline sim
   that used to be the second one). Connected ⇒ the engine's voices; disconnected ⇒ nothing, because
   a dock with no engine has no voices and a frozen last-known list would read as live. */

/** A wire VoiceStat with sane defaults (levels already folded server-side). */
function serverVoice(over: Partial<VoiceStat> = {}): VoiceStat {
  return { id: 'srv1', busId: 'trigger', effectId: 'sparkle', mode: 'oneshot', level: 0.4, hue: 120, releasing: false, via: 'server-via', ...over };
}

describe('selectDockVoices — the engine is the only source', () => {
  it('connected: the engine-spawned voices are what the dock shows', () => {
    const out = selectDockVoices({ connected: true, serverVoices: [serverVoice({ effectId: 'aurora', busId: 'base' })] });
    expect(out).toHaveLength(1);
    expect(out[0]!.effectId).toBe('aurora');
    expect(out[0]!.busId).toBe('base');
    expect(out[0]!.via).toBe('server-via');
  });

  it('connected with no engine voices shows nothing', () => {
    expect(selectDockVoices({ connected: true, serverVoices: [] })).toEqual([]);
  });

  it('disconnected shows nothing — never the last voices the engine reported', () => {
    // The drop path clears `serverVoices`, but the gate must hold even if a caller passes a stale
    // list: with the link down there is no renderer, so there is nothing sounding to draw.
    const out = selectDockVoices({ connected: false, serverVoices: [serverVoice(), serverVoice({ id: 'srv2' })] });
    expect(out).toEqual([]);
  });
});

describe('voice → DockVoice mapping', () => {
  it('serverVoiceToDockVoice adopts the pre-folded server fields verbatim', () => {
    const dv = serverVoiceToDockVoice(serverVoice({ level: 0.4, hue: 120, releasing: true, mode: 'hold' }));
    expect(dv).toEqual({ id: 'srv1', busId: 'trigger', effectId: 'sparkle', mode: 'hold', level: 0.4, hue: 120, releasing: true, via: 'server-via' });
  });

  it('marks a non-releasing voice live and keeps its bus/mode for the chip', () => {
    const dv = serverVoiceToDockVoice(serverVoice({ releasing: false, mode: 'loop', busId: 'base' }));
    expect(dv.releasing).toBe(false);
    expect(dv.mode).toBe('loop');
    expect(dv.busId).toBe('base');
  });
});
