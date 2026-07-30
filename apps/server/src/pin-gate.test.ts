import { describe, expect, it } from 'vitest';
import { WS_CLOSE_INVALID_PIN, WS_CLOSE_PIN_THROTTLED } from '@ledrums/protocol';
import { createAdmissionThrottle, type ThrottlePolicy } from './admission-throttle';
import {
  createMutablePinGate,
  admitDecision,
  type AdmitContext,
  createPinGate,
  generateHostToken,
  generatePin,
  hostTokenFromUrl,
  isLoopbackAddress,
  isTrustedHost,
  isViaCloudflare,
  MIN_HOST_TOKEN_LENGTH,
  MIN_PIN_LENGTH,
  pinFromUrl,
  resolveHostToken,
  resolvePin,
} from './pin-gate';

describe('createPinGate', () => {
  it('an open gate (null pin) admits everything, including absent/empty', () => {
    const gate = createPinGate(null);
    expect(gate.pin).toBeNull();
    expect(gate.check('whatever')).toBe(true);
    expect(gate.check(null)).toBe(true);
    expect(gate.check(undefined)).toBe(true);
    expect(gate.check('')).toBe(true);
  });

  it('a configured gate admits only the exact PIN', () => {
    const gate = createPinGate('4242');
    expect(gate.check('4242')).toBe(true);
    expect(gate.check('4243')).toBe(false); // wrong
    expect(gate.check('')).toBe(false); // empty
    expect(gate.check(null)).toBe(false); // absent
    expect(gate.check(undefined)).toBe(false);
    expect(gate.check('4242 ')).toBe(false); // no trimming — exact match
  });

  it('compares multi-byte input without throwing (constant-time swap is total)', () => {
    // timingSafeEqual throws on unequal-length buffers, and a multi-byte char makes BYTE length
    // diverge from code-unit length — so this is the case a naive Buffer compare gets wrong.
    const gate = createPinGate('4242');
    expect(gate.check('424é')).toBe(false);
    expect(gate.check('éééé')).toBe(false);
    expect(createPinGate('café').check('café')).toBe(true);
  });
});

describe('pinFromUrl', () => {
  it('reads the pin query param from a connect URL', () => {
    expect(pinFromUrl('/ws?pin=1234')).toBe('1234');
    expect(pinFromUrl('/ws?foo=bar&pin=9999')).toBe('9999');
  });
  it('is null when absent or unparseable', () => {
    expect(pinFromUrl('/ws')).toBeNull();
    expect(pinFromUrl(undefined)).toBeNull();
    expect(pinFromUrl('')).toBeNull();
  });
});

describe('admitDecision', () => {
  it('admits when the gate is open regardless of URL', () => {
    expect(admitDecision('/ws', createPinGate(null))).toEqual({ ok: true });
    expect(admitDecision(undefined, createPinGate(null))).toEqual({ ok: true });
  });

  it('admits a correct PIN and refuses a wrong/absent one with the invalid-pin close code', () => {
    const gate = createPinGate('1234');
    expect(admitDecision('/ws?pin=1234', gate)).toEqual({ ok: true });
    expect(admitDecision('/ws?pin=0000', gate)).toEqual({ ok: false, code: WS_CLOSE_INVALID_PIN, reason: 'invalid pin' });
    expect(admitDecision('/ws', gate)).toEqual({ ok: false, code: WS_CLOSE_INVALID_PIN, reason: 'invalid pin' });
  });

  it('trustedLocal bypasses the PIN entirely (the host on its own machine)', () => {
    const gate = createPinGate('1234');
    expect(admitDecision('/ws', gate, { trustedLocal: true })).toEqual({ ok: true });
    expect(admitDecision('/ws?pin=9999', gate, { trustedLocal: true })).toEqual({ ok: true });
  });

  it('a non-trusted connection is still gated even without a PIN', () => {
    const gate = createPinGate('1234');
    expect(admitDecision('/ws', gate, { trustedLocal: false })).toEqual({ ok: false, code: WS_CLOSE_INVALID_PIN, reason: 'invalid pin' });
  });
});

