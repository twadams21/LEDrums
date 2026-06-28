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

/** Decide whether to admit a connection given its connect URL and the gate. On refusal the
 * caller closes the socket with {@link WS_CLOSE_INVALID_PIN} before admitting it anywhere. */
export function admitDecision(url: string | undefined, gate: PinGate): AdmitDecision {
  if (gate.check(pinFromUrl(url))) return { ok: true };
  return { ok: false, code: WS_CLOSE_INVALID_PIN, reason: 'invalid pin' };
}
