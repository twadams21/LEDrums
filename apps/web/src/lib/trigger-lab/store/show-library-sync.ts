/* Server-authoritative show-library controller (#21) — the cold-load-adopt + write-through
   path, lifted out of the store as a small stateful controller (no runes/DOM, like
   SaveStatusController). The server owns the authored show library (as it owns the routing
   Project): it persists the library and broadcasts it on `state`. The web ADOPTS it once, on the
   first state of a cold load (server wins); thereafter the web is the source and pushes every
   authored change up via setShowLibrary. localStorage is a fast cache (offline / first paint).

   This controller owns ONLY the once-per-session gate + echo/no-op suppression signatures; the
   store performs the rune swap (adoptLibrary) and the actual WS send. */

import { type ShowLibrary, deserializeShowLibrary, serializeShowLibrary } from '../persistence';

/** What a `state`-message reconcile decides the store should do. */
export type ReconcilePlan =
  | { kind: 'adopt'; library: ShowLibrary } // server has a library → swap it into the runes
  | { kind: 'seed' } //                        server has none → push our cache up to seed it
  | { kind: 'noop' }; //                       already synced this session → never clobber

export class ShowLibrarySync {
  /** Signature of the library last synchronized with the server (adopted or pushed). null until
      the FIRST `state` is reconciled — the gate that makes cold-load adopt happen exactly once
      and never clobber later in-session edits. */
  private lastLibrarySig: string | null = null;
  /** Set once the first `state` message has been reconciled. Gates {@link planPush} so a
      debounced push that races the connect handshake can't pre-empt the cold-load adopt. */
  private serverStateSeen = false;

  /** Stable signature of a library envelope (for echo/no-op suppression). */
  librarySig(lib: ShowLibrary): string {
    return JSON.stringify(serializeShowLibrary(lib));
  }

  /** Called from the first `state` handler (before reconcile), so a seed-push isn't gated off. */
  markServerStateSeen(): void {
    this.serverStateSeen = true;
  }

  /** Decide how to reconcile the server's library (`raw`) against ours on a `state` message.
      Runs the cold-load adopt exactly once (first state of the session); later states → noop.

      `hasLocalLibrary` is whether boot found REAL local content. For a single writer the
      localStorage cache is the freshest source (written on EVERY edit, while the server push is
      gated on link/sig), so when we have local content we KEEP it and push it up (`seed`) — never
      let the server clobber unsynced local edits (the node-positions-reset-on-refresh bug). We
      only ADOPT the server when there was nothing local to lose (a cleared / fresh browser — the
      "survive a localStorage clear" case). NOTE: single-writer assumption; a future multi-client
      model would compare a revision/version instead of preferring local outright. */
  planReconcile(raw: unknown, hasLocalLibrary: boolean): ReconcilePlan {
    if (this.lastLibrarySig !== null) return { kind: 'noop' }; // already synced — never clobber
    if (hasLocalLibrary) return { kind: 'seed' }; // local is freshest → keep it, push up
    const incoming = deserializeShowLibrary(raw);
    return incoming ? { kind: 'adopt', library: incoming } : { kind: 'seed' };
  }

  /** Mark the session synced WITHOUT echoing — called after an adopt (the server already holds
      this library; pass `librarySig(currentLibrary())`). A later authored edit diverges the
      signature and pushes normally via {@link planPush}. */
  noteSynced(sig: string): void {
    this.lastLibrarySig = sig;
  }

  /** Whether the current library envelope should be pushed to the server: only once the first
      `state` has been seen (so the cold-load adopt wins the race), and only when it actually
      changed (sig-guarded). Records the new signature when it returns true. */
  planPush(envelope: ReturnType<typeof serializeShowLibrary>): boolean {
    if (!this.serverStateSeen) return false;
    const sig = JSON.stringify(envelope);
    if (sig === this.lastLibrarySig) return false;
    this.lastLibrarySig = sig;
    return true;
  }
}
