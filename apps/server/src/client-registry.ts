/** Minimal socket surface the registry needs — just a graceful close. Keeps the registry
 * decoupled from `ws` so it is trivially unit-testable (mirrors the old `SingleClientLock`'s
 * `CloseableSocket`). */
export interface CloseableSocket {
  close(code?: number, reason?: string): void;
}

/** The presence payload for ONE recipient — the body of the `presence` ServerMessage. Per-socket
 * because `youAreEditor` differs by recipient (see {@link ClientRegistry.presenceFor}). */
export interface Presence {
  /** The current editor's opaque id, or null when no client holds the editor slot. */
  editorId: string | null;
  /** Whether the recipient socket is the editor. */
  youAreEditor: boolean;
  /** How many clients are currently connected. */
  clientCount: number;
}

/**
 * Multi-client registry (S1) — replaces `SingleClientLock`. Holds MANY live sockets at once (no
 * eviction) and tracks exactly ONE editor among them; later clients are viewers that live-follow
 * the editor's broadcast. Each socket gets an opaque, stable id on admit.
 *
 * Editor election rule (S1, pre-takeover):
 *  - the FIRST client to connect (no editor yet) auto-claims the editor slot;
 *  - if the editor leaves, the slot empties — UNLESS exactly one client remains, in which case
 *    that lone client auto-claims, so the standalone case stays editable;
 *  - `takeover` (explicit hand-off) is wired in S2.
 *
 * The engine/output loop is intentionally NOT referenced here — transmission is driven by the
 * host's own timer and keeps running regardless of how many clients are connected (including
 * zero). The registry only governs which sockets receive broadcasts and which one may mutate.
 *
 * Iterable (insertion order) so it drops into the existing `for (const ws of clients)` binary +
 * JSON broadcast loops.
 */
export class ClientRegistry<S extends CloseableSocket> {
  /** socket → opaque id, in admit order (Map preserves insertion order for iteration). */
  private readonly ids = new Map<S, string>();
  /** The editor's opaque id, or null when the slot is empty. */
  private editor: string | null = null;
  /** Monotonic id source — opaque, never reused, so a reconnecting socket is a distinct client. */
  private nextId = 1;

  /** Admit `socket` as a live client (additive — no eviction). Assigns and returns its opaque id;
   * the first client admitted with no editor present auto-claims the editor slot. Idempotent: a
   * socket already admitted keeps its id (and the editor assignment is untouched). */
  admit(socket: S): string {
    const existing = this.ids.get(socket);
    if (existing) return existing;
    const id = `c${this.nextId++}`;
    this.ids.set(socket, id);
    if (this.editor === null) this.editor = id; // first client with no editor → editor
    return id;
  }

  /** Drop `socket`. If it held the editor slot, the slot empties; then, if exactly one client
   * remains with no editor, that lone client auto-claims (so the standalone case stays editable).
   * A socket that was never admitted is ignored. */
  remove(socket: S): void {
    const id = this.ids.get(socket);
    if (id === undefined) return;
    this.ids.delete(socket);
    if (this.editor === id) this.editor = null; // editor left → slot empties
    if (this.editor === null && this.ids.size === 1) {
      // Down to a single client and nobody is editing → it auto-claims (standalone stays editable).
      this.editor = this.ids.values().next().value ?? null;
    }
  }

  /** The current editor's opaque id, or null when the slot is empty. */
  get editorId(): string | null {
    return this.editor;
  }

  /** Whether `socket` currently holds the editor slot. */
  isEditor(socket: S): boolean {
    return this.editor !== null && this.ids.get(socket) === this.editor;
  }

  /** Whether `socket` may apply authoritative mutations. In S1 this is exactly "is the editor";
   * S2 broadens the policy (read-only gating) behind this same seam. */
  canMutate(socket: S): boolean {
    return this.isEditor(socket);
  }

  /** Hand the editor slot to `socket`, returning the socket it demoted (or null if there was no
   * prior editor / `socket` isn't admitted / it already held the slot). The actual takeover UI is
   * wired in S2 — this is the registry-level primitive. */
  takeover(socket: S): S | null {
    const id = this.ids.get(socket);
    if (id === undefined) return null; // not a member — nothing to assign
    const prior = this.editor;
    this.editor = id;
    if (prior === null || prior === id) return null;
    for (const [s, sid] of this.ids) if (sid === prior) return s;
    return null;
  }

  /** The presence payload for `socket` (its own `youAreEditor`). */
  presenceFor(socket: S): Presence {
    return { editorId: this.editor, youAreEditor: this.isEditor(socket), clientCount: this.ids.size };
  }

  /** How many clients are connected. */
  get size(): number {
    return this.ids.size;
  }

  *[Symbol.iterator](): Iterator<S> {
    yield* this.ids.keys();
  }
}
