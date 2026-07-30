import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { throttledCloseReason, WS_CLOSE_INVALID_PIN, WS_CLOSE_PIN_THROTTLED } from '@ledrums/protocol';
import type { AdmissionThrottle, ThrottleAlert } from './admission-throttle';

// ---------------------------------------------------------------------------
// Room PIN gate (S3 remote access)
// ---------------------------------------------------------------------------
//
// A WS session must present the correct room PIN before it is admitted — checked at the
// `connection` event from the connect-URL query (`?pin=…`), BEFORE the socket joins the
// broadcast registry or receives any state/frames, so an un-authed client can neither view
// nor mutate. The decision is a pure function ({@link admitDecision}) so it is unit-testable
// without a live server.
//
// The PIN comes from server config/env (or is generated per run); a `null` PIN means the gate
// is DISABLED (open server) — which is the default, so plain local `pnpm dev` is unchanged.
//
// NOTE: the tunnel forwards to localhost, so tunnel-origin requests arrive as local
// connections indistinguishable from the host's own browser — the gate is therefore uniform
// (the host enters the PIN too; it is printed to the boot console).
//
// OPERATOR RULES (INIT-05). Two things an operator must know before pointing this at a tunnel:
//
//  1. STRENGTH, FAIL-CLOSED. An explicit `LEDRUMS_PIN` must be at least {@link MIN_PIN_LENGTH}
//     (4) characters and the server REFUSES TO BOOT below that — it does not quietly ignore the
//     value, because a silently-dropped PIN means an OPEN server. The rule is LENGTH only: the
//     charset stays unconstrained, so a non-numeric PIN is still legal. Under the desktop
//     sidecar, which inherits the user environment, a too-short PIN surfaces as a dead sidecar
//     plus the thrown message in the server log; the fix is a longer PIN. Enforced whether or
//     not a tunnel is enabled at boot, because the in-app Share control can open one later.
//
//  2. THROTTLE. Repeated failed admissions from one peer buy an escalating cooldown (1s → 2s →
//     4s … capped at 60s, see `admission-throttle.ts`), and a peer that is cooling is refused
//     with WS_CLOSE_PIN_THROTTLED (4429) WITHOUT the PIN being compared — so during a cooldown
//     even the correct PIN is refused, which is why the web overlay says "too many attempts"
//     rather than "incorrect PIN". Each ESCALATION (never each attempt) raises one Monitor
//     event: 'Repeated PIN refusals', or 'Remote access cooling down (global)' when the
//     server-wide tier trips. That global tier is attacker-operable — a sustained flood can
//     hold first-time remote peers out — so it is the alert to act on (though when a failure
//     trips both tiers at once the peer alert wins the slot, and the global trip can go
//     unreported for up to one 60s window); peers that have already
//     connected successfully this run are exempt from it, and it can be disabled outright by
//     constructing the throttle with `globalFailures: Infinity`, no revert required.
//
//     The TRUSTED HOST is exempt from all of the above: it bypasses the PIN, is never
//     throttled, and never consumes another peer's budget, so the host cannot lock itself out.
//     An OPEN gate never touches the throttle at all — nothing to guess, nothing to account for.

// ---------------------------------------------------------------------------
// Credential primitives (module-private) — the invariant, made structural
// ---------------------------------------------------------------------------
//
// This module holds TWO credentials: the room PIN (public-tunnel facing) and the host-session
// token. The strength rule and the constant-time comparison were originally written for the host
// token alone, so the PIN — the credential that actually faces the internet — reached a plain
// `===`. These two helpers are the single home for both operations, and EVERY credential path
// below routes through them, so a future third credential cannot get a weaker comparison by
// omission. They are deliberately NOT exported: the invariant becomes structural without the
// module's interface growing.

/**
 * Parse a credential supplied by CONFIG (env/injection): trim, then reject anything empty or
 * shorter than `minLength`. Returns null for "no usable credential here" — the caller decides
 * whether that means fail-closed (throw) or fall back to minting a strong one.
 *
 * Deliberately NOT applied to a credential supplied by a CONNECTING PEER: trimming a peer's
 * value would widen what counts as a match (`'4242 '` must stay a wrong PIN), and a length gate
 * on the supplied side buys nothing — a short value cannot equal a long secret anyway.
 */
