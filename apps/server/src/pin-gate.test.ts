import { describe, expect, it } from 'vitest';
import { WS_CLOSE_INVALID_PIN } from '@ledrums/protocol';
import {
  admitDecision,
  createPinGate,
  generatePin,
  isLoopbackAddress,
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
