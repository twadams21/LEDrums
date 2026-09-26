/* New-show templates (Tim, 2026-09-27): "a blank project, or a template from known trigger
   inputs". Pure — the store passes in the zones Settings declares and gets back the authored
   content the new show starts from. Both templates drop the demo content `seedAuthored` carries
   (fixture pads and sections), keeping only its library (buses, presets, effects) and defaults. */

import { type TriggerGraph } from '../sim';
import type { AuthoredState } from '../persistence';
import * as setlist from '../../app/setlist';
import { buildEmptyGraph } from './graphs';
import { seedAuthored } from './seed';

export type ShowTemplate = 'blank' | 'zones';

/** A declared drum zone and the name its graph gets. */
export interface TemplateZone {
  drumId: string;
  slot: number;
  title: string;
}

/** An empty graph (trigger → output) that fires from one drum zone. */
export function zoneGraph(zone: Pick<TemplateZone, 'drumId' | 'slot'>): TriggerGraph {
  const graph = buildEmptyGraph();
  const trigger = graph.nodes.find((node) => node.kind === 'trigger');
  if (trigger) trigger.source = { kind: 'drum', drumId: zone.drumId, zone: String(zone.slot) };
  return graph;
}

/**
 * The authored content of a new show. `blank`: one song with one empty section. `zones`: the same,
 * with one empty graph per declared zone in that section, and the show set to give every later
 * new section its own set too ({@link AuthoredState.autoZoneGraphs}).
 */
export function templateAuthored(template: ShowTemplate, zones: readonly TemplateZone[]): AuthoredState {
  const graphs: Record<string, TriggerGraph> = {};
  const graphNames: Record<string, string> = {};
  if (template === 'zones') {
    zones.forEach((zone, i) => {
      const key = `graph-${i + 1}`;
      graphs[key] = zoneGraph(zone);
      graphNames[key] = zone.title;
    });
  }
  const keys = Object.keys(graphs);
  const song = setlist.makeSong('song-1', 'Song 1', [setlist.makeSection('song-1-s1', 'Section 1', keys)]);
  return {
    ...seedAuthored(),
    graphs,
    graphNames,
    songs: [song],
    selectedPadKey: keys[0] ?? null,
    activeSongId: song.id,
    activeSectionId: song.sections[0]?.id ?? null,
    autoZoneGraphs: template === 'zones',
  };
}
