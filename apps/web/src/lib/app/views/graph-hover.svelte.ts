/* Shared hover / lift / wire-highlight interaction for the @xyflow/svelte graphs
   (Patch + Trigger). One precise behaviour, authored once:

   - On node hover the node LIFTS — but a CSS `transform` on the card leaves xyflow's
     handles + edges behind (the old Patch detach bug). The fix is xyflow-native:
     nudge the node's ACTUAL position up a couple px so xyflow re-routes its edges and
     moves its handles as one unit. Restored on leave.
   - Every wire one level connected to the hovered node highlights (accent stroke);
     `decorate()` stamps an `edge-hot` class onto those edges for the view's CSS.
   - Selection is deliberately NOT here — a selected node rings, but its wires do not
     light up. Only hover lights wires.

   Guards: never fights an active drag (lift is dropped on drag start, blocked until
   drag stop), and respects `prefers-reduced-motion` (highlight only, no nudge).

   The view owns the bound `$state.raw` node/edge arrays; these methods take an array
   and return the next one so the view stays the single writer. */

/** Minimal shape this helper needs from an xyflow node. */
interface FlowNodeLike {
  id: string;
  position: { x: number; y: number };
}
/** Minimal shape this helper needs from an xyflow edge. */
interface FlowEdgeLike {
  source: string;
  target: string;
  class?: unknown;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class GraphHover {
  /** Id of the node currently hovered (drives the wire highlight). */
  hoveredId = $state<string | null>(null);

  /** Id of the node currently nudged up, or null. Plain field — not reactive. */
  #liftId: string | null = null;
  #dragging = false;
  readonly #lift: number;
  readonly #reduce: boolean;

  constructor(lift = 2) {
    this.#lift = lift;
    this.#reduce = prefersReducedMotion();
  }

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

  #shift<N extends FlowNodeLike>(nodes: N[], id: string, dy: number): N[] {
    return nodes.map((n) =>
      n.id === id ? { ...n, position: { x: n.position.x, y: n.position.y + dy } } : n,
    );
  }

  /** Pointer entered `id`: mark it hovered and lift it (unless dragging / reduced-motion). */
  enter<N extends FlowNodeLike>(id: string, nodes: N[]): N[] {
    this.hoveredId = id;
    if (this.#reduce || this.#dragging || this.#liftId === id) return nodes;
    let next = nodes;
    if (this.#liftId) next = this.#shift(next, this.#liftId, this.#lift); // drop a stale lift
    next = this.#shift(next, id, -this.#lift);
    this.#liftId = id;
    return next;
  }

  /** Pointer left: clear the hover and restore the lifted node. */
  leave<N extends FlowNodeLike>(nodes: N[]): N[] {
    this.hoveredId = null;
    if (this.#dragging || this.#liftId === null) return nodes;
    const next = this.#shift(nodes, this.#liftId, this.#lift);
    this.#liftId = null;
    return next;
  }

  /** A node drag started: drop any lift so the drag baseline is the true position,
      and block further lifts until it stops. */
  dragStart<N extends FlowNodeLike>(nodes: N[]): N[] {
    this.#dragging = true;
    this.hoveredId = null;
    if (this.#liftId === null) return nodes;
    const next = this.#shift(nodes, this.#liftId, this.#lift);
    this.#liftId = null;
    return next;
  }

  dragStop(): void {
    this.#dragging = false;
  }
}