describe('admitDecision — throttled admission', () => {
  const PIN = '1234';
  const PEER = 'cf:198.51.100.4';

  /** A gate + throttle over a hand-driven clock, plus the one call the live path makes. */
  function setup(policy: Partial<ThrottlePolicy> = {}) {
    let t = 0;
    const gate = createPinGate(PIN);
    const throttle = createAdmissionThrottle(policy, () => t);
    return {
      throttle,
      advance: (ms: number) => {
        t += ms;
      },
      dial: (pin: string | null, over: Partial<AdmitContext> = {}) =>
        admitDecision(pin === null ? '/ws' : `/ws?pin=${pin}`, gate, { throttle, peerKey: PEER, ...over }),
    };
  }

  const THROTTLED = (seconds: number) => ({
    ok: false,
    code: WS_CLOSE_PIN_THROTTLED,
    reason: `too many attempts; retry in ${seconds}s`,
  });

  it('THE FINDING: after the allowance, even the CORRECT PIN is refused until the cooldown lapses', () => {
    const { dial, advance } = setup();
    for (let i = 0; i < 5; i++) {
      expect(dial('0000')).toMatchObject({ ok: false, code: WS_CLOSE_INVALID_PIN });
    }
    // The 6th wrong PIN escalates — still an honest "invalid pin", with the alert riding along.
    expect(dial('0000')).toMatchObject({
      ok: false,
      code: WS_CLOSE_INVALID_PIN,
      alert: { scope: 'peer', key: PEER, failures: 6, cooldownMs: 1_000 },
    });
    // ...and now the correct PIN is refused too, with the honest code and reason.
    expect(dial(PIN)).toEqual(THROTTLED(1));
    advance(1_001);
    expect(dial(PIN)).toEqual({ ok: true }); // no permanent lockout
  });

  it('a throttled refusal never compares the PIN — that is what makes the cooldown a control', () => {
    const { dial, advance } = setup();
    for (let i = 0; i < 6; i++) dial('0000');
    // Both a right and a wrong PIN get the SAME answer while cooling: the gate was never consulted.
    expect(dial(PIN)).toEqual(THROTTLED(1));
    expect(dial('9999')).toEqual(THROTTLED(1));
    // And the in-cooldown attempts did not extend the cooldown (no re-escalation).
    advance(1_001);
    expect(dial(PIN)).toEqual({ ok: true });
  });

  it('carries the escalating wait in the close reason, so the overlay can be honest about it', () => {
    const { dial, advance } = setup();
    for (let i = 0; i < 6; i++) dial('0000');
    expect(dial(PIN)).toEqual(THROTTLED(1));
    advance(1_001);
    expect(dial('0000')).toMatchObject({ alert: { cooldownMs: 2_000 } });
    expect(dial(PIN)).toEqual(THROTTLED(2));
    advance(2_001);
    expect(dial('0000')).toMatchObject({ alert: { cooldownMs: 4_000 } });
    expect(dial(PIN)).toEqual(THROTTLED(4));
  });

  it('the trusted host is neither throttled nor charged, however often it is wrong', () => {
    const { dial, throttle } = setup();
    for (let i = 0; i < 50; i++) {
      expect(dial('0000', { trustedLocal: true })).toEqual({ ok: true });
    }
    expect(throttle.allow(PEER)).toEqual({ ok: true });
    expect(throttle.size()).toBe(0); // not even a bucket was opened
  });

  it('an OPEN gate records nothing at all — a local dev server can never refuse anyone', () => {
    let t = 0;
    const throttle = createAdmissionThrottle({}, () => t);
    const open = createPinGate(null);
    for (let i = 0; i < 50; i++) {
      expect(admitDecision('/ws?pin=whatever', open, { throttle, peerKey: PEER })).toEqual({ ok: true });
    }
    expect(throttle.size()).toBe(0);
    // Not even a global-tier lockout driven by other peers can close an open gate.
    for (let i = 0; i < 200; i++) throttle.recordFailure(`cf:203.0.113.${i % 200}`);
    expect(admitDecision('/ws', open, { throttle, peerKey: 'cf:192.0.2.9' })).toEqual({ ok: true });
  });

  it('a successful admission exempts the peer from the global tier thereafter', () => {
    const { dial, throttle } = setup();
    expect(dial(PIN)).toEqual({ ok: true }); // recordSuccess → known-good for this run
    for (let i = 0; i < 100; i++) throttle.recordFailure(`cf:203.0.113.${i}`); // trip the global tier
    expect(throttle.allow('cf:192.0.2.9').ok).toBe(false); // a first-time peer is locked out…
    expect(dial(PIN)).toEqual({ ok: true }); // …but the drummer who already connected is not
  });

  it('a peer under the GLOBAL tier is refused with the throttled code, not "incorrect PIN"', () => {
    const { dial, throttle } = setup();
    for (let i = 0; i < 100; i++) throttle.recordFailure(`cf:203.0.113.${i}`);
    expect(dial(PIN)).toEqual(THROTTLED(60));
  });

  it('is byte-identical to the pre-throttle behaviour when no throttle is supplied', () => {
    const gate = createPinGate(PIN);
    const refused = { ok: false, code: WS_CLOSE_INVALID_PIN, reason: 'invalid pin' };
    for (let i = 0; i < 20; i++) {
      expect(admitDecision('/ws?pin=0000', gate, {})).toEqual(refused);
      expect(admitDecision('/ws?pin=0000', gate, { peerKey: PEER })).toEqual(refused); // key alone is inert
    }
    expect(admitDecision(`/ws?pin=${PIN}`, gate, {})).toEqual({ ok: true });
    expect(admitDecision('/ws?pin=0000', gate)).toEqual(refused); // and with no ctx at all
  });
});

