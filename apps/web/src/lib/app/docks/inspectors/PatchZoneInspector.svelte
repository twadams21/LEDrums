<script lang="ts">
  /* Patch zone node — what fires this zone (MIDI note + OSC address), keyed by (drumId, slot)
     in the authoritative input map. No-op-safe while offline (project null). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import InputActivityBadge from '../../../ui/InputActivityBadge.svelte';
  import RenameField from './RenameField.svelte';
  import { graphsLinkedToZone } from '../../trigger-source-label';
  import { formatMidiNote, parseMidiNote } from '../../../midi/midi-note';
  import Radio from '@lucide/svelte/icons/radio';
  import Link2 from '@lucide/svelte/icons/link-2';
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
  // Last-heard confirmation per field: the bound note, and the bound OSC address.
  const heardNote = $derived(store.inputBadge(note !== null ? { kind: 'midi', note } : null));
  const heardOsc = $derived(store.inputBadge(addr ? { kind: 'osc', address: addr } : null));
  const learning = $derived(
    store.midiLearnTarget?.kind === 'zone' &&
      store.midiLearnTarget.drumId === editor.drumId &&
      store.midiLearnTarget.slot === editor.slot,
  );
  // Reverse cross-reference: authored graphs whose trigger source is this zone's note/address
  // ALSO fire when this zone triggers (both-fire, by design). Names them so it's visible here.
  const alsoFires = $derived(
    graphsLinkedToZone(store.graphs, note, addr).map((key) => store.graphLabel(key)),
  );

  function drumName(drumId: string): string {
    return store.drums.find((x) => x.id === drumId)?.label ?? drumId;
  }
  function setZoneNote(drumId: string, slot: number, n: number | null): void {
    if (project) store.setInputMap(setZoneMidiNote(project.inputMap, drumId, slot, n));
  }
  function commitZoneNote(v: string): void {
    if (v === '') {
      setZoneNote(editor.drumId, editor.slot, null);
      return;
    }
    const parsed = parseMidiNote(v);
    if (parsed !== null) setZoneNote(editor.drumId, editor.slot, parsed);
  }
  function setZoneOsc(drumId: string, slot: number, address: string | null): void {
    if (project) store.setInputMap(setZoneOscAddress(project.inputMap, drumId, slot, address));
  }
</script>

<p class="grouphint">What fires this zone — <b>{drumName(editor.drumId)}</b> · slot {editor.slot}.</p>
<Field layout="row" label="MIDI note" hint={note === null ? 'C-1 - G9' : String(note)}>
  <div class="note-row">
    <CommitInput
      value={note === null ? '' : formatMidiNote(note)}
      placeholder="none"
      disabled={!project}
      autofocus={false}
      mono
      allowEmpty
      ariaLabel="MIDI note"
      onCommit={commitZoneNote}
    />
    <button
      type="button"
      class="learn"
      class:active={learning}
      disabled={!project}
      onclick={(e) => {
        e.preventDefault();
        learning ? store.cancelMidiLearn() : store.startMidiLearn({ kind: 'zone', drumId: editor.drumId, slot: editor.slot });
      }}
    >
      <Radio size={13} aria-hidden="true" />
      {learning ? 'Listening' : 'Learn'}
    </button>
  </div>
</Field>
{#if heardNote}
  <div class="heard"><InputActivityBadge {...heardNote} /></div>
{/if}
<Field layout="row" label="OSC address" hint="Sensory Percussion / Ableton">
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
{#if heardOsc}
  <div class="heard"><InputActivityBadge {...heardOsc} /></div>
{/if}
{#if alsoFires.length > 0}
  <p class="linkhint">
    <Link2 size={12} aria-hidden="true" />
    <span>also fires: <b>{alsoFires.join(', ')}</b></span>
  </p>
{/if}
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
  /* reverse drum-link cross-reference — accent glyph + the graphs this zone also fires */
  .linkhint {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  .linkhint :global(svg) {
    color: var(--accent);
    flex: none;
  }
  .linkhint b {
    color: var(--text);
    font-weight: 600;
  }
  .note-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
  }
  .learn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 29px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 600;
    white-space: nowrap;
  }
  .learn:hover:not(:disabled),
  .learn.active {
    border-color: var(--accent);
    color: var(--ink);
  }
  .learn:disabled {
    opacity: 0.45;
  }
  /* Last-heard confirmation, tucked just under its field. */
  .heard {
    margin-top: calc(-1 * var(--space-1));
    padding-left: var(--space-1);
    min-width: 0;
  }
</style>
