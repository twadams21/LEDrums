/* Pure mini-map of a trigger graph for the Graphs-dock cards: node positions
   normalized into a small viewBox, edges as the same horizontal-bezier shape the
   real canvas draws. Display-only — a doodle of the REAL graph structure, so two
   cards never look interchangeable. Each dot carries its node kind so the card can
   tint it with that kind's type colour (`trigger-node-meta`'s `tint`). */
import type { NodeKind } from '../../trigger-lab/sim';

export interface ThumbGraph {
  nodes: ReadonlyArray<{ id: string; x: number; y: number; kind?: NodeKind }>;
  edges: ReadonlyArray<{ from: string; to: string }>;
}

export interface ThumbDot {
  x: number;
  y: number;
  /** The node's kind — the card resolves it to a type tint. Absent for kind-less input. */
  kind?: NodeKind;
}

export interface ThumbSpec {
  dots: ThumbDot[];
  /** SVG path `d` strings, one per edge whose endpoints both resolve. */
  paths: string[];
}

/** Scale the graph's node positions into a `w`×`h` box with `pad` margin (aspect
    preserved per-axis is NOT required for a doodle; each axis scales to fill).
    Degenerate spans (single node / all nodes on one line) centre on that axis.
    The default box matches the rail card's aspect (~2.7:1) and the pad is generous
    enough that the outermost points sit clear of the card edge at every rail width. */
export function graphThumb(graph: ThumbGraph, w = 172, h = 64, pad = 12): ThumbSpec {
  const ns = graph.nodes;
  if (ns.length === 0) return { dots: [], paths: [] };
  const xs = ns.map((n) => n.x);
  const ys = ns.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sx = (x: number): number =>
    maxX === minX ? w / 2 : pad + ((x - minX) / (maxX - minX)) * (w - pad * 2);
  const sy = (y: number): number =>
    maxY === minY ? h / 2 : pad + ((y - minY) / (maxY - minY)) * (h - pad * 2);

  const at = new Map(ns.map((n) => [n.id, { x: sx(n.x), y: sy(n.y) }]));
  const paths: string[] = [];
  for (const e of graph.edges) {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) continue;
    const mx = (a.x + b.x) / 2;
    paths.push(`M${r(a.x)},${r(a.y)} C${r(mx)},${r(a.y)} ${r(mx)},${r(b.y)} ${r(b.x)},${r(b.y)}`);
  }
  const dots = ns.map((n) => {
    const p = at.get(n.id)!;
    return n.kind === undefined ? { x: r(p.x), y: r(p.y) } : { x: r(p.x), y: r(p.y), kind: n.kind };
  });
  return { dots, paths };
}

/** One-decimal round — keeps the SVG strings short and the tests exact. */
function r(v: number): number {
  return Math.round(v * 10) / 10;
}
