<script lang="ts">
  /* Custom @xyflow/svelte edge shared by both graphs — a bezier wire whose two ends
     are reconnect anchors, so a wire can be re-pointed to a different node (the
     default edge has no anchors). The reconnect itself is committed by the SvelteFlow
     `onreconnect` handler; this component only draws the path + the drag targets. The
     edge's `class` (e.g. `edge-hot` on hover) is applied by xyflow to the wrapper, so
     the view's CSS still styles the path. */
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
  }: EdgeProps = $props();

  const path = $derived(
    getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0],
  );
</script>

<!-- interactionWidth widens the invisible hit-path so thin wires select reliably; the
     stroke paint that makes it hit-testable at all is applied in GraphCanvas's CSS. -->
<BaseEdge {id} {path} {markerStart} {markerEnd} {style} interactionWidth={24} />
<!-- The two ends are reconnect anchors (re-point a wire to another node). Each carries a small
     grab dot — hidden at rest, revealed when the wire is hovered/selected (GraphCanvas CSS) — so
     it reads as a draggable endpoint, and it hides itself mid-drag (anchor renders children only
     while `!reconnecting`). -->
<EdgeReconnectAnchor type="source" position={{ x: sourceX, y: sourceY }}>
  <span class="reconnect-dot" aria-hidden="true"></span>
</EdgeReconnectAnchor>
<EdgeReconnectAnchor type="target" position={{ x: targetX, y: targetY }}>
  <span class="reconnect-dot" aria-hidden="true"></span>
</EdgeReconnectAnchor>
