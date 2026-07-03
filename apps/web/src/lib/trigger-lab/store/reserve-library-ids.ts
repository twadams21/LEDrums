import type { ShowLibrary, SongLibrary } from '../persistence';
import type { LibrarySong } from './song-library';

/** Walk every persisted/generated authored id in a show library for id allocator reservation. */
export function* authoredIdsFromLibrary(lib: ShowLibrary): Iterable<string> {
  for (const show of Object.values(lib.shows)) {
    yield show.id;
    const authored = show.authored;

    for (const [graphKey, graph] of Object.entries(authored.graphs ?? {})) {
      yield graphKey;
      for (const node of graph.nodes ?? []) yield node.id;
      for (const edge of graph.edges ?? []) yield edge.id;
    }

    for (const song of authored.songs ?? []) {
      yield song.id;
      for (const section of song.sections ?? []) yield section.id;
    }

    for (const bus of authored.buses ?? []) yield bus.id;
    for (const preset of authored.presets ?? []) yield preset.id;
    for (const effect of authored.effects ?? []) yield effect.id;
  }
}

/** Walk every generated id inside ONE library-song closure that must be reserved. The pool id is
    namespaced-free (yielded here), but the crucial ones are the closure graphs' NODE + EDGE ids:
    `rekeyGraph` namespaces a graph's effect/preset refs, NOT its node/edge ids, so they travel raw
    (`n-<n>`/`e-<n>`) — and S42 lets a user EDIT a referenced graph (add a node), which mints a fresh
    `n-<n>`. Without reserving these, a high-numbered pasted/adopted node id collides with a later
    local mint (duplicate node id in one graph → ambiguous edges / misrouted modulation ports). */
export function* idsFromLibrarySong(song: LibrarySong): Iterable<string> {
  yield song.id;
  for (const graph of Object.values(song.graphs ?? {})) {
    for (const node of graph.nodes ?? []) yield node.id;
    for (const edge of graph.edges ?? []) yield edge.id;
  }
}

/** Walk every generated id in a whole song-library pool for reservation (supersedes reserving only
    the pool ids — it also covers the closure-internal node/edge ids). */
export function* idsFromSongLibrary(lib: SongLibrary): Iterable<string> {
  for (const song of Object.values(lib.songs)) yield* idsFromLibrarySong(song);
}
