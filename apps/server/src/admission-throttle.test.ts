import { describe, expect, it } from 'vitest';
import {
  createAdmissionThrottle,
  DEFAULT_THROTTLE_POLICY,
  peerKeyFrom,
  type ThrottlePolicy,
} from './admission-throttle';

/** A throttle over a fake clock the test drives by hand — the module takes `now` injected so the
 * whole policy is deterministic with no timers and no waiting. */
function withClock(policy: Partial<ThrottlePolicy> = {}) {
  let t = 0;
  const throttle = createAdmissionThrottle(policy, () => t);
  return {
    throttle,
    advance(ms: number): void {
      t += ms;
    },
    get now(): number {
      return t;
    },
  };
}

const FREE = DEFAULT_THROTTLE_POLICY.freeAttempts;

describe('createAdmissionThrottle — per-peer cooldown', () => {
  it('spends the free allowance without refusing, then the next failure starts a 1s cooldown', () => {
    const { throttle } = withClock();
    for (let i = 0; i < FREE; i++) {
      expect(throttle.recordFailure('ip:1.2.3.4')).toBeNull();
      expect(throttle.allow('ip:1.2.3.4')).toEqual({ ok: true }); // the allowance is real
    }
    expect(throttle.recordFailure('ip:1.2.3.4')).toEqual({
      scope: 'peer',
      key: 'ip:1.2.3.4',
      failures: FREE + 1,
      cooldownMs: 1_000,
    });
    expect(throttle.allow('ip:1.2.3.4')).toEqual({ ok: false, retryAfterMs: 1_000 });
  });

  it('re-allows after the cooldown, and each further escalation doubles up to the cap', () => {
    const { throttle, advance } = withClock();
    const key = 'ip:1.2.3.4';
    for (let i = 0; i < FREE; i++) throttle.recordFailure(key);

    const seen: number[] = [];
    // Each cycle: escalate, then wait it out. 1s → 2s → 4s … until the 60s cap holds.
    for (let i = 0; i < 7; i++) {
      const alert = throttle.recordFailure(key);
      expect(alert).not.toBeNull();
      seen.push(alert!.cooldownMs);
      expect(throttle.allow(key)).toEqual({ ok: false, retryAfterMs: alert!.cooldownMs });
      advance(alert!.cooldownMs + 1);
      expect(throttle.allow(key)).toEqual({ ok: true }); // exactly one attempt is re-allowed
    }
    expect(seen).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000]);
  });

  it('the cap doubles no further, and sitting out the capped cooldown forgets the bucket entirely', () => {
    const { throttle, advance } = withClock();
    const key = 'ip:1.2.3.4';
    for (let i = 0; i < FREE; i++) throttle.recordFailure(key);
    // Climb to the cap WITHOUT waiting a full window at any point (advance just past each
    // cooldown, which for the sub-cap rungs is far short of windowMs).
    let last = 0;
    for (let i = 0; i < 7; i++) {
      last = throttle.recordFailure(key)!.cooldownMs;
      advance(last + 1);
    }
    expect(last).toBe(DEFAULT_THROTTLE_POLICY.maxMs);

    // The cap EQUALS the window, so a peer that sits out the full 60s has by construction been
    // untouched for a whole window — the bucket is forgotten and the ladder starts over at 1s.
    // Deliberate: the throttle costs a guesser ~60s per 5 attempts forever, without ever turning
    // into a permanent lockout that a legitimate drummer cannot escape.
    expect(throttle.size()).toBe(0);
    for (let i = 0; i < FREE; i++) expect(throttle.recordFailure(key)).toBeNull();
    expect(throttle.recordFailure(key)).toMatchObject({ cooldownMs: 1_000 });
  });

  it('ESCALATION COUNT: 12 failures yield exactly 3 alerts, and the count follows from the script', () => {
    const { throttle, advance } = withClock();
    const K = 'ip:9.9.9.9';
    const alerts: number[] = [];

    // 1. The free allowance: silent.
    for (let i = 0; i < FREE; i++) expect(throttle.recordFailure(K)).toBeNull();

    // 2. Three escalate-then-wait-it-out cycles.
    for (let i = 0; i < 3; i++) {
      const alert = throttle.recordFailure(K);
      expect(alert).not.toBeNull();
      alerts.push(alert!.cooldownMs);
      advance(alert!.cooldownMs + 1);
    }
    expect(alerts).toEqual([1_000, 2_000, 4_000]);

    // 3. Four failures WHILE the bucket is cooling: counted, but no re-escalation and no
    //    extension. (admitDecision refuses a cooling peer before the PIN is compared, so this
    //    cannot arrive from the live path — it is pinned for direct callers.)
    const escalated = throttle.recordFailure(K);
    expect(escalated).not.toBeNull();
    const retryAtEscalation = throttle.allow(K);
    for (let i = 0; i < 4; i++) expect(throttle.recordFailure(K)).toBeNull();
    expect(throttle.allow(K)).toEqual(retryAtEscalation); // cooldown unchanged by in-cooldown failures

    expect(alerts).toHaveLength(3); // 5 + 3 + 1 + 4 = 13 calls, 4 alerts total, 3 in the scripted run
  });

  it('keys are independent — failures on A never affect B', () => {
    const { throttle } = withClock();
    for (let i = 0; i < FREE + 3; i++) throttle.recordFailure('ip:A');
    expect(throttle.allow('ip:A').ok).toBe(false);
    expect(throttle.allow('ip:B')).toEqual({ ok: true });
  });

  it('recordSuccess resets the peer to its full free allowance', () => {
    const { throttle } = withClock();
    const key = 'ip:1.2.3.4';
    for (let i = 0; i < FREE - 1; i++) throttle.recordFailure(key);
    throttle.recordSuccess(key);
    // The whole allowance is available again — the last pre-success failure did not carry over.
    for (let i = 0; i < FREE; i++) expect(throttle.recordFailure(key)).toBeNull();
    expect(throttle.recordFailure(key)).not.toBeNull();
  });

  it('forgets a bucket untouched for a full window', () => {
    const { throttle, advance } = withClock();
    for (let i = 0; i < FREE + 1; i++) throttle.recordFailure('ip:1.2.3.4');
    expect(throttle.size()).toBe(1);
    expect(throttle.allow('ip:1.2.3.4').ok).toBe(false);

    advance(DEFAULT_THROTTLE_POLICY.windowMs);
    expect(throttle.size()).toBe(0);
    expect(throttle.allow('ip:1.2.3.4')).toEqual({ ok: true });
  });

  it('bounds the bucket map with oldest-touched eviction, so a spoofed-key flood cannot grow it', () => {
    // Global tier off: this case is about map growth, and 1500 failures would otherwise trip it
    // and mask the eviction result behind a global refusal.
    const { throttle } = withClock({ globalFailures: Infinity });
    for (let i = 0; i < 1_500; i++) throttle.recordFailure(`ip:10.0.${Math.floor(i / 256)}.${i % 256}`);
    expect(throttle.size()).toBeLessThanOrEqual(DEFAULT_THROTTLE_POLICY.maxTrackedPeers);
    // The first key was evicted long ago, so it starts over with a full allowance.
    expect(throttle.allow('ip:10.0.0.0')).toEqual({ ok: true });
  });
});

