import { describe, expect, it } from 'vitest';
import { deriveOutputPill, type LinkState } from './output-pill';
import type { OutputStatus } from '../../ws/protocol-types';

/** OutputStatus fixture — armed + no error by default; override per case. */
function status(overrides: Partial<OutputStatus> = {}): OutputStatus {
  return {
    state: 'armed',
    protocol: 'artnet',
    host: '192.168.1.50',
    packetsSent: 0,
    lastError: null,
    universeCount: 4,
    ...overrides,
  };
}

describe('deriveOutputPill', () => {
  const cases: Array<{
    name: string;
    link: LinkState;
    output: OutputStatus | null;
    tone: string;
    label: string;
    pulse: boolean;
    titleIncludes?: string;
  }> = [
    // Link-closed family — output is ignored while the link isn't open.
    { name: 'offline → LOCAL (muted, steady)', link: 'offline', output: null, tone: 'muted', label: 'LOCAL', pulse: false },
    { name: 'connecting → SYNC (warn, pulse)', link: 'connecting', output: null, tone: 'warn', label: 'SYNC', pulse: true },
    { name: 'open but no output yet → SYNC', link: 'open', output: null, tone: 'warn', label: 'SYNC', pulse: true },

    // Live + transmitting.
    { name: 'armed + packets, no error → LIVE (live, steady)', link: 'open', output: status({ state: 'armed', packetsSent: 42 }), tone: 'live', label: 'LIVE', pulse: false, titleIncludes: 'artnet' },

    // Armed-but-erroring: error tone + last error in the tooltip, and NOT live.
    { name: 'armed + packets + error → ERR (live, pulse, tooltip)', link: 'open', output: status({ state: 'armed', packetsSent: 42, lastError: 'EHOSTUNREACH 192.168.1.50:6454' }), tone: 'live', label: 'ERR', pulse: true, titleIncludes: 'EHOSTUNREACH 192.168.1.50:6454' },

    // Armed but nothing on the wire yet — honestly not live.
    { name: 'armed, no packets → ARMED (warn, pulse)', link: 'open', output: status({ state: 'armed', packetsSent: 0 }), tone: 'warn', label: 'ARMED', pulse: true },

    // Dry-run and disabled shown honestly.
    { name: 'dry-run → DRY (warn, steady)', link: 'open', output: status({ state: 'dry-run' }), tone: 'warn', label: 'DRY', pulse: false },
    { name: 'disabled → OFF (muted, steady)', link: 'open', output: status({ state: 'disabled' }), tone: 'muted', label: 'OFF', pulse: false },

    // Error overrides even dry-run / disabled states.
    { name: 'dry-run + error → ERR', link: 'open', output: status({ state: 'dry-run', lastError: 'send failed: EACCES' }), tone: 'live', label: 'ERR', pulse: true, titleIncludes: 'EACCES' },
    { name: 'disabled + error → ERR', link: 'open', output: status({ state: 'disabled', lastError: 'bind failed' }), tone: 'live', label: 'ERR', pulse: true, titleIncludes: 'bind failed' },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const v = deriveOutputPill(c.link, c.output);
      expect(v.tone).toBe(c.tone);
      expect(v.label).toBe(c.label);
      expect(v.pulse).toBe(c.pulse);
      if (c.titleIncludes) expect(v.title).toContain(c.titleIncludes);
    });
  }

  it('singularises the universe count in the LIVE tooltip', () => {
    expect(deriveOutputPill('open', status({ state: 'armed', packetsSent: 1, universeCount: 1 })).title).toContain('1 universe');
    expect(deriveOutputPill('open', status({ state: 'armed', packetsSent: 1, universeCount: 4 })).title).toContain('4 universes');
  });

  // --- Invariant: "LIVE" is impossible unless open + armed + packets>0 + no error.
  it('never shows LIVE while lastError is set', () => {
    for (const state of ['armed', 'dry-run', 'disabled'] as const) {
      const v = deriveOutputPill('open', status({ state, packetsSent: 10_000, lastError: 'x' }));
      expect(v.label).not.toBe('LIVE');
    }
  });

  it('never shows LIVE while packets are not flowing', () => {
    const v = deriveOutputPill('open', status({ state: 'armed', packetsSent: 0, lastError: null }));
    expect(v.label).not.toBe('LIVE');
  });

  it('never shows LIVE while the link is not open', () => {
    for (const link of ['offline', 'connecting'] as const) {
      const v = deriveOutputPill(link, status({ state: 'armed', packetsSent: 10_000 }));
      expect(v.label).not.toBe('LIVE');
    }
  });
});
