import { describe, expect, it, vi } from 'vitest';
import { applyStructuralMessage } from './handlers/voice-input';
import type { VoiceEngineHost } from './voice-engine-host';
import type { ClientMessage } from './ws-protocol';

/* A kit-global `setKitGlobal` (the C1/C2 Advatek/kit config) reaches the live render through THE
   reducer (`applyStructuralMessage` → voiceHost.setKitGlobal). These are kit-wide, not per-drum, so
   they ride their own message rather than setKitTransform. Undefined fields must NOT be forwarded
   (partial-merge shape). */

const msg = (extra: Partial<Extract<ClientMessage, { t: 'setKitGlobal' }>>): ClientMessage => ({
  t: 'setKitGlobal',
  ...extra,
});

/**
 * S12 deleted the legacy half of this file: a describe that drove the same message through
 * `applyClientMessage` → `Engine.setKitGlobal` and asserted the identical partial-merge shape. Two
 * arms was the finding; the surviving one below is the whole reducer.
 */
describe('voice reducer (sole writer since S8) — applyStructuralMessage(setKitGlobal)', () => {
  it('forwards the C1/C2 kit-global fields to the live voice host', () => {
    const setKitGlobal = vi.fn();
    const host = { setKitGlobal } as unknown as VoiceEngineHost;
    applyStructuralMessage(host, msg({ expanded: true, ledDensityPxPerM: 96, hoopCount: 6, defaultHoopSpacingMm: 40, maxPixelsPerOutput: 340 }));
    expect(setKitGlobal).toHaveBeenCalledWith({ expanded: true, ledDensityPxPerM: 96, hoopCount: 6, defaultHoopSpacingMm: 40, maxPixelsPerOutput: 340 });
  });
});
