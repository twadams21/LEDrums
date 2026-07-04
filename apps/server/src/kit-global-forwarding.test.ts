import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '@ledrums/core';
import { applyClientMessage } from './input-router';
import { propagateToVoiceHost } from './handlers/voice-input';
import type { VoiceEngineHost } from './voice-engine-host';
import type { ClientMessage } from './ws-protocol';

/* S11: a kit-global `setKitGlobal` (mirror) must reach BOTH server paths that own a live
   render — the legacy reducer (`applyClientMessage` → engine.setKitGlobal) and the voice
   bridge (`propagateToVoiceHost` → voiceHost.setKitGlobal) — so mirror applies live on either
   host. Mirror is kit-global (not per-drum), so it rides its own message, not setKitTransform.
   Undefined fields must NOT be forwarded (partial-merge shape). */

const msg = (extra: Partial<Extract<ClientMessage, { t: 'setKitGlobal' }>>): ClientMessage => ({
  t: 'setKitGlobal',
  ...extra,
});

describe('legacy engine path — applyClientMessage(setKitGlobal)', () => {
  it('forwards mirror to engine.setKitGlobal', () => {
    const setKitGlobal = vi.fn();
    const engine = { setKitGlobal } as unknown as Engine;
    applyClientMessage(engine, msg({ mirror: 'x' }), 0);
    expect(setKitGlobal).toHaveBeenCalledWith({ mirror: 'x' });
  });

  it('omits undefined fields (an empty kit-global edit forwards nothing)', () => {
    const setKitGlobal = vi.fn();
    const engine = { setKitGlobal } as unknown as Engine;
    applyClientMessage(engine, msg({}), 0);
    expect(setKitGlobal).toHaveBeenCalledWith({});
  });
});

describe('voice host path — propagateToVoiceHost(setKitGlobal)', () => {
  it('forwards mirror to voiceHost.setKitGlobal', () => {
    const setKitGlobal = vi.fn();
    const host = { setKitGlobal } as unknown as VoiceEngineHost;
    propagateToVoiceHost(host, msg({ mirror: 'y' }));
    expect(setKitGlobal).toHaveBeenCalledWith({ mirror: 'y' });
  });

  it("forwards mirror:'none' explicitly (clearing the mirror is a real edit)", () => {
    const setKitGlobal = vi.fn();
    const host = { setKitGlobal } as unknown as VoiceEngineHost;
    propagateToVoiceHost(host, msg({ mirror: 'none' }));
    expect(setKitGlobal).toHaveBeenCalledWith({ mirror: 'none' });
  });
});
