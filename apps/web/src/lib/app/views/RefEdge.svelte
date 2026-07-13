<script lang="ts">
  /* Custom @xyflow/svelte edge for the greyed, dotted, NON-interactive Trigger → Drum
     reference wire (binding by identity; carries no routing). No reconnect anchors, no hit
     path — it is decoration only. The dotted grey stroke is painted by GraphCanvas CSS via
     the `.svelte-flow__edge.edge-ref` class the view stamps on it. */
  import { getBezierPath, BaseEdge, type EdgeProps } from '@xyflow/svelte';

  let { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps = $props();

  const path = $derived(
    getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0],
  );
</script>

<BaseEdge {id} {path} interactionWidth={0} />
