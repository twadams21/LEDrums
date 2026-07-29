import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '@ledrums/core';
import { applyClientMessage } from './input-router';
import { propagateToVoiceHost } from './handlers/voice-input';
import type { VoiceEngineHost } from './voice-engine-host';
import type { ClientMessage } from './ws-protocol';

/* A kit-global `setKitGlobal` (the C1/C2 Advatek/kit config) must reach BOTH server paths that
   own a live render — the legacy reducer (`applyClientMessage` → engine.setKitGlobal) and the
   voice bridge (`propagateToVoiceHost` → voiceHost.setKitGlobal) — so the edit applies live on
   either host. These are kit-wide, not per-drum, so they ride their own message rather than
   setKitTransform. Undefined fields must NOT be forwarded (partial-merge shape). */

const msg = (extra: Partial<Extract<ClientMessage, { t: 'setKitGlobal' }>>): ClientMessage => ({
  t: 'setKitGlobal',
  ...extra,
});

describe('legacy engine path — applyClientMessage(setKitGlobal)', () => {
  it('omits undefined fields (an empty kit-global edit forwards nothing)', () => {
    const setKitGlobal = vi.fn();
    const engine = { setKitGlobal } as unknown as Engine;
    applyClientMessage(engine, msg({}), 0);
    expect(setKitGlobal).toHaveBeenCalledWith({});
  });

  it('forwards the C1/C2 kit-global fields (expanded + the four Advatek/kit globals)', () => {
    const setKitGlobal = vi.fn();
    const engine = { setKitGlobal } as unknown as Engine;
    applyClientMessage(engine, msg({ expanded: true, ledDensityPxPerM: 72, hoopCount: 5, defaultHoopSpacingMm: 45, maxPixelsPerOutput: 300 }), 0);
    expect(setKitGlobal).toHaveBeenCalledWith({ expanded: true, ledDensityPxPerM: 72, hoopCount: 5, defaultHoopSpacingMm: 45, maxPixelsPerOutput: 300 });
  });

  it('forwards expanded:false explicitly (turning off expanded mode is a real edit)', () => {
    const setKitGlobal = vi.fn();
    const engine = { setKitGlobal } as unknown as Engine;
    applyClientMessage(engine, msg({ expanded: false }), 0);
    expect(setKitGlobal).toHaveBeenCalledWith({ expanded: false });
  });
});

describe('voice host path — propagateToVoiceHost(setKitGlobal)', () => {
  it('forwards the C1/C2 kit-global fields to the live voice host', () => {
    const setKitGlobal = vi.fn();
    const host = { setKitGlobal } as unknown as VoiceEngineHost;
    propagateToVoiceHost(host, msg({ expanded: true, ledDensityPxPerM: 96, hoopCount: 6, defaultHoopSpacingMm: 40, maxPixelsPerOutput: 340 }));
    expect(setKitGlobal).toHaveBeenCalledWith({ expanded: true, ledDensityPxPerM: 96, hoopCount: 6, defaultHoopSpacingMm: 40, maxPixelsPerOutput: 340 });
  });
});
