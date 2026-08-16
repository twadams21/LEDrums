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
  import { getBezierPath, BaseEdge, EdgeReconnectAnchor, Position, type EdgeProps } from '@xyflow/svelte';

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

  /* xyflow reports edge endpoints at the handle's OUTER edge along its Position axis (so
     wires don't overdraw the handle disc). The anchors must sit concentric on the HANDLE —
     shift half a handle (10px handles) back toward the node along that axis. */
  const HANDLE_R = 5;
  function onHandleCentre(pos: Position, x: number, y: number): { x: number; y: number } {
    if (pos === Position.Left) return { x: x + HANDLE_R, y };
    if (pos === Position.Right) return { x: x - HANDLE_R, y };
    if (pos === Position.Top) return { x, y: y + HANDLE_R };
    return { x, y: y - HANDLE_R }; // Bottom
  }
  const sourceAnchor = $derived(onHandleCentre(sourcePosition, sourceX, sourceY));
  const targetAnchor = $derived(onHandleCentre(targetPosition, targetX, targetY));
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
  <EdgeReconnectAnchor type="source" position={sourceAnchor} bind:reconnecting>
    <span class="reconnect-dot" style:--dot={dotColor} aria-hidden="true"></span>
  </EdgeReconnectAnchor>
  <EdgeReconnectAnchor type="target" position={targetAnchor} bind:reconnecting>
    <span class="reconnect-dot" style:--dot={dotColor} aria-hidden="true"></span>
  </EdgeReconnectAnchor>
{/if}
