/* INIT-02 S15 — the characterization matrix over ShowLibrarySync and SongLibrarySync.

   duplicated-code-0003 wants these two collapsed into one generic (S16). Their bodies are subtle —
   viewer-follow, the once-per-session gate, local-wins seed, echo suppression, and the
   serverStateSeen push gate — and the existing store-level suites (store.server-library.test.ts,
   store.song-library.test.ts) exercise them only THROUGH the store, so they do not pin these units
   directly. This file does: ONE table-driven matrix run against BOTH classes.

   THIS IS THE PARITY CONTRACT S16 MUST NOT MOVE. When the two classes collapse into
   `LibrarySync<L, W>`, only the two subject literals below change — every assertion row stays
   byte-identical. The matrix is deliberately written as explicit expected values per row rather
   than re-deriving the policy, so a transposed guard shows up as a red row, not as a matching bug.

   Coverage:
     planReconcile — the full {isViewer} x {lastLibrarySig null|set} x {hasLocalLibrary} x
                     {raw deserializes|garbage} cross product (16 rows), including the two rows
                     that pin `hasLocalLibrary` as IGNORED for a viewer, and the local-wins row
                     where a perfectly good server library is still refused.
     planFollow    — garbage, same-sig echo, genuinely different, and the null-sig first follow.
     planPush      — the serverStateSeen gate (and that a refused push does NOT record the sig),
                     unchanged-envelope suppression, changed-envelope push.
     librarySig    — stable for equal libraries, distinct for different ones. */

import { describe, expect, it } from 'vitest';
import { ShowLibrarySync } from './show-library-sync';
import { SongLibrarySync } from './song-library-sync';
import {
  deserializeShowLibrary,
  deserializeSongLibrary,
  serializeShowLibrary,
  serializeSongLibrary,
  type AuthoredState,
  type ShowLibrary,
  type SongLibrary,
} from '../persistence';
import type { LibrarySong } from './song-library';

/** The plan shape both classes return (and that the S16 generic must keep returning). */
type Plan<L> = { kind: 'adopt'; library: L } | { kind: 'seed' } | { kind: 'noop' };

/** The structural surface under test — declared HERE so it survives S16 unchanged. */
interface LibrarySyncLike<L, W> {
  librarySig(lib: L): string;
  markServerStateSeen(): void;
  planReconcile(raw: unknown, hasLocalLibrary: boolean, isViewer: boolean): Plan<L>;
  planFollow(raw: unknown): Plan<L>;
  noteSynced(sig: string): void;
  planPush(envelope: W): boolean;
}

interface Subject<L, W> {
  readonly label: string;
  create(): LibrarySyncLike<L, W>;
  serialize(lib: L): W;
  /** Two libraries that round-trip stably, so an `adopt` can be asserted by exact identity. */
  readonly libA: L;
  readonly libB: L;
}

// ---- the two subjects (the ONLY lines S16 is allowed to change) -------------

const show = (id: string): ShowLibrary => ({
  shows: { [id]: { id, name: id, authored: {} as AuthoredState } },
  activeShowId: id,
});
const showSubject: Subject<ShowLibrary, ReturnType<typeof serializeShowLibrary>> = {
  label: 'ShowLibrarySync',
  create: () => new ShowLibrarySync(),
  serialize: serializeShowLibrary,
  libA: deserializeShowLibrary(serializeShowLibrary(show('show-a')))!,
  libB: deserializeShowLibrary(serializeShowLibrary(show('show-b')))!,
};

const librarySong = (id: string): LibrarySong => ({
  id,
  name: id,
  sections: [],
  graphs: {},
  graphNames: {},
  effects: [],
  presets: [],
});
const songs = (...ids: string[]): SongLibrary => ({ songs: Object.fromEntries(ids.map((id) => [id, librarySong(id)])) });
const songSubject: Subject<SongLibrary, ReturnType<typeof serializeSongLibrary>> = {
  label: 'SongLibrarySync',
  create: () => new SongLibrarySync(),
  serialize: serializeSongLibrary,
  libA: deserializeSongLibrary(serializeSongLibrary(songs('song-a')))!,
  libB: deserializeSongLibrary(serializeSongLibrary(songs('song-b')))!,
};

