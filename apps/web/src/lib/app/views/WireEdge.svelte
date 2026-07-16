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
  position={{ x: sourceX, y: sourceY }}
  bind:reconnecting
  onpointerenter={() => (anchorHover = true)}
  onpointerleave={() => (anchorHover = false)}
>
  <span class={['reconnect-dot', showDots && 'show']} aria-hidden="true"></span>
</EdgeReconnectAnchor>
<EdgeReconnectAnchor
  type="target"
  position={{ x: targetX, y: targetY }}
  bind:reconnecting
  onpointerenter={() => (anchorHover = true)}
  onpointerleave={() => (anchorHover = false)}
>
  <span class={['reconnect-dot', showDots && 'show']} aria-hidden="true"></span>
</EdgeReconnectAnchor>
