/* Boot-recovery banner view logic (Decision 8), kept pure so the copy and the
   acknowledgement rule are unit-testable without a DOM.

   The server tells every client, on `state`, whether its live project file was unloadable at boot
   and which rung of the recovery ladder saved it. That is never quiet: the drummer may be looking
   at a project that is missing their last edits, so the banner BLOCKS until acknowledged.

   The acknowledgement is deliberately client-session-local (sessionStorage, no server round-trip):
   it answers "has THIS person, in THIS tab session, been told?", and a fresh tab asks again because
   a fresh pair of eyes has not seen it. It is keyed by the recovery reason so a *different*
   recovery later in the same session is not silently swallowed by an earlier ack. */
import type { BootRecoveryInfo } from '../../ws/protocol-types';

/** sessionStorage key holding the acknowledged recovery's ack token. */
export const RECOVERY_ACK_KEY = 'ledrums.bootRecoveryAck';

export interface RecoveryBannerView {
  /** Headline — states the outcome, not the mechanism. */
  title: string;
  /** The honest consequence. Never softened: edits really may be gone. */
  message: string;
  /** Which rung recovered us, in the drummer's words. */
  rung: string;
  /** The raw error class + message, for the "what went wrong" detail line. */
  reason: string;
}

/** Stable identity of one recovery event — the ack is recorded against this. */
export function recoveryAckToken(info: BootRecoveryInfo): string {
  return `${info.source}:${info.reason}`;
}

/** Map a boot-recovery outcome to the banner's copy. Pure. */
export function recoveryBannerView(info: BootRecoveryInfo): RecoveryBannerView {
  const fromSnapshot = info.source === 'snapshot';
  return {
    title: 'Recovered from backup',
    message: 'Your last edits may be missing.',
    rung: fromSnapshot
      ? 'The live project file could not be read, so LEDrums loaded the newest backup snapshot.'
      : 'The live project file could not be read and no readable backup existed, so LEDrums started from a fresh default kit.',
    reason: info.reason,
  };
}

/** Minimal structural storage so tests (and a privacy-mode browser) need no real sessionStorage. */
export interface AckStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The sessionStorage-backed store, or null where storage is unavailable (SSR, blocked cookies).
 * Fails OPEN on purpose: with no storage we cannot remember an ack, and re-showing a warning is
 * the safe direction — suppressing it would hide real data loss. */
export function sessionAckStore(): AckStore | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Has this exact recovery already been acknowledged in this browser session? */
export function isAcknowledged(info: BootRecoveryInfo, store: AckStore | null): boolean {
  if (!store) return false;
  try {
    return store.getItem(RECOVERY_ACK_KEY) === recoveryAckToken(info);
  } catch {
    return false;
  }
}

/** Record the acknowledgement for the rest of this browser session. */
export function acknowledge(info: BootRecoveryInfo, store: AckStore | null): void {
  if (!store) return;
  try {
    store.setItem(RECOVERY_ACK_KEY, recoveryAckToken(info));
  } catch {
    // Storage full / blocked — the ack still dismisses the banner for this page view.
  }
}
