import type { ShowLibrary } from '../persistence';

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
