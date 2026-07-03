/* Shared hover state for the @xyflow/svelte graphs (Patch + Trigger): which node the
   pointer is over, and the wire-highlight that follows from it. Hovering a node lights
   the node (border accent, via CSS) AND every wire one level connected to it (an
   `edge-hot` class stamped by `decorate`), so a node reads clearly as a wiring target.

   There is deliberately NO node lift / motion — an earlier position-nudge "lift" made
   the node shift under the pointer, which fought wiring (the input handle moved as you
   tried to drop on it). Selection is also kept out of here: a selected node rings, but
   its wires do not light up. Only hover lights wires. */

/** Minimal shape this helper needs from an xyflow edge. `data.mod` marks a modifier-chain
    wire and `data.modulation` a modulation (source→param) wire — each styled distinctly from
    trigger-flow wires; both are intrinsic to the edge and must survive the transient
    hover-highlight decoration. */
interface FlowEdgeLike {
  source: string;
  target: string;
  class?: unknown;
  data?: { mod?: boolean; modulation?: boolean };
}

export class GraphHover {
  /** Id of the node currently hovered (drives the wire highlight + drop targeting). */
  hoveredId = $state<string | null>(null);

  /** True when an edge touches the hovered node (in- or out-edge). */
  isHot(edge: FlowEdgeLike): boolean {
    const h = this.hoveredId;
    return !!h && (edge.source === h || edge.target === h);
  }

  /** Return a new edges array with `edge-hot` on every wire connected to the hovered node
      (and cleared elsewhere) COMBINED with the intrinsic `edge-mod` class for modifier wires,
      preserving all other edge fields (incl. selection). Order puts `edge-mod` first so the
      hover accent (`edge-hot`, later in the CSS cascade) still wins its stroke on a mod wire. */
  decorate<E extends FlowEdgeLike>(edges: E[]): E[] {
    return edges.map((e) => {
      const cls = [
        e.data?.mod ? 'edge-mod' : null,
        e.data?.modulation ? 'edge-modulation' : null,
        this.isHot(e) ? 'edge-hot' : null,
      ]
        .filter(Boolean)
        .join(' ');
      return { ...e, class: cls || undefined };
    });
  }

  enter(id: string): void {
    this.hoveredId = id;
  }
  leave(): void {
    this.hoveredId = null;
  }
}