// ---- the matrix (identical for both subjects) -------------------------------

/** Raw payloads that must NOT deserialize — a non-object, and a well-shaped wrong-version envelope. */
const GARBAGE = 'junk';

type Row<L> = {
  isViewer: boolean;
  /** Whether the session has already synced once (lastLibrarySig set, via noteSynced(libA)). */
  sigSet: boolean;
  hasLocalLibrary: boolean;
  /** Whether `raw` is a deserializable envelope of libB, or garbage. */
  rawOk: boolean;
  want: Plan<L>;
  why: string;
};

function runParityMatrix<L, W>(s: Subject<L, W>): void {
  /** A fresh sync, optionally already synced to libA (so `lastLibrarySig` is set). */
  const fresh = (sigSet: boolean): LibrarySyncLike<L, W> => {
    const sync = s.create();
    if (sigSet) sync.noteSynced(sync.librarySig(s.libA));
    return sync;
  };
  const adoptB: Plan<L> = { kind: 'adopt', library: s.libB };
  const seed: Plan<L> = { kind: 'seed' };
  const noop: Plan<L> = { kind: 'noop' };

  describe(`${s.label} — planReconcile matrix`, () => {
    const rows: Row<L>[] = [
      // EDITOR / STANDALONE — the single-writer cold-load policy.
      { isViewer: false, sigSet: false, hasLocalLibrary: false, rawOk: false, want: seed, why: 'cold, nothing local, server unusable → seed ours up' },
      { isViewer: false, sigSet: false, hasLocalLibrary: false, rawOk: true, want: adoptB, why: 'cold, nothing local to lose → adopt the server (survive a localStorage clear)' },
      { isViewer: false, sigSet: false, hasLocalLibrary: true, rawOk: false, want: seed, why: 'cold, local content, server unusable → keep local' },
      { isViewer: false, sigSet: false, hasLocalLibrary: true, rawOk: true, want: seed, why: 'LOCAL WINS: a good server library is refused rather than clobber unsynced local edits' },
      { isViewer: false, sigSet: true, hasLocalLibrary: false, rawOk: false, want: noop, why: 'already synced this session → never clobber' },
      { isViewer: false, sigSet: true, hasLocalLibrary: false, rawOk: true, want: noop, why: 'once-per-session gate beats a good server library' },
      { isViewer: false, sigSet: true, hasLocalLibrary: true, rawOk: false, want: noop, why: 'once-per-session gate, local irrelevant' },
      { isViewer: false, sigSet: true, hasLocalLibrary: true, rawOk: true, want: noop, why: 'once-per-session gate, local irrelevant' },
      // VIEWER — always routes through planFollow: never seeds, hasLocalLibrary is IGNORED.
      { isViewer: true, sigSet: false, hasLocalLibrary: false, rawOk: false, want: noop, why: 'viewer, unusable server payload → nothing to follow' },
      { isViewer: true, sigSet: false, hasLocalLibrary: false, rawOk: true, want: adoptB, why: 'viewer follows the editor on every state' },
      { isViewer: true, sigSet: false, hasLocalLibrary: true, rawOk: false, want: noop, why: 'viewer NEVER seeds — hasLocalLibrary is ignored' },
      { isViewer: true, sigSet: false, hasLocalLibrary: true, rawOk: true, want: adoptB, why: 'viewer NEVER seeds — hasLocalLibrary is ignored, it still follows' },
      { isViewer: true, sigSet: true, hasLocalLibrary: false, rawOk: false, want: noop, why: 'viewer, unusable payload, already-synced is irrelevant' },
      { isViewer: true, sigSet: true, hasLocalLibrary: false, rawOk: true, want: adoptB, why: 'the once-per-session gate does NOT apply to a viewer' },
      { isViewer: true, sigSet: true, hasLocalLibrary: true, rawOk: false, want: noop, why: 'viewer, unusable payload' },
      { isViewer: true, sigSet: true, hasLocalLibrary: true, rawOk: true, want: adoptB, why: 'viewer live-follows regardless of gate + local content' },
    ];

    for (const row of rows) {
      const name = `viewer=${row.isViewer} synced=${row.sigSet} local=${row.hasLocalLibrary} rawOk=${row.rawOk} → ${row.want.kind} (${row.why})`;
      it(name, () => {
        const sync = fresh(row.sigSet);
        const raw = row.rawOk ? s.serialize(s.libB) : GARBAGE;
        expect(sync.planReconcile(raw, row.hasLocalLibrary, row.isViewer)).toEqual(row.want);
      });
    }
  });

  describe(`${s.label} — planFollow`, () => {
    it('noops on a payload that does not deserialize', () => {
      expect(fresh(false).planFollow(GARBAGE)).toEqual(noop);
    });

    it('noops on a wrong-version envelope (well-shaped but unusable)', () => {
      const envelope = s.serialize(s.libB) as { version: number };
      expect(fresh(false).planFollow({ ...envelope, version: 999 })).toEqual(noop);
    });

    it('adopts on the first follow, when nothing has been synced yet (null sig never echoes)', () => {
      expect(fresh(false).planFollow(s.serialize(s.libB))).toEqual(adoptB);
    });

    it('suppresses its own echo — the library it last synced comes back as a noop', () => {
      const sync = s.create();
      sync.noteSynced(sync.librarySig(s.libB));
      expect(sync.planFollow(s.serialize(s.libB))).toEqual(noop);
    });

    it('adopts a genuinely different library after an echo-suppressed one', () => {
      const sync = s.create();
      sync.noteSynced(sync.librarySig(s.libA));
      expect(sync.planFollow(s.serialize(s.libA))).toEqual(noop);
      expect(sync.planFollow(s.serialize(s.libB))).toEqual(adoptB);
    });

    it('never seeds — a follow only ever adopts or noops', () => {
      const sync = fresh(false);
      const kinds = [sync.planFollow(GARBAGE).kind, sync.planFollow(s.serialize(s.libB)).kind];
      expect(kinds).not.toContain('seed');
    });
  });

  describe(`${s.label} — planPush`, () => {
    it('refuses to push before the first server state is seen', () => {
      expect(fresh(false).planPush(s.serialize(s.libA))).toBe(false);
    });

    it('a refused push does NOT record the signature — the same envelope pushes once state is seen', () => {
      const sync = s.create();
      const envelope = s.serialize(s.libA);
      expect(sync.planPush(envelope)).toBe(false);
      sync.markServerStateSeen();
      expect(sync.planPush(envelope)).toBe(true);
    });

    it('suppresses an unchanged envelope and pushes a changed one', () => {
      const sync = s.create();
      sync.markServerStateSeen();
      expect(sync.planPush(s.serialize(s.libA))).toBe(true);
      expect(sync.planPush(s.serialize(s.libA))).toBe(false); // unchanged → suppressed
      expect(sync.planPush(s.serialize(s.libB))).toBe(true); //  changed  → pushed
      expect(sync.planPush(s.serialize(s.libB))).toBe(false); // and re-suppressed at the new sig
    });

    it('an adopt (noteSynced) suppresses the echoing push of the very library just adopted', () => {
      const sync = s.create();
      sync.markServerStateSeen();
      sync.noteSynced(sync.librarySig(s.libB));
      expect(sync.planPush(s.serialize(s.libB))).toBe(false);
      expect(sync.planPush(s.serialize(s.libA))).toBe(true);
    });
  });

  describe(`${s.label} — librarySig`, () => {
    it('is stable for equal libraries and distinct for different ones', () => {
      const sync = s.create();
      expect(sync.librarySig(s.libA)).toBe(sync.librarySig(s.libA));
      expect(sync.librarySig(s.libA)).not.toBe(sync.librarySig(s.libB));
    });

    it('matches the serialized envelope the push gate compares against', () => {
      const sync = s.create();
      expect(sync.librarySig(s.libA)).toBe(JSON.stringify(s.serialize(s.libA)));
    });
  });
}

runParityMatrix(showSubject);
runParityMatrix(songSubject);
