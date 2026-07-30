// ---------------------------------------------------------------------------
// Admission throttle (resilience-hole-0006) — failure accounting for the room PIN
// ---------------------------------------------------------------------------
//
// The PIN gate has no failure accounting at all: a 6-digit PIN is a 10^6 space, and a client
// that can open sockets as fast as the tunnel allows can walk it in hours. This module turns
// repeated refusals into an escalating per-peer cooldown plus a bounded global tier, and reports
// each escalation as a VALUE the caller emits — it stays a pure function of (calls, injected
// clock) with no IO, no timers of its own, and no hidden global state, so the whole policy is
// deterministic under test.
//
// It knows nothing about WebSockets, PINs or close codes; `admitDecision` in pin-gate.ts is the
// only place the order of admission checks lives.

/** A single escalation, returned by {@link AdmissionThrottle.recordFailure}. A VALUE, not an
 * emit: the module stays pure and the caller owns the sink (Monitor event + console.warn). */
export interface ThrottleAlert {
  /** `'peer'` — one bucket crossed its allowance. `'global'` — the whole server crossed the
   * global tier, which is the operator's only signal that remote access is being held closed. */
  scope: 'peer' | 'global';
  /** The peer key that tripped it (the global tier reports the key of the tripping failure). */
  key: string;
  /** Failures counted for this key inside the window at the moment of escalation. */
  failures: number;
  /** How long the refusal now lasts. */
  cooldownMs: number;
}

/** Tunables. Every field has a default; a caller overrides only what it means to change. */
export interface ThrottlePolicy {
  /** Failures allowed before the first cooldown. The 6th failure escalates. */
  freeAttempts: number;
  /** A bucket untouched for this long is forgotten entirely (fresh allowance). */
  windowMs: number;
  /** First cooldown; each further escalation doubles it. */
  baseMs: number;
  /** Cooldown ceiling — also the global tier's fixed cooldown. */
  maxMs: number;
  /** Bucket-map ceiling, with oldest-touched eviction, so a spoofed-key flood cannot grow the
   * map without bound. Applies to the known-good set too. */
  maxTrackedPeers: number;
  /** Failures across ALL peers inside `windowMs` that trip the global tier. Per-peer buckets
   * alone do nothing against a distributed guess. `Infinity` disables the tier — the intended
   * first response to a field report of remote lockout, no revert required. */
  globalFailures: number;
}

export const DEFAULT_THROTTLE_POLICY: ThrottlePolicy = {
  freeAttempts: 5,
  windowMs: 60_000,
  baseMs: 1_000,
  maxMs: 60_000,
  maxTrackedPeers: 1_024,
  globalFailures: 100,
};

/** The allow verdict: refusals carry how long the caller should tell the peer to wait. */
export type ThrottleVerdict = { ok: true } | { ok: false; retryAfterMs: number };

export interface AdmissionThrottle {
  /** Whether this peer may be evaluated at all. A refusal here happens BEFORE the credential is
   * compared, which is what makes the cooldown a real control rather than a delay. */
  allow(key: string): ThrottleVerdict;
  /** Record a refused attempt. Returns the escalation if this call caused one, else null. */
  recordFailure(key: string): ThrottleAlert | null;
  /** Record an accepted attempt: clears the bucket AND marks the key known-good for this run
   * (exempting it from the global tier — see the trade-off note below). */
  recordSuccess(key: string): void;
  /** Tracked bucket count. A debug accessor, so eviction and window-forget are falsifiable. */
  size(): number;
}

/**
 * Derive the throttle bucket key for a connection.
 *
 * `cf-connecting-ip` is read ONLY when {@link isViaCloudflare}'s condition holds, so a direct
 * caller cannot mint unlimited buckets by forging that header alone — but note isViaCloudflare
 * returns true on `cdn-loop` ALONE, so the via-cloudflare-without-cf-connecting-ip branch is
 * reachable and is defined here rather than left to fall out of string interpolation.
 *
 * Rules, in order: an array header takes element [0]; the value is trimmed; a non-empty result
 * becomes `cf:<value>`; anything else — absent, empty, whitespace-only — falls through to
 * `ip:<remoteAddress ?? 'unknown'>`. Never interpolate an array or `undefined` into the key:
 * `cf:1.2.3.4,5.6.7.8` and `cf:undefined` would silently merge distinct peers into one bucket.
 *
 * Residual, accepted: a local process that can reach the loopback port could forge BOTH
 * cf-connecting-ip and cdn-loop to mint fresh buckets. It stays bounded by maxTrackedPeers
 * eviction and by the global tier, and a hostile local process already outranks this control.
 */
export function peerKeyFrom(
  remoteAddress: string | null | undefined,
  headers: Record<string, string | string[] | undefined>,
): string {
  const viaCloudflare = headers['cf-connecting-ip'] !== undefined || headers['cdn-loop'] !== undefined;
  if (viaCloudflare) {
    const raw = headers['cf-connecting-ip'];
    const first = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = first?.trim();
    if (trimmed) return `cf:${trimmed}`;
  }
  return `ip:${remoteAddress ?? 'unknown'}`;
}

/** One peer's accounting. `cooling` is the timestamp the cooldown expires (0 = ALLOWED). */
interface Bucket {
  failures: number;
  /** Last touch, for window-forget and oldest-touched eviction. */
  touchedAt: number;
  /** Cooldown expiry; 0 means the bucket is ALLOWED. */
  coolingUntil: number;
  /** Cooldown applied at the last escalation, doubled at the next one. */
  lastCooldownMs: number;
}