function parseCredential(raw: string | null | undefined, minLength: number): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.length < minLength) return null;
  return trimmed;
}

/** Constant-time credential equality, so a wrong credential cannot be recovered byte-by-byte via
 * comparison timing. Length-checks first (timingSafeEqual throws on unequal-length buffers), which
 * also makes it total over multi-byte input where byte length ≠ code-unit length. */
function credentialsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** The PIN check, with a `null` pin meaning the gate is open. */
export interface PinGate {
  /** The active room PIN, or null when the gate is disabled (open). */
  readonly pin: string | null;
  /** Whether `supplied` satisfies the gate. Always true when the gate is disabled. */
  check(supplied: string | null | undefined): boolean;
}

/** Build a {@link PinGate} over a fixed PIN (or null for an open gate). */
export function createPinGate(pin: string | null): PinGate {
  return {
    pin,
    check(supplied) {
      if (pin === null) return true; // gate disabled → admit everyone
      return typeof supplied === 'string' && supplied.length > 0 && credentialsEqual(supplied, pin);
    },
  };
}

/** A {@link PinGate} whose PIN can be minted AFTER boot — the in-app tunnel start on an
 * otherwise-open server generates a PIN just before the public URL exists (S3 invariant:
 * never an un-gated tunnel). Once set, the PIN is stable for the server run. */
export interface MutablePinGate extends PinGate {
  /** Return the active PIN, generating (and keeping) one when the gate was open. */
  ensurePin(): string;
}

/** Build a {@link MutablePinGate}. `initial` mirrors {@link createPinGate} (explicit/env or
 * boot-generated PIN, or null = open until {@link MutablePinGate.ensurePin} is called). */
export function createMutablePinGate(initial: string | null): MutablePinGate {
  let pin = initial;
  return {
    get pin() {
      return pin;
    },
    check(supplied) {
      if (pin === null) return true; // gate disabled → admit everyone
      return typeof supplied === 'string' && supplied.length > 0 && credentialsEqual(supplied, pin);
    },
    ensurePin() {
      if (pin === null) pin = generatePin();
      return pin;
    },
  };
}

/** A random N-digit numeric PIN (default 6) from a CSPRNG. */
export function generatePin(digits = 6): string {
  let out = '';
  for (let i = 0; i < digits; i++) out += String(randomInt(0, 10));
  return out;
}

/** Minimum accepted length for an EXPLICIT `LEDRUMS_PIN`. A LENGTH rule only — the charset stays
 * unconstrained, so a non-numeric PIN ('drum') is still legal and the desktop banner parser must
 * not assume digits. {@link generatePin} produces 6 digits, comfortably above this floor. */
export const MIN_PIN_LENGTH = 4;

/**
 * Resolve the room PIN from config + whether the tunnel is enabled:
 *  - an explicit `LEDRUMS_PIN` always wins (works with or without a tunnel);
 *  - otherwise, when the tunnel is enabled, a PIN is generated per run (never expose a public
 *    tunnel un-gated);
 *  - otherwise `null` — the gate is open (plain local dev is unchanged).
 *
 * FAIL CLOSED on strength: an explicit PIN shorter than {@link MIN_PIN_LENGTH} THROWS rather than
 * being ignored, because a silently-dropped PIN means an OPEN server — the operator asked for a
 * gate and would get none. The minimum is enforced regardless of `tunnelEnabled`, because
 * {@link MutablePinGate.ensurePin} keeps an existing weak PIN when the in-app Share control opens
 * a tunnel on an already-booted server: "no tunnel at boot" is not "never public". An unset or
 * whitespace-only `LEDRUMS_PIN` is "no PIN configured", not a weak one, and still opens the gate.
 */
export function resolvePin(env: NodeJS.ProcessEnv, tunnelEnabled: boolean): string | null {
  const raw = env.LEDRUMS_PIN?.trim();
  if (raw) {
    const explicit = parseCredential(raw, MIN_PIN_LENGTH);
    if (explicit === null) throw new Error(`LEDRUMS_PIN must be at least ${MIN_PIN_LENGTH} characters`);
    return explicit;
  }
  return tunnelEnabled ? generatePin() : null;
}

