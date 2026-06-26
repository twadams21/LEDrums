/* Shared hover state for the @xyflow/svelte graphs (Patch + Trigger): which node the
   pointer is over, and the wire-highlight that follows from it. Hovering a node lights
   the node (border accent, via CSS) AND every wire one level connected to it (an
   `edge-hot` class stamped by `decorate`), so a node reads clearly as a wiring target.

   There is deliberately NO node lift / motion — an earlier position-nudge "lift" made
   the node shift under the pointer, which fought wiring (the input handle moved as you
   tried to drop on it). Selection is also kept out of here: a selected node rings, but
   its wires do not light up. Only hover lights wires. */

/** Minimal shape this helper needs from an xyflow edge. */
interface FlowEdgeLike {
  source: string;
  target: string;
  class?: unknown;
}

export class GraphHover {
  /** Id of the node currently hovered (drives the wire highlight + drop targeting). */
  hoveredId = $state<string | null>(null);

  /** True when an edge touches the hovered node (in- or out-edge). */
  isHot(edge: FlowEdgeLike): boolean {
    const h = this.hoveredId;
    return !!h && (edge.source === h || edge.target === h);
  }

  /** Return a new edges array with `edge-hot` on every wire connected to the hovered
      node (and cleared elsewhere), preserving all other edge fields (incl. selection). */
  decorate<E extends FlowEdgeLike>(edges: E[]): E[] {
    return edges.map((e) => ({ ...e, class: this.isHot(e) ? 'edge-hot' : undefined }));
  }

  enter(id: string): void {
    this.hoveredId = id;
  }
  leave(): void {
    this.hoveredId = null;
  }
}