/**
 * Build an admission throttle.
 *
 * ESCALATION, defined operationally: a bucket is either ALLOWED or COOLING. `recordFailure`
 * always increments the count, but ESCALATES — moving ALLOWED → COOLING and doubling the
 * cooldown — only when the bucket was ALLOWED at the moment of the call AND the new count
 * exceeds `freeAttempts`. A failure on an already-COOLING bucket neither re-escalates nor
 * extends the cooldown. Under admitDecision's ordering that call cannot arrive from the live
 * path anyway (a cooling peer is refused before the PIN is compared), so it only matters for
 * direct callers. Exactly one alert per escalation, so cooldowns run 1s → 2s → 4s … up to maxMs
 * and a guessing flood cannot itself flood the 300-event Monitor bus.
 *
 * GLOBAL TIER, trade-off stated rather than implied: it is ATTACKER-OPERABLE. 100 failed
 * handshakes per 60s — about 2 requests/second through the tunnel — puts every non-exempt peer
 * into a renewable 60s cooldown, so an attacker who cannot guess the PIN can still deny remote
 * access. That is a real availability regression against today's behaviour, accepted here with
 * one mitigation and one signal: peers with a recorded SUCCESS this run are EXEMPT from the
 * global tier (their own per-peer tier still applies), so the drummer who has already connected
 * keeps getting in; and a `scope: 'global'` alert tells the operator it is happening. A
 * FIRST-TIME remote peer arriving mid-attack is still locked out with no recourse but to wait.
 * `globalFailures: Infinity` disables the tier without a revert.
 */
export function createAdmissionThrottle(
  policy: Partial<ThrottlePolicy> = {},
  now: () => number = Date.now,
): AdmissionThrottle {
  const { freeAttempts, windowMs, baseMs, maxMs, maxTrackedPeers, globalFailures } = {
    ...DEFAULT_THROTTLE_POLICY,
    ...policy,
  };

  /** Insertion-ordered, so the first key is the oldest-touched once `touch` re-inserts. */
  const buckets = new Map<string, Bucket>();
  /** Keys that succeeded this run — exempt from the global tier. Same cap + eviction. */
  const knownGood = new Map<string, number>();
  /** Global-tier accounting: failures inside the current window, and its start. */
  let globalFailureCount = 0;
  let globalWindowStart = 0;
  let globalCoolingUntil = 0;

  /** Re-insert so Map iteration order is oldest-touched-first, then evict past the cap. */
  function evict(map: Map<string, unknown>): void {
    while (map.size > maxTrackedPeers) {
      const oldest = map.keys().next();
      if (oldest.done) return;
      map.delete(oldest.value);
    }
  }

  /** The live bucket for `key`, forgetting one that has been untouched for a full window. */
  function bucketFor(key: string, t: number): Bucket {
    const existing = buckets.get(key);
    if (existing !== undefined && t - existing.touchedAt < windowMs) {
      // Re-insert to move it to the back of the insertion order (most-recently-touched).
      buckets.delete(key);
      buckets.set(key, existing);
      return existing;
    }
    if (existing !== undefined) buckets.delete(key);
    const fresh: Bucket = { failures: 0, touchedAt: t, coolingUntil: 0, lastCooldownMs: 0 };
    buckets.set(key, fresh);
    evict(buckets);
    return fresh;
  }

  /** Drop buckets whose window has fully elapsed, so `size()` reports live tracking, not history. */
  function forgetStale(t: number): void {
    for (const [key, bucket] of buckets) {
      // Insertion order is oldest-touched-first, so the first live bucket ends the sweep.
      if (t - bucket.touchedAt < windowMs) break;
      buckets.delete(key);
    }
  }

  function isKnownGood(key: string): boolean {
    return knownGood.has(key);
  }

  return {
    allow(key) {
      const t = now();
      forgetStale(t);
      const bucket = buckets.get(key);
      if (bucket !== undefined && t - bucket.touchedAt < windowMs && bucket.coolingUntil > t) {
        return { ok: false, retryAfterMs: bucket.coolingUntil - t };
      }
      // The global tier applies only to peers that have never succeeded this run.
      if (globalCoolingUntil > t && !isKnownGood(key)) {
        return { ok: false, retryAfterMs: globalCoolingUntil - t };
      }
      return { ok: true };
    },

    recordFailure(key) {
      const t = now();
      forgetStale(t);
      const bucket = bucketFor(key, t);
      const wasAllowed = bucket.coolingUntil <= t;
      bucket.failures += 1;
      bucket.touchedAt = t;

      // Global accounting runs on every failure, independent of the per-peer tier.
      if (t - globalWindowStart >= windowMs) {
        globalWindowStart = t;
        globalFailureCount = 0;
      }
      globalFailureCount += 1;
      const globalTripped = globalFailureCount >= globalFailures && globalCoolingUntil <= t;
      if (globalTripped) globalCoolingUntil = t + maxMs;

      if (wasAllowed && bucket.failures > freeAttempts) {
        const cooldownMs = Math.min(maxMs, bucket.lastCooldownMs === 0 ? baseMs : bucket.lastCooldownMs * 2);
        bucket.lastCooldownMs = cooldownMs;
        bucket.coolingUntil = t + cooldownMs;
        return { scope: 'peer', key, failures: bucket.failures, cooldownMs };
      }
      // A per-peer escalation outranks the global one for reporting: it names the specific peer.
      if (globalTripped) {
        return { scope: 'global', key, failures: globalFailureCount, cooldownMs: maxMs };
      }
      return null;
    },

    recordSuccess(key) {
      const t = now();
      forgetStale(t);
      buckets.delete(key);
      knownGood.delete(key); // re-insert so the known-good set evicts oldest-touched too
      knownGood.set(key, t);
      evict(knownGood);
    },

    size() {
      forgetStale(now());
      return buckets.size;
    },
  };
}
