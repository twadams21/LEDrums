import { randomInt } from 'node:crypto';
import { WS_CLOSE_INVALID_PIN } from '@ledrums/protocol';

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
      return typeof supplied === 'string' && supplied.length > 0 && supplied === pin;
    },
  };
}

/** A random N-digit numeric PIN (default 6) from a CSPRNG. */
export function generatePin(digits = 6): string {
  let out = '';
  for (let i = 0; i < digits; i++) out += String(randomInt(0, 10));
  return out;
}

/**
 * Resolve the room PIN from config + whether the tunnel is enabled:
 *  - an explicit `LEDRUMS_PIN` always wins (works with or without a tunnel);
 *  - otherwise, when the tunnel is enabled, a PIN is generated per run (never expose a public
 *    tunnel un-gated);
 *  - otherwise `null` — the gate is open (plain local dev is unchanged).
 */
export function resolvePin(env: NodeJS.ProcessEnv, tunnelEnabled: boolean): string | null {
  const explicit = env.LEDRUMS_PIN?.trim();
  if (explicit) return explicit;
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

/** The admit/refuse decision for an incoming WS connection — pure over the connect URL + gate. */
export type AdmitDecision = { ok: true } | { ok: false; code: number; reason: string };

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

/**
 * Decide whether to admit a connection. On refusal the caller closes the socket with
 * {@link WS_CLOSE_INVALID_PIN} before admitting it anywhere.
 *
 * `trustedLocal` short-circuits the PIN: a connection from the host's OWN machine (loopback) that
 * did NOT come through the tunnel is the person running the app, so they must not have to type the
 * PIN into the app on the very machine that generated it. Remote clients always arrive via
 * cloudflared (loopback origin BUT carrying cf-* headers → not trustedLocal), and LAN peers are
 * non-loopback — both stay gated. The caller computes `trustedLocal` from {@link isLoopbackAddress}
 * + {@link isViaCloudflare}.
 */
export function admitDecision(
  url: string | undefined,
  gate: PinGate,
  trustedLocal = false,
): AdmitDecision {
  if (trustedLocal) return { ok: true };
  if (gate.check(pinFromUrl(url))) return { ok: true };
  return { ok: false, code: WS_CLOSE_INVALID_PIN, reason: 'invalid pin' };
}
