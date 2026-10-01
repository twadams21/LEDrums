import type { EffectSection, ShowLibraryV3, SongLibraryV2 } from '../persistence';

/** Every generated id inside one effect-chains section: its id, each Effect's id and every
    device uid (Effect modifiers / controls and the master chain). */
function* idsFromEffectSection(section: Pick<EffectSection, 'id' | 'effects' | 'master'>): Iterable<string> {
  yield section.id;
  for (const effect of section.effects ?? []) {
    yield effect.id;
    for (const modifier of effect.modifiers ?? []) yield modifier.uid;
    for (const control of effect.controls ?? []) yield control.uid;
  }
  for (const modifier of section.master ?? []) yield modifier.uid;
}

/** Walk every generated id in a v3 show library (shows, songs, sections, Effects, device uids,
    canvas scenes) for id allocator reservation. */
export function* authoredIdsFromLibraryV3(lib: ShowLibraryV3): Iterable<string> {
  for (const show of Object.values(lib.shows)) {
    yield show.id;
    const authored = show.authored;
    for (const song of authored.songs ?? []) {
      yield song.id;
      for (const section of song.sections ?? []) yield* idsFromEffectSection(section);
    }
    for (const scene of authored.canvasScenes ?? []) yield scene.id;
  }
}

/** Walk every generated id in a v2 (effect-chains) song library. Section ids travel namespaced
    (`lib:<id>/…`, never a generated id); Effect ids and device uids travel raw, and a referenced
    song's Effects stay editable through a detach, so they are reserved too. */
export function* idsFromSongLibraryV2(lib: SongLibraryV2): Iterable<string> {
  for (const song of Object.values(lib.songs)) {
    yield song.id;
    for (const section of song.sections ?? []) yield* idsFromEffectSection(section);
    for (const scene of song.canvasScenes ?? []) yield scene.id;
  }
}
