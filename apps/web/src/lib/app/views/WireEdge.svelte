<script lang="ts">
  /* Custom @xyflow/svelte edge shared by both graphs — a bezier wire whose two ends
     are reconnect anchors, so a wire can be re-pointed to a different node (the
     default edge has no anchors). The reconnect itself is committed by the SvelteFlow
     `onreconnect` handler; this component only draws the path + the drag targets. The
     edge's `class` (e.g. `edge-hot` on hover) is applied by xyflow to the wrapper, so
     the view's CSS still styles the path.

     The anchors render in xyflow's `edge-labels` PORTAL — outside `.svelte-flow__edge`
     — so CSS can't key the grab dots off wire hover. Instead this component owns the
     interaction state and pushes it both ways: hovering the wire's hit-path (or
     selecting the wire) stamps `.show` on the dots, and hovering an anchor stamps
     `wire-grab` back onto the path so the wire confirms which run a grab would
     re-point. Mid-drag the anchor drops its children (dot disappears) and the path
     wears `wire-reconnecting`. All styling lives in GraphCanvas. */
  import { getBezierPath, BaseEdge, EdgeReconnectAnchor, type EdgeProps } from '@xyflow/svelte';

  let {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerStart,
    markerEnd,
    style,
    selected,
  }: EdgeProps = $props();

  const path = $derived(
    getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0],
  );

  let wireHover = $state(false);
  let anchorHover = $state(false);
  let reconnecting = $state(false);
  const showDots = $derived((wireHover || anchorHover || selected) && !reconnecting);

  /* The anchors sit INBOARD along the wire, not on its endpoints: each node handle carries a
     50px hit-target (GraphCanvas `.svelte-flow__handle::after`) in the nodes layer, which
     stacks ABOVE the edge-labels portal — an anchor centred on the endpoint is unreachable
     (every grab starts a new wire from the handle instead). ANCHOR_INSET flow-px along the
     bezier clears that overlay, keeps the handle's generous new-wire target intact, and puts
     the grab dot visibly ON the wire rather than colliding with the node border. */
  const ANCHOR_INSET = 30;
  const ctrl = $derived.by(() => {
    const m = path.match(
      /M\s*([-\d.e]+)[ ,]([-\d.e]+)\s*C\s*([-\d.e]+)[ ,]([-\d.e]+)[ ,]?\s*([-\d.e]+)[ ,]([-\d.e]+)[ ,]?\s*([-\d.e]+)[ ,]([-\d.e]+)/,
    );
    if (!m) return null;
    return [
      Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]),
      Number(m[5]), Number(m[6]), Number(m[7]), Number(m[8]),
    ] as const;
  });
  /** cubic bezier point at t over the parsed control points */
  function bezierAt(t: number): { x: number; y: number } {
    if (!ctrl) return { x: sourceX, y: sourceY };
    const [x0, y0, x1, y1, x2, y2, x3, y3] = ctrl;
    const u = 1 - t;
    return {
      x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    };
  }
  /** walk the curve from an end until ~ANCHOR_INSET of arc length is behind us */
  function insetPoint(from: 'source' | 'target'): { x: number; y: number } {
    let prev = bezierAt(from === 'source' ? 0 : 1);
    let acc = 0;
    for (let i = 1; i <= 20; i++) {
      const t = (i / 20) * 0.45;
      const p = bezierAt(from === 'source' ? t : 1 - t);
      acc += Math.hypot(p.x - prev.x, p.y - prev.y);
      if (acc >= ANCHOR_INSET) return p;
      prev = p;
    }
    return prev; // short wire: cap at 45% in from this end
  }
  const sourceAnchor = $derived(insetPoint('source'));
  const targetAnchor = $derived(insetPoint('target'));
</script>

<!-- interactionWidth widens the invisible hit-path so thin wires select reliably; the
     stroke paint that makes it hit-testable at all is applied in GraphCanvas's CSS.
     The hover handlers land on that hit-path (BaseEdge spreads rest onto it). -->
<BaseEdge
  {id}
  {path}
  {markerStart}
  {markerEnd}
  {style}
  interactionWidth={24}
  class={[anchorHover && 'wire-grab', reconnecting && 'wire-reconnecting']}
  onpointerenter={() => (wireHover = true)}
  onpointerleave={() => (wireHover = false)}
/>
<!-- The two ends are reconnect anchors (re-point a wire to another node). Each carries a
     grab dot — hidden at rest, revealed while the wire is hovered/selected — and hides
     itself mid-drag (the anchor renders children only while `!reconnecting`). The source
     end draws hollow, the target end filled, so direction reads from the pair. -->
<EdgeReconnectAnchor
  type="source"
  position={sourceAnchor}
  bind:reconnecting
  onpointerenter={() => (anchorHover = true)}
  onpointerleave={() => (anchorHover = false)}
>
  <span class={['reconnect-dot', showDots && 'show']} aria-hidden="true"></span>
</EdgeReconnectAnchor>
<EdgeReconnectAnchor
  type="target"
  position={targetAnchor}
  bind:reconnecting
  onpointerenter={() => (anchorHover = true)}
  onpointerleave={() => (anchorHover = false)}
>
  <span class={['reconnect-dot', showDots && 'show']} aria-hidden="true"></span>
</EdgeReconnectAnchor>
