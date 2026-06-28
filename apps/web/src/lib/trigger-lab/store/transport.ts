/* Engine-link sync — the change-detection guards behind the store's per-frame transport push
   and its authored-Show resend (no runes/DOM). The store opens/closes the WS link and sends; this
   controller answers "did it actually change?" so we never spam the engine. A signature guard on
   the Show skips no-op fires AND pure node-position (x/y) drags, so dragging the graph doesn't
   needlessly reset engine voices; transport rides a separate message so tempo edits never resend
   the Show. Extracted from store.svelte.ts unchanged in behaviour. */

/** The transport tuple mirrored to the engine. */
export interface TransportState {
  bpm: number;
  playing: boolean;
  beatsPerBar: number;
}

/** Signature of an authored Show that is INSENSITIVE to node x/y positions — so a layout drag
    doesn't count as a content change (which would reseed engine voices). */
export function showSig(show: unknown): string {
  return JSON.stringify(show, (k, v) => (k === 'x' || k === 'y' ? 0 : v));
}

/** Tracks the last Show signature + transport tuple sent to the engine, so the store only
    pushes a `setShow` / `setTransport` on a real change. Reset on a link drop (the next open
    must re-send both). */
export class EngineLinkSync {
  /** Signature of the Show last sent (or the connect-time baseline); null while disconnected. */
  private lastShowSig: string | null = null;
  /** Last transport tuple we sent; null while disconnected (forces a fresh send on open). */
  private lastSent: TransportState | null = null;

  /** Baseline the Show signature at connect, so the first sync tick is a no-op (the connect
      handshake already sent the Show). */
  baselineShow(show: unknown): void {
    this.lastShowSig = showSig(show);
  }

  /** Whether the authored Show should be resent — true (and records the new signature) when it
      changed vs the last send, ignoring pure x/y drags. */
  planShowPush(show: unknown): boolean {
    const sig = showSig(show);
    if (sig === this.lastShowSig) return false;
    this.lastShowSig = sig;
    return true;
  }

  /** Baseline the transport tuple at connect (the handshake sent it once). */
  baselineTransport(cur: TransportState): void {
    this.lastSent = { ...cur };
  }

  /** Whether the transport should be resent — true (and records it) when bpm/playing/beatsPerBar
      changed vs the last send. */
  planTransportPush(cur: TransportState): boolean {
    const prev = this.lastSent;
    if (prev && prev.bpm === cur.bpm && prev.playing === cur.playing && prev.beatsPerBar === cur.beatsPerBar) {
      return false;
    }
    this.lastSent = { ...cur };
    return true;
  }

  /** A link drop — the next open must re-send both the Show and the transport. */
  reset(): void {
    this.lastShowSig = null;
    this.lastSent = null;
  }
}
