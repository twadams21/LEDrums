<script lang="ts">
  /* Patch zone node — what fires this zone (MIDI note + OSC address), keyed by (drumId, slot)
     in the authoritative input map. No-op-safe while offline (project null). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import RenameField from './RenameField.svelte';
  import { onNum } from './forms';
  import {
    setZoneMidiNote,
    setZoneOscAddress,
    zoneMidiNote,
    zoneOscAddress,
    type PatchEditor,
  } from '../patch-inspector';

  let { store, editor, nodeId, title }: {
    store: TriggerLab;
    editor: Extract<PatchEditor, { kind: 'zone' }>;
    nodeId: string;
    title: string;
  } = $props();

  const project = $derived(store.project);
  const note = $derived(project ? zoneMidiNote(project.inputMap, editor.drumId, editor.slot) : null);
  const addr = $derived(project ? zoneOscAddress(project.inputMap, editor.drumId, editor.slot) : null);

  function drumName(drumId: string): string {
    return store.drums.find((x) => x.id === drumId)?.label ?? drumId;
  }
  function setZoneNote(drumId: string, slot: number, n: number | null): void {
    if (project) store.setInputMap(setZoneMidiNote(project.inputMap, drumId, slot, n));
  }
  function setZoneOsc(drumId: string, slot: number, address: string | null): void {
    if (project) store.setInputMap(setZoneOscAddress(project.inputMap, drumId, slot, address));
  }
</script>

<p class="grouphint">What fires this zone — <b>{drumName(editor.drumId)}</b> · slot {editor.slot}.</p>
<Field label="MIDI note" hint="0–127">
  <CommitInput
    type="number"
    min={0}
    max={127}
    value={note ?? ''}
    placeholder="none"
    disabled={!project}
    ariaLabel="MIDI note"
    onCommit={(v) =>
      v === '' ? setZoneNote(editor.drumId, editor.slot, null) : onNum(v, (n) => setZoneNote(editor.drumId, editor.slot, n))}
  />
</Field>
<Field label="OSC address" hint="Sensory Percussion / Ableton">
  <CommitInput
    value={addr ?? ''}
    mono
    autofocus={false}
    allowEmpty
    placeholder="/drum/zone"
    disabled={!project}
    ariaLabel="OSC address"
    onCommit={(v) => setZoneOsc(editor.drumId, editor.slot, v.trim() ? v : null)}
  />
</Field>
<RenameField {store} {nodeId} fallback={title} />

<style>
  .grouphint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  .grouphint b {
    color: var(--text);
    font-weight: 600;
  }
</style>