describe('hostTokenFromUrl', () => {
  it('reads the hostToken query param from a connect URL', () => {
    expect(hostTokenFromUrl('/ws?hostToken=abc123')).toBe('abc123');
    expect(hostTokenFromUrl('/ws?pin=1&hostToken=deadbeef')).toBe('deadbeef');
  });
  it('is null when absent or unparseable', () => {
    expect(hostTokenFromUrl('/ws?pin=1')).toBeNull();
    expect(hostTokenFromUrl('/ws')).toBeNull();
    expect(hostTokenFromUrl(undefined)).toBeNull();
  });
});

describe('generateHostToken', () => {
  it('produces a long high-entropy hex token, distinct each call', () => {
    const a = generateHostToken();
    const b = generateHostToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/); // 32 bytes → 64 hex chars
    expect(a).not.toBe(b);
  });
});

describe('resolveHostToken', () => {
  // #139: the desktop shell mints the token and injects it at spawn, so it holds the token before
  // the sidecar has printed anything — that is what lets the MIDI port come up on "listening"
  // alone instead of being gated on scraping a conditional banner line.
  it('prefers a strong injected token over minting one', () => {
    const injected = 'a'.repeat(64);
    expect(resolveHostToken({ LEDRUMS_HOST_TOKEN: injected })).toBe(injected);
  });

  it('trims surrounding whitespace on an injected token', () => {
    const injected = 'b'.repeat(64);
    expect(resolveHostToken({ LEDRUMS_HOST_TOKEN: `  ${injected}  ` })).toBe(injected);
  });

  it('accepts an injected token exactly at the minimum length', () => {
    const injected = 'c'.repeat(MIN_HOST_TOKEN_LENGTH);
    expect(resolveHostToken({ LEDRUMS_HOST_TOKEN: injected })).toBe(injected);
  });

  it('mints its own when nothing is injected', () => {
    expect(resolveHostToken({})).toMatch(/^[0-9a-f]{64}$/);
  });

  it('IGNORES a weak injected token and mints a strong one instead', () => {
    // Fail-closed on strength: a short injected value must never widen the PIN bypass.
    const weak = 'short';
    const resolved = resolveHostToken({ LEDRUMS_HOST_TOKEN: weak });
    expect(resolved).not.toBe(weak);
    expect(resolved).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores an empty or whitespace-only injected token', () => {
    expect(resolveHostToken({ LEDRUMS_HOST_TOKEN: '' })).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveHostToken({ LEDRUMS_HOST_TOKEN: '   ' })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns null, so the host bypass is always available to a caller holding the token', () => {
    expect(resolveHostToken({})).toBeTruthy();
  });
});