/** Extract the `pin` query parameter from a WS connect URL (or null when absent/unparseable).
 * The url is a path-relative request target (e.g. `/ws?pin=1234`), so it is resolved against a
 * dummy base. */
export function pinFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'http://localhost').searchParams.get('pin');
  } catch {
    return null;
  }
}

/** The admit/refuse decision for an incoming WS connection — pure over the connect URL + gate
 * (+ the throttle, whose only mutable state is its own bucket map). `alert` is present on the ONE
 * refusal that caused an escalation, so the caller emits exactly one Monitor event per escalation
 * rather than one per failed attempt. */
export type AdmitDecision =
  | { ok: true }
  | { ok: false; code: number; reason: string; alert?: ThrottleAlert };

/** True for a loopback peer address (the host's own machine). ws/http reports IPv4-mapped IPv6
 * (`::ffff:127.0.0.1`) on dual-stack sockets, so cover that form too. */
export function isLoopbackAddress(addr: string | null | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** True when a request arrived through the Cloudflare tunnel — cloudflared injects these headers on
 * every forwarded request (verified for both quick + named tunnels). A direct, same-machine
 * connection has none of them, which is how we tell the host apart from a remote client. */
export function isViaCloudflare(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  return headers['cf-connecting-ip'] !== undefined || headers['cdn-loop'] !== undefined;
}

// ---------------------------------------------------------------------------
// Host-session token (S4 desktop) — proving the connection is the host's own app
// ---------------------------------------------------------------------------
//
// Loopback alone is NOT an authentication boundary: any local browser tab, script, or compromised
// local process that can reach the (random) localhost port is also loopback. So the host PIN bypass
// additionally requires the connection to present an unguessable per-run token that the server hands
// PRIVATELY to the desktop app window (via its URL hash) — never over the wire to remote clients.
// Remote tunnel clients (cf-* headers) and LAN peers (non-loopback) can never satisfy the bypass and
// must use the room PIN.

/** A high-entropy host-session token (default 32 bytes → 64 hex chars) from a CSPRNG. Minted once
 * per server run; handed to the desktop app window so its WebSocket can prove it is the host app. */
export function generateHostToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** Minimum accepted length for an INJECTED host token. {@link generateHostToken} produces 64 hex
 * chars; anything materially shorter is not a credential we are willing to run the PIN bypass on. */
export const MIN_HOST_TOKEN_LENGTH = 32;

/**
 * Resolve the per-run host token, preferring one INJECTED by the launching process
 * (`LEDRUMS_HOST_TOKEN`) over minting a fresh one.
 *
 * The desktop shell spawns this server as a sidecar and needs the token to authenticate its native
 * MIDI bridge and its app window. Injecting it at spawn means the shell KNOWS the token before the
 * process has printed anything — which is what lets the MIDI bridge come up the moment the server is
 * listening, instead of being gated on scraping a conditional banner line (#139).
 *
 * Fail-closed on strength: an injected token shorter than {@link MIN_HOST_TOKEN_LENGTH} is ignored
 * and a strong one is minted instead — a weak injected value must never widen the PIN bypass. The
 * token is never null, so the bypass is always available to a caller that can prove it holds it.
 */
export function resolveHostToken(env: NodeJS.ProcessEnv): string {
  return parseCredential(env.LEDRUMS_HOST_TOKEN, MIN_HOST_TOKEN_LENGTH) ?? generateHostToken();
}

/** Extract the `hostToken` query parameter from a WS connect URL (or null when absent/unparseable).
 * Mirrors {@link pinFromUrl}: the url is a path-relative request target resolved against a dummy base. */
export function hostTokenFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'http://localhost').searchParams.get('hostToken');
  } catch {
    return null;
  }
}

/** Inputs to {@link isTrustedHost} — the per-connection facts plus the server's current host token. */
export interface HostTrustInput {
  /** `req.socket.remoteAddress`. */
  remoteAddress: string | null | undefined;
  /** `req.headers`. */
  headers: Record<string, string | string[] | undefined>;
  /** `req.url` (carries the `?hostToken=…` query). */
  url: string | undefined;
  /** The server's per-run host token, or null when none was minted (bypass disabled). */
  hostToken: string | null;
}

