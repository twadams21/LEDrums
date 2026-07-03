/* Server-authoritative SONG-library controller (S40) — the cold-load-adopt + write-through path,
   a sibling of {@link import('./show-library-sync').ShowLibrarySync}. The server owns the authored
   song library (a second opaque versioned blob, like the show library): it persists it and
   broadcasts it on `state`. The web ADOPTS it once, on the first state of a cold load (server
   wins); thereafter the web is the source and pushes every change up via `setSongLibrary`.
   localStorage is a fast cache (offline / first paint).

   This controller owns ONLY the once-per-session gate + echo/no-op suppression signatures, exactly
   as ShowLibrarySync does; the store (S41, when it wires refs/resolve/content) performs the rune
   swap + the actual WS send. Kept parallel to ShowLibrarySync so the two libraries reconcile
   identically — a single-writer cold-load-adopt, viewer live-follow, seed-when-local-is-freshest. */

import { type SongLibrary, deserializeSongLibrary, serializeSongLibrary } from '../persistence';

/** What a `state`-message reconcile decides the store should do (mirrors show-library's plan). */
export type SongReconcilePlan =
  | { kind: 'adopt'; library: SongLibrary } // server has a library → swap it into the runes
  | { kind: 'seed' } //                        server has none → push our cache up to seed it
  | { kind: 'noop' }; //                       already synced this session → never clobber

export class SongLibrarySync {
  /** Signature of the library last synchronized with the server (adopted or pushed). null until
      the FIRST `state` is reconciled — the gate that makes cold-load adopt happen exactly once. */
  private lastLibrarySig: string | null = null;
  /** Set once the first `state` message has been reconciled. Gates {@link planPush} so a debounced
      push that races the connect handshake can't pre-empt the cold-load adopt. */
  private serverStateSeen = false;

  /** Stable signature of a library envelope (for echo/no-op suppression). */
  librarySig(lib: SongLibrary): string {
    return JSON.stringify(serializeSongLibrary(lib));
  }

  /** Called from the first `state` handler (before reconcile), so a seed-push isn't gated off. */
  markServerStateSeen(): void {
    this.serverStateSeen = true;
  }

  /** Decide how to reconcile the server's song library (`raw`) against ours on a `state` message.
      ROLE-AWARE (multi-client), identical policy to ShowLibrarySync: a VIEWER always follows the
      editor's broadcast (sig-guarded, never seeds); an EDITOR / STANDALONE adopts exactly once on
      the first state, keeps freshest local content otherwise (seeds it up), and only adopts the
      server when there was nothing local to lose. */
  planReconcile(raw: unknown, hasLocalLibrary: boolean, isViewer: boolean): SongReconcilePlan {
    if (isViewer) return this.planFollow(raw); // viewer follows the server, every state
    if (this.lastLibrarySig !== null) return { kind: 'noop' }; // already synced — never clobber
    if (hasLocalLibrary) return { kind: 'seed' }; // local is freshest → keep it, push up
    const incoming = deserializeSongLibrary(raw);
    return incoming ? { kind: 'adopt', library: incoming } : { kind: 'seed' };
  }

  /** Decide whether to follow a server-pushed library (`raw`) — the live `songLibrary` broadcast a
      viewer receives, or a viewer's `state`. Adopt when it deserializes AND differs from what we
      last synced; the editor ignores its own echo. Never seeds. */
  planFollow(raw: unknown): SongReconcilePlan {
    const incoming = deserializeSongLibrary(raw);
    if (!incoming) return { kind: 'noop' };
    if (this.librarySig(incoming) === this.lastLibrarySig) return { kind: 'noop' }; // own echo / unchanged
    return { kind: 'adopt', library: incoming };
  }

  /** Mark the session synced WITHOUT echoing — called after an adopt (the server already holds this
      library; pass `librarySig(currentLibrary())`). A later edit diverges the signature + pushes. */
  noteSynced(sig: string): void {
    this.lastLibrarySig = sig;
  }

  /** Whether the current library envelope should be pushed to the server: only once the first
      `state` has been seen (so cold-load adopt wins the race), and only when it actually changed. */
  planPush(envelope: ReturnType<typeof serializeSongLibrary>): boolean {
    if (!this.serverStateSeen) return false;
    const sig = JSON.stringify(envelope);
    if (sig === this.lastLibrarySig) return false;
    this.lastLibrarySig = sig;
    return true;
  }
}
