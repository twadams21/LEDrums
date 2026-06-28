/* Value-switch (gate + bands) math — the fiddly cutoff bookkeeping behind the store's
   switch mutators, as PURE array transforms (no runes/DOM) so the clamp / port-remap / dedup
   invariants are unit-testable in isolation. The store's `setSwitchOn` / `addBand` /
   `removeBand` / `setBandCutoff` apply these onto the live `$state` node + edges. Extracted
   from store.svelte.ts unchanged in behaviour. */

import type { GraphEdge, GraphNode, ValueMode } from '../sim';

/** Clamp a number into [0, 1]. */
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The value-switch field defaults backfilled the first time a node becomes a value switch
    (a graph persisted before value-mode lacks them) — present values win, mirrors the old
    `ensureValueDefaults`. The store assigns these onto the live node. */
export function valueDefaults(node: GraphNode): {
  valueMode: ValueMode;
  threshold: number;
  invert: boolean;
  bands: number[];
} {
  return {
    valueMode: node.valueMode ?? 'gate',
    threshold: node.threshold ?? 0.5,
    invert: node.invert ?? false,
    bands: Array.isArray(node.bands) && node.bands.length > 0 ? node.bands : [0.5],
  };
}

/** Append a band by splitting the final "rest" band (a new cutoff between the last cutoff and
    1). Appending never disturbs existing band ports. */
export function addBand(bands: readonly number[] | undefined): number[] {
  const cur = Array.isArray(bands) && bands.length ? bands : [0.5];
  const last = cur[cur.length - 1] ?? 0.5;
  return [...cur, clamp01((last + 1) / 2)];
}

/** Whether cutoff `cutoffIndex` may be removed — keeps at least one cutoff (≥2 bands) and
    rejects an out-of-range index. */
export function canRemoveBand(bands: readonly number[] | undefined, cutoffIndex: number): boolean {
  const cur = bands ?? [0.5];
  return cur.length > 1 && cutoffIndex >= 0 && cutoffIndex < cur.length;
}

/** Drop cutoff `cutoffIndex` (merging band cutoffIndex+1 down into it). Caller guards with
    {@link canRemoveBand}. */
export function removeBandAt(bands: readonly number[] | undefined, cutoffIndex: number): number[] {
  const cur = bands ?? [0.5];
  return cur.filter((_, i) => i !== cutoffIndex);
}

/** Set cutoff `cutoffIndex`, clamped WITHIN its neighbours so cutoffs stay ascending without
    reordering — reordering would scramble which band each port maps to. Returns the SAME array
    contents when the index is out of range (caller may skip the assign). */
export function setBandCutoff(bands: readonly number[] | undefined, cutoffIndex: number, value: number): number[] {
  const out = [...(bands ?? [0.5])];
  if (cutoffIndex < 0 || cutoffIndex >= out.length) return out;
  const lo = cutoffIndex > 0 ? out[cutoffIndex - 1]! : 0;
  const hi = cutoffIndex < out.length - 1 ? out[cutoffIndex + 1]! : 1;
  out[cutoffIndex] = Math.min(hi, Math.max(lo, clamp01(value)));
  return out;
}

/** Drop per-band source ports from a node's outgoing edges, collapsing them to the default
    output — so leaving bands mode never strands a wire on a handle the node no longer renders
    (which xyflow can't draw). Returns a new edges array (matching edges rewritten to drop
    `fromPort`; others kept by reference). */
export function stripBandPorts(edges: readonly GraphEdge[], nodeId: string): GraphEdge[] {
  return edges.map((e) => (e.from === nodeId && e.fromPort !== undefined ? { ...e, fromPort: undefined } : e));
}

/** After cutoff `removed` is dropped, band (removed+1) merges into `removed` and every higher
    band shifts down one — remap the node's outgoing band ports to match, then drop any duplicate
    (target, port) wires the merge collided. Returns a new edges array. */
export function remapBandPorts(edges: readonly GraphEdge[], nodeId: string, removed: number): GraphEdge[] {
  const seen = new Set<string>();
  const kept: GraphEdge[] = [];
  for (const e of edges) {
    if (e.from === nodeId && e.fromPort?.startsWith('band-')) {
      const b = Number(e.fromPort.slice('band-'.length));
      const fromPort = Number.isFinite(b) && b > removed ? `band-${b - 1}` : e.fromPort;
      const key = `${e.to}|${fromPort}`;
      if (seen.has(key)) continue; // merge collided two wires onto the same band+target
      seen.add(key);
      kept.push(fromPort === e.fromPort ? e : { ...e, fromPort });
    } else {
      kept.push(e);
    }
  }
  return kept;
}
