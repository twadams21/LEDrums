<script lang="ts">
  /* The per-param "put this on the node face" affordance (S5) — one small insertion point in
     each effect/modifier inspector param row.

     It is deliberately NOT a second list: pressing it runs the SAME `addModInput` /
     `removeModInput` mutation the Parameters section below runs, on the same `node.modInputs`.
     "On the face" and "exposed for modulation" are one state with one gesture.

     Un-exposing preserves the existing guard exactly: a param with live modulation wires
     confirms before its wires are deleted (the Parameters section's `confirming` behaviour,
     reused here through the shared ConfirmDialog rather than re-implemented). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import IconButton from '../../../ui/IconButton.svelte';
  import ConfirmDialog from '../../../ui/ConfirmDialog.svelte';
  import PanelTop from '@lucide/svelte/icons/panel-top';

  let {
    store,
    node,
    param,
    label,
  }: { store: TriggerLab; node: GraphNode; param: string; label: string } = $props();

  const onFace = $derived(store.isParamOnFace(node, param));
  const wires = $derived(store.mappingsFor(node, param).length);

  let confirming = $state(false);

  function toggle(): void {
    if (!onFace) {
      store.addFaceParam(node, param);
      return;
    }
    // Removing the row also deletes its modulation wires — confirm first, exactly as the
    // Parameters section does.
    if (wires > 0) confirming = true;
    else store.removeFaceParam(node, param);
  }
</script>

<!-- solid-on / soft-off is the house pattern for a per-param toggle (the envelope button in
     ModifierNodeInspector) — and `soft` keeps the OFF state discoverable, which a ghost button
     in a column of sliders is not. -->
<IconButton
  icon={PanelTop}
  label={onFace ? `Remove ${label} from the node face` : `Show ${label} on the node face`}
  variant={onFace ? 'solid' : 'soft'}
  size={12}
  onclick={toggle}
/>

<ConfirmDialog
  bind:open={confirming}
  title="Remove from the node face?"
  message={`${label} has ${wires} modulation ${wires === 1 ? 'wire' : 'wires'}. Removing its row deletes ${wires === 1 ? 'it' : 'them'}.`}
  confirmLabel="Remove"
  danger
  onConfirm={() => store.removeFaceParam(node, param)}
/>