describe('createAdmissionThrottle — global tier', () => {
  it('trips on distributed failures and locks out a fresh peer, but exempts one that succeeded', () => {
    const { throttle } = withClock();
    const drummer = 'cf:203.0.113.7';
    throttle.recordSuccess(drummer); // connected earlier this run → known-good

    // A distributed guess: 100 failures spread thin, so no single peer ever escalates.
    for (let i = 0; i < DEFAULT_THROTTLE_POLICY.globalFailures; i++) {
      throttle.recordFailure(`cf:198.51.100.${i}`);
    }

    const fresh = throttle.allow('cf:192.0.2.55');
    expect(fresh.ok).toBe(false);
    expect(fresh).toEqual({ ok: false, retryAfterMs: DEFAULT_THROTTLE_POLICY.maxMs });
    // The known-good drummer still gets in — the mitigation for the accepted availability cost.
    expect(throttle.allow(drummer)).toEqual({ ok: true });
  });

  it('reports the global escalation as a distinct scope, exactly once', () => {
    const { throttle } = withClock();
    const alerts = [];
    for (let i = 0; i < DEFAULT_THROTTLE_POLICY.globalFailures + 20; i++) {
      const alert = throttle.recordFailure(`cf:198.51.100.${i}`);
      if (alert) alerts.push(alert);
    }
    const global = alerts.filter((a) => a.scope === 'global');
    expect(global).toHaveLength(1);
    expect(global[0]).toMatchObject({
      scope: 'global',
      failures: DEFAULT_THROTTLE_POLICY.globalFailures,
      cooldownMs: DEFAULT_THROTTLE_POLICY.maxMs,
    });
  });

  it('globalFailures: Infinity disables the tier — the no-revert kill switch for a field lockout', () => {
    const { throttle } = withClock({ globalFailures: Infinity });
    for (let i = 0; i < 500; i++) throttle.recordFailure(`cf:198.51.100.${i % 250}`);
    expect(throttle.allow('cf:192.0.2.55')).toEqual({ ok: true });
  });
});