describe('isTrustedHost', () => {
  const TOKEN = 'a'.repeat(64);
  const base = {
    remoteAddress: '127.0.0.1',
    headers: {} as Record<string, string | string[] | undefined>,
    url: `/ws?hostToken=${TOKEN}`,
    hostToken: TOKEN,
  };

  it('trusts the host app session: loopback + no cloudflare + correct token', () => {
    expect(isTrustedHost(base)).toBe(true);
    expect(isTrustedHost({ ...base, remoteAddress: '::ffff:127.0.0.1' })).toBe(true);
  });

  it('rejects loopback with no token supplied', () => {
    expect(isTrustedHost({ ...base, url: '/ws' })).toBe(false);
  });

  it('rejects loopback with a wrong token', () => {
    expect(isTrustedHost({ ...base, url: `/ws?hostToken=${'b'.repeat(64)}` })).toBe(false);
    expect(isTrustedHost({ ...base, url: '/ws?hostToken=short' })).toBe(false);
  });

  it('rejects a cloudflare-forwarded request even with the correct token', () => {
    expect(isTrustedHost({ ...base, headers: { 'cf-connecting-ip': '1.2.3.4' } })).toBe(false);
    expect(isTrustedHost({ ...base, headers: { 'cdn-loop': 'cloudflare; loops=1' } })).toBe(false);
  });

  it('rejects a non-loopback (LAN) peer even with the correct token', () => {
    expect(isTrustedHost({ ...base, remoteAddress: '192.168.1.50' })).toBe(false);
    expect(isTrustedHost({ ...base, remoteAddress: undefined })).toBe(false);
  });

  it('is disabled (always false) when the server minted no token', () => {
    expect(isTrustedHost({ ...base, hostToken: null })).toBe(false);
  });
});

describe('host bypass end-to-end (isTrustedHost → admitDecision)', () => {
  const TOKEN = 'c'.repeat(64);
  const gate = createPinGate('1234');
  const decide = (over: {
    remoteAddress?: string;
    headers?: Record<string, string | string[] | undefined>;
    url: string;
  }) =>
    admitDecision(over.url, gate, {
      trustedLocal: isTrustedHost({
        remoteAddress: over.remoteAddress ?? '127.0.0.1',
        headers: over.headers ?? {},
        url: over.url,
        hostToken: TOKEN,
      }),
    });
  const refused = { ok: false, code: WS_CLOSE_INVALID_PIN, reason: 'invalid pin' };

  it('admits the intended host app session without a room PIN', () => {
    expect(decide({ url: `/ws?hostToken=${TOKEN}` })).toEqual({ ok: true });
  });

  it('refuses loopback with no PIN and no host token', () => {
    expect(decide({ url: '/ws' })).toEqual(refused);
  });

  it('refuses loopback with a wrong host token (and no PIN)', () => {
    expect(decide({ url: `/ws?hostToken=${'d'.repeat(64)}` })).toEqual(refused);
  });

  it('refuses a cloudflare-forwarded peer with the host token but no/incorrect PIN, admits with the PIN', () => {
    const cf = { 'cf-connecting-ip': '1.2.3.4' };
    expect(decide({ url: `/ws?hostToken=${TOKEN}`, headers: cf })).toEqual(refused);
    expect(decide({ url: `/ws?hostToken=${TOKEN}&pin=1234`, headers: cf })).toEqual({ ok: true });
  });

  it('refuses a LAN peer without a PIN, admits with the PIN', () => {
    expect(decide({ url: '/ws', remoteAddress: '192.168.1.50' })).toEqual(refused);
    expect(decide({ url: '/ws?pin=1234', remoteAddress: '192.168.1.50' })).toEqual({ ok: true });
  });
});

