<script lang="ts">
  /* Patch-graph Trigger node — a drum's input. It binds to its drum by identity (the dotted
     reference wire on the canvas); what each hit PLAYS is wired in the Trigger graph. What it
     edits here is the drum's zone→input wiring: the (drumId, slot) MIDI-note / OSC entries in
     the authoritative inputMap, via the shared DrumZonesList (same list + mutation path the
     Trigger-graph source editor uses). No-op-safe while offline (store gates the mutators). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { PatchEditor } from '../patch-inspector';
  import DrumZonesList from './DrumZonesList.svelte';
  import RenameField from './RenameField.svelte';

  let { store, editor, nodeId, title }: {
    store: TriggerLab;
    editor: Extract<PatchEditor, { kind: 'trigger' }>;
    nodeId: string;
    title: string;
  } = $props();

  const drumLabel = $derived(store.drums.find((d) => d.id === editor.drumId)?.label ?? editor.drumId);
</script>

<p class="grouphint">
  Bound to <b>{drumLabel}</b> by identity. What each hit plays is wired in the Trigger graph — here
  you map the drum's zones to MIDI / OSC input.
</p>

<DrumZonesList {store} drumId={editor.drumId} {drumLabel} />

<RenameField {store} {nodeId} fallback={title} />

<style>
  .grouphint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
  .grouphint b {
    color: var(--text);
    font-weight: 600;
  }
</style>
