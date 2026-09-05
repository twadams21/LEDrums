import { BUILTIN_CANVAS_SCENES, CANVAS_PARAM_SPEC, canvasEffectId, resolveEffectAlias, type CanvasScene, type voice } from '@ledrums/core';
import { showSchema } from '@ledrums/protocol';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid authored library object');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid authored library array');
  return value;
}

/** Restore boundary for the existing web-owned library envelope, not a second authoring model.
 * Keep unknown fields in the stored blob; project only the runtime Show through the SAME protocol
 * gate used by setShow. Older unsupported/corrupt shapes fail before any live mutation. */
export function showFromLibraries(showLibrary: unknown, songLibrary: unknown): voice.Show | null {
  if (showLibrary === null) return null;
  const data = object(object(showLibrary).data);
  const shows = object(data.shows);
  if (Object.keys(shows).length === 0) return null;
  const selected = shows[String(data.activeShowId)] ?? Object.values(shows)[0];
  const authored = object(object(selected).authored);
  const graphs = structuredClone(object(authored.graphs ?? {}));
  const effects = [...array(authored.effects ?? [])];
  const presets = [...array(authored.presets ?? [])];
  const songs = [...array(authored.songs ?? [])];
  const librarySongs = songLibrary === null ? {} : object(object(object(songLibrary).data).songs ?? {});
  for (const id of new Set(array(authored.songRefs ?? []))) {
    const entry = librarySongs[String(id)];
    if (!entry) continue;
    const lib = object(entry);
    Object.assign(graphs, structuredClone(object(lib.graphs)));
    for (const [target, source] of [[effects, lib.effects], [presets, lib.presets]] as const) {
      for (const value of array(source)) {
        if (!target.some((v) => object(v).id === object(value).id)) target.push(value);
      }
    }
    songs.push({ id: lib.id, name: lib.name, sections: lib.sections });
  }
  const activeSong = songs.find((s) => object(s).id === authored.activeSongId) ?? songs[0];
  const runtime = showSchema.parse({
    buses: authored.buses ?? [], graphs, effects, presets,
    sections: activeSong ? array(object(activeSong).sections).map((s) => ({ ...object(s), looks: object(s).looks ?? {} })) : [],
  });
  // Match buildShow's alias policy, preserving unknown graph fields through the protocol gate.
  for (const graph of Object.values(runtime.graphs)) {
    for (const node of graph.nodes) {
      if ((node.kind === 'play' || node.kind === 'effect') && node.effectId) {
        const id = resolveEffectAlias(node.effectId);
        if (id !== node.effectId) { node.effectId = id; node.presetId = `${id}:default`; }
      }
    }
  }
  runtime.songs = songs.map((s) => {
    const song = object(s);
    if (typeof song.id !== 'string' || typeof song.name !== 'string') throw new Error('Invalid authored song');
    return { id: song.id, name: song.name, sections: array(song.sections).map((v) => {
      const section = object(v);
      if (typeof section.id !== 'string' || typeof section.name !== 'string') throw new Error('Invalid authored section');
      const slots: Record<string, string[]> = {};
      for (const key of array(section.graphs ?? [])) {
        const graph = runtime.graphs[String(key)];
        if (!graph) throw new Error(`Missing section graph: ${String(key)}`);
        const source = graph.nodes.find((n) => n.kind === 'trigger')?.source;
        if (source?.kind === 'drum') (slots[`${source.drumId}:${source.zone}`] ??= []).push(String(key));
      }
      return { id: section.id, name: section.name, slots };
    }) };
  });
  const scenes = array(authored.canvasScenes ?? []) as CanvasScene[];
  runtime.canvasScenes = scenes;
  for (const scene of [...scenes, ...BUILTIN_CANVAS_SCENES]) {
    const id = canvasEffectId(scene.id);
    if (runtime.effects.some((e) => e.id === id)) continue;
    runtime.effects.push({ id, name: scene.name, generatorId: id,
      busId: 'base', scope: 'kit', params: [], attackMs: 800, sustainMs: 0, releaseMs: 900 });
    runtime.presets.push({ id: `${id}:default`, name: 'Default', effectId: id,
      params: Object.fromEntries(CANVAS_PARAM_SPEC.map((p) => [p.key, p.default])) });
  }
  return runtime;
}

export function selectionFromLibrary(library: unknown): { songId?: string; sectionId: string } | undefined {
  if (library === null) return undefined;
  const data = object(object(library).data);
  const selected = object(data.shows)[String(data.activeShowId)];
  if (!selected) return undefined;
  const authored = object(object(selected).authored);
  return typeof authored.activeSectionId === 'string'
    ? { songId: typeof authored.activeSongId === 'string' ? authored.activeSongId : undefined, sectionId: authored.activeSectionId }
    : undefined;
}