/**
 * Whether a connection is the trusted host app session — eligible to skip the room PIN. ALL of:
 * a host token was minted, the peer is loopback, the request did NOT arrive via cloudflared, and the
 * connection presents the exact host token. This is what the caller passes as `trustedLocal` to
 * {@link admitDecision}; any failed condition falls through to the normal PIN check.
 */
export function isTrustedHost({ remoteAddress, headers, url, hostToken }: HostTrustInput): boolean {
  if (hostToken === null) return false; // no token minted → bypass disabled
  if (!isLoopbackAddress(remoteAddress)) return false; // LAN/remote peer → gated
  if (isViaCloudflare(headers)) return false; // tunnel-forwarded → gated
  const supplied = hostTokenFromUrl(url);
  return supplied !== null && credentialsEqual(supplied, hostToken);
}

/** The per-connection facts {@link admitDecision} needs beyond the URL and the gate. Supplying
 * neither `throttle` nor `peerKey` gives exactly the pre-throttle behaviour. */
export interface AdmitContext {
  /** The host's own app window, proven by the host-session token (see {@link isTrustedHost}). */
  trustedLocal?: boolean;
  /** Failure accounting. Omit to disable throttling entirely for this call. */
  throttle?: AdmissionThrottle;
  /** This peer's throttle bucket (see `peerKeyFrom`). Required for `throttle` to do anything. */
  peerKey?: string;
}

/**
 * Decide whether to admit a connection — the WHOLE admission policy, in one pure function, in
 * one place, so the ORDER of the checks has exactly one home. On refusal the caller closes the
 * socket with `decision.code` before admitting it anywhere.
 *
 * The order, and why each step sits where it does:
 *
 *  1. `trustedLocal` short-circuits everything, with NO throttle bookkeeping: it is the host's
 *     OWN app window, proven by the host-session token — so the drummer never types the room PIN
 *     into the app on the machine that generated it, the host can never lock ITSELF out, and the
 *     host never consumes another peer's budget. Remote clients (cf-* headers) and LAN peers
 *     (non-loopback) can never be trustedLocal and stay gated.
 *  2. An OPEN gate (no PIN configured) admits with no accounting at all. There is no credential
 *     to guess, so there is nothing to throttle — and a plain local `pnpm dev` must never be able
 *     to refuse anyone, least of all via the global tier.
 *  3. The throttle's `allow` runs BEFORE the PIN is compared. That ordering is what makes the
 *     cooldown a real control rather than a delay, and it is also what guarantees a live-path
 *     `recordFailure` never lands on an already-cooling bucket. A refusal here carries
 *     {@link WS_CLOSE_PIN_THROTTLED}, NOT the invalid-pin code: during a cooldown even the
 *     correct PIN is refused, so "incorrect PIN" would be a lie to a legitimate drummer.
 *  4. Then, and only then, the PIN itself — success clears the bucket and marks the peer
 *     known-good for the run; failure is counted, and if that count escalates, the escalation
 *     rides back on the refusal as `alert` for the caller to emit exactly once.
 */
export function admitDecision(
  url: string | undefined,
  gate: PinGate,
  ctx: AdmitContext = {},
): AdmitDecision {
  const { trustedLocal = false, throttle, peerKey } = ctx;
  if (trustedLocal) return { ok: true };
  if (gate.pin === null) return { ok: true }; // open gate: no credential, nothing to account for

  const accounting = throttle !== undefined && peerKey !== undefined ? { throttle, peerKey } : null;
  if (accounting !== null) {
    const verdict = accounting.throttle.allow(accounting.peerKey);
    if (!verdict.ok) {
      return {
        ok: false,
        code: WS_CLOSE_PIN_THROTTLED,
        reason: throttledCloseReason(verdict.retryAfterMs),
      };
    }
  }

  if (gate.check(pinFromUrl(url))) {
    accounting?.throttle.recordSuccess(accounting.peerKey);
    return { ok: true };
  }
  const alert = accounting?.throttle.recordFailure(accounting.peerKey) ?? null;
  return { ok: false, code: WS_CLOSE_INVALID_PIN, reason: 'invalid pin', ...(alert ? { alert } : {}) };
}
