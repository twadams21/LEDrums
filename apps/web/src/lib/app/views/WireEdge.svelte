<script lang="ts">
  /* Custom @xyflow/svelte edge shared by both graphs — a bezier wire whose two ends
     are reconnect anchors, so a wire can be re-pointed to a different node (the
     default edge has no anchors). The reconnect itself is committed by the SvelteFlow
     `onreconnect` handler; a grab released over NOTHING removes the wire via the
     view's `onReconnectAbandon` (GraphCanvas `onreconnectend`).

     The anchors render ONLY while the wire is selected, positioned concentric OVER
     the node handles at the wire's endpoints. At rest a handle's 50px new-wire target
     owns the pointer (the edge-labels portal normally stacks below the nodes layer);
     GraphCanvas raises the portal above the nodes, which is safe precisely because
     unselected wires render no anchors at all. Each anchor carries a solid grab dot
     in the wire's own colour (mod pink / modulation blue / accent); mid-drag the
     anchor drops its children and the path wears `wire-reconnecting` (hidden — the
     accent connection line IS the wire while dragging). Styling lives in GraphCanvas. */
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
    data,
  }: EdgeProps = $props();

  const path = $derived(
    getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0],
  );

  let reconnecting = $state(false);
  /* The grab dot wears the wire's own colour: modifier-chain pink, modulation blue,
     accent for signal-flow wires (whose selected stroke is accent). */
  const dotColor = $derived(
    data?.mod ? 'var(--role-mod)' : data?.modulation ? 'var(--role-modulation)' : 'var(--accent)',
  );
</script>

<!-- interactionWidth widens the invisible hit-path so thin wires select reliably; the
     stroke paint that makes it hit-testable at all is applied in GraphCanvas's CSS. -->
<BaseEdge
  {id}
  {path}
  {markerStart}
  {markerEnd}
  {style}
  interactionWidth={24}
  class={[reconnecting && 'wire-reconnecting']}
/>
{#if selected}
  <EdgeReconnectAnchor type="source" position={{ x: sourceX, y: sourceY }} bind:reconnecting>
    <span class="reconnect-dot" style:--dot={dotColor} aria-hidden="true"></span>
  </EdgeReconnectAnchor>
  <EdgeReconnectAnchor type="target" position={{ x: targetX, y: targetY }} bind:reconnecting>
    <span class="reconnect-dot" style:--dot={dotColor} aria-hidden="true"></span>
  </EdgeReconnectAnchor>
{/if}
