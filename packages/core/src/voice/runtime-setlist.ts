import { graphAt } from './graph-lookup';
import type { SlotRefs, SongSection, TriggerGraph, TriggerSource } from './types';

/** A trigger graph's declared input source, or undefined for an unbound graph. */
export function triggerSourceOf(graph: TriggerGraph): TriggerSource | undefined {
  return graph.nodes.find((node) => node.kind === 'trigger')?.source;
}

/**
 * Convert the authored flat section graph list to the runtime section shape.
 *
 * The flat list is the complete performance list. Drum sources are also grouped into the
 * legacy-compatible pad slot grid so physical pad routing keeps its existing semantics.
 */
export function runtimeSectionFromGraphKeys(args: {
  id: string;
  name: string;
  graphKeys: readonly string[];
  graphs: Readonly<Record<string, TriggerGraph>>;
}): SongSection {
  const slots: SlotRefs = {};
  for (const key of args.graphKeys) {
    const graph = graphAt(args.graphs, key);
    if (!graph) throw new Error(`Missing section graph: ${key}`);
    const source = triggerSourceOf(graph);
    if (source?.kind === 'drum') {
      (slots[`${source.drumId}:${source.zone}`] ??= []).push(key);
    }
  }
  return {
    id: args.id,
    name: args.name,
    performanceGraphKeys: [...args.graphKeys],
    slots,
  };
}