describe('isLoopbackAddress', () => {
  it('recognizes loopback forms and rejects others', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.50')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});

describe('isViaCloudflare', () => {
  it('detects cloudflared forwarding headers', () => {
    expect(isViaCloudflare({ 'cf-connecting-ip': '180.181.248.71' })).toBe(true);
    expect(isViaCloudflare({ 'cdn-loop': 'cloudflare; loops=1' })).toBe(true);
  });
  it('is false for a direct connection with no cf-* headers', () => {
    expect(isViaCloudflare({ host: '127.0.0.1:4178', connection: 'keep-alive' })).toBe(false);
    expect(isViaCloudflare({})).toBe(false);
  });
});

describe('resolvePin', () => {
  it('uses an explicit LEDRUMS_PIN when set (tunnel or not)', () => {
    expect(resolvePin({ LEDRUMS_PIN: 'secret' }, false)).toBe('secret');
    expect(resolvePin({ LEDRUMS_PIN: 'secret' }, true)).toBe('secret');
    expect(resolvePin({ LEDRUMS_PIN: '  spaced  ' }, false)).toBe('spaced');
  });

  it('generates a PIN when the tunnel is enabled and none is set', () => {
    const pin = resolvePin({}, true);
    expect(pin).toMatch(/^\d{6}$/);
  });

  it('leaves the gate open (null) for plain local dev', () => {
    expect(resolvePin({}, false)).toBeNull();
    expect(resolvePin({ LEDRUMS_PIN: '' }, false)).toBeNull();
    expect(resolvePin({ LEDRUMS_PIN: '   ' }, false)).toBeNull(); // whitespace-only = unset, not weak
  });

  it('THROWS on an explicit PIN below the minimum — a silently-dropped PIN means an open server', () => {
    expect(() => resolvePin({ LEDRUMS_PIN: '1' }, false)).toThrow(/at least 4/);
    expect(() => resolvePin({ LEDRUMS_PIN: '123' }, false)).toThrow(/at least 4/);
    // Enforced regardless of the tunnel flag: the in-app Share control can open a tunnel later
    // on an already-booted server, and ensurePin() would keep the weak PIN.
    expect(() => resolvePin({ LEDRUMS_PIN: '12' }, true)).toThrow(/at least 4/);
  });

  it('accepts a PIN exactly at the minimum, and the rule is LENGTH-only (non-numeric stays legal)', () => {
    expect(resolvePin({ LEDRUMS_PIN: '4242' }, false)).toBe('4242');
    expect(resolvePin({ LEDRUMS_PIN: 'drum' }, false)).toBe('drum');
    expect(MIN_PIN_LENGTH).toBe(4);
  });

  it('trims before measuring, so a padded at-minimum PIN is accepted as its trimmed value', () => {
    expect(resolvePin({ LEDRUMS_PIN: ' 4242 ' }, false)).toBe('4242');
    expect(() => resolvePin({ LEDRUMS_PIN: '  12  ' }, false)).toThrow(/at least 4/);
  });

  it('still generates a 6-digit PIN when the tunnel is enabled and none is set', () => {
    expect(resolvePin({}, true)).toMatch(/^\d{6}$/);
  });
});

describe('createMutablePinGate', () => {
  it('starts open, then ensurePin mints a stable PIN that the gate enforces', () => {
    const gate = createMutablePinGate(null);
    expect(gate.pin).toBeNull();
    expect(gate.check(null)).toBe(true); // open gate admits everyone
    const pin = gate.ensurePin();
    expect(pin).toMatch(/^\d{6}$/);
    expect(gate.ensurePin()).toBe(pin); // stable across calls
    expect(gate.pin).toBe(pin);
    expect(gate.check(pin)).toBe(true);
    expect(gate.check('000000' === pin ? '111111' : '000000')).toBe(false);
    expect(gate.check(null)).toBe(false); // no longer open
  });

  it('keeps an explicit initial PIN (env pin wins over minting)', () => {
    const gate = createMutablePinGate('4242');
    expect(gate.ensurePin()).toBe('4242');
    expect(gate.check('4242')).toBe(true);
  });
});

describe('generatePin', () => {
  it('produces an all-digit PIN of the requested length', () => {
    expect(generatePin()).toMatch(/^\d{6}$/);
    expect(generatePin(4)).toMatch(/^\d{4}$/);
  });
});