describe('peerKeyFrom', () => {
  it('uses cf-connecting-ip when the request came via cloudflare', () => {
    expect(peerKeyFrom('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4', 'cdn-loop': 'cloudflare' })).toBe('cf:1.2.3.4');
    // isViaCloudflare is true on cf-connecting-ip alone, so cdn-loop is not required.
    expect(peerKeyFrom('127.0.0.1', { 'cf-connecting-ip': '9.9.9.9' })).toBe('cf:9.9.9.9');
  });

  it('takes element [0] of an array header — never interpolates the whole array', () => {
    expect(peerKeyFrom('127.0.0.1', { 'cf-connecting-ip': ['1.2.3.4', '5.6.7.8'] })).toBe('cf:1.2.3.4');
  });

  it('falls through to the socket address when cloudflare forwarded but the IP header is unusable', () => {
    // Reachable: isViaCloudflare returns true on cdn-loop ALONE.
    expect(peerKeyFrom('10.0.0.9', { 'cdn-loop': 'cloudflare; loops=1' })).toBe('ip:10.0.0.9');
    expect(peerKeyFrom('10.0.0.9', { 'cf-connecting-ip': '  ' })).toBe('ip:10.0.0.9');
    expect(peerKeyFrom('10.0.0.9', { 'cf-connecting-ip': '' })).toBe('ip:10.0.0.9');
    expect(peerKeyFrom('10.0.0.9', { 'cf-connecting-ip': [] })).toBe('ip:10.0.0.9');
  });

  it('uses the socket address for a direct connection, and a stable sentinel when there is none', () => {
    expect(peerKeyFrom('192.168.1.50', {})).toBe('ip:192.168.1.50');
    expect(peerKeyFrom('192.168.1.50', { host: 'localhost:4178' })).toBe('ip:192.168.1.50');
    expect(peerKeyFrom(null, {})).toBe('ip:unknown');
    expect(peerKeyFrom(undefined, {})).toBe('ip:unknown');
  });

  it('never yields a key containing "undefined" or a comma-joined array', () => {
    // Both forms would silently merge distinct peers into one bucket.
    const keys = [
      peerKeyFrom(undefined, { 'cf-connecting-ip': undefined, 'cdn-loop': 'cloudflare' }),
      peerKeyFrom(undefined, { 'cf-connecting-ip': ['1.1.1.1', '2.2.2.2'] }),
    ];
    expect(keys).toEqual(['ip:unknown', 'cf:1.1.1.1']);
  });
});
