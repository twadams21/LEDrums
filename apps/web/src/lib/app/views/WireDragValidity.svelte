<script lang="ts" module>
  /** The origin handle of an in-progress wire, as the drop validator needs it. */
  export type WireDragFrom = { nodeId: string; type: 'source' | 'target'; handleId: string | null };
</script>

<script lang="ts">
  /* Drives the in-drag "invalid target" styling (R03 / doc 1.1). While a wire is being dragged,
     it watches the node under the pointer and asks the owning view whether dropping there would
     be refused — reporting that verdict up so the canvas can render the wire red / dotted / dull
     the moment the pointer crosses an invalid target, BEFORE release. No wire silently vanishes.

     Must be a CHILD of <SvelteFlow> (useConnection reads flow context) — same bridge pattern as
     GraphFitView / FlowHandle. xyflow only reports `toNode` / `isValid` when the pointer is inside
     a handle's connection radius, not over a node BODY where the locked drop-anywhere contract
     still wires to the node's input. So we hit-test the node under the pointer ourselves
     (`nodeIdAtEvent`); when the pointer IS over a precise handle its id is passed through so the
     view can honour port-specific validity (mod / param / flow). */
  import { untrack } from 'svelte';
  import { useConnection } from '@xyflow/svelte';
  import { nodeIdAtEvent } from './flow-dom';

  let {
    validate,
    onChange,
  }: {
    /** True when dropping the in-progress wire on `toNodeId` (optionally the precise `toHandleId`
        under the pointer) would be ACCEPTED; false when it would be refused. */
    validate: (from: WireDragFrom, toNodeId: string, toHandleId: string | null) => boolean;
    /** Report the current invalid-target state (true = pointer over an invalid target). */
    onChange: (invalid: boolean) => void;
  } = $props();

  const conn = useConnection();
  // Gate the effect on the boolean alone: `conn.current` changes on every pointer tick during a
  // drag, so depending on it directly would re-attach the listener constantly. This flips only at
  // drag start / stop.
  const active = $derived(conn.current.inProgress);

  let invalid = false;
  function set(next: boolean): void {
    if (next === invalid) return;
    invalid = next;
    onChange(next);
  }

  $effect(() => {
    if (!active) {
      set(false);
      return;
    }
    const c = untrack(() => conn.current);
    if (!c.inProgress) return;
    const from: WireDragFrom = {
      nodeId: c.fromHandle.nodeId,
      type: c.fromHandle.type,
      handleId: c.fromHandle.id ?? null,
    };
    const onMove = (event: PointerEvent): void => {
      const live = conn.current;
      if (!live.inProgress) {
        set(false);
        return;
      }
      const toNodeId = nodeIdAtEvent(event);
      // Empty canvas or the origin node itself is not an invalid TARGET — releasing there simply
      // cancels the drag (drop-anywhere ignores a self-drop), so keep the wire neutral.
      if (!toNodeId || toNodeId === from.nodeId) {
        set(false);
        return;
      }
      set(!validate(from, toNodeId, live.toHandle?.id ?? null));
    };
    window.addEventListener('pointermove', onMove, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      set(false);
    };
  });
</script>
