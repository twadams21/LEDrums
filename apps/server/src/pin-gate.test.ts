import { describe, expect, it } from 'vitest';
import { WS_CLOSE_INVALID_PIN } from '@ledrums/protocol';
import {
  admitDecision,
  createPinGate,
  generateHostToken,
  generatePin,
  hostTokenFromUrl,
  isLoopbackAddress,
  isTrustedHost,
  isViaCloudflare,
  pinFromUrl,
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
    expect(admitDecision('/ws', gate, true)).toEqual({ ok: true });
    expect(admitDecision('/ws?pin=9999', gate, true)).toEqual({ ok: true });
  });

  it('a non-trusted connection is still gated even without a PIN', () => {
    const gate = createPinGate('1234');
    expect(admitDecision('/ws', gate, false)).toEqual({ ok: false, code: WS_CLOSE_INVALID_PIN, reason: 'invalid pin' });
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
    admitDecision(
      over.url,
      gate,
      isTrustedHost({
        remoteAddress: over.remoteAddress ?? '127.0.0.1',
        headers: over.headers ?? {},
        url: over.url,
        hostToken: TOKEN,
      }),
    );
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
  });
});

describe('generatePin', () => {
  it('produces an all-digit PIN of the requested length', () => {
    expect(generatePin()).toMatch(/^\d{6}$/);
    expect(generatePin(4)).toMatch(/^\d{4}$/);
  });
});
