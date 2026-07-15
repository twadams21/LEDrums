<script lang="ts">
  /* A drum's zone→input wiring (C6) — the (drumId, slot) MIDI-note / OSC entries in the
     authoritative `project.inputMap`, shared by EVERY graph on that drum. Edited via the pure
     setZoneMidiNote / setZoneOscAddress helpers through store.setInputMap.

     Extracted so BOTH the Trigger-graph source editor (TriggerSourceInspector) and the Patch-graph
     Trigger node inspector (PatchTriggerInspector) list the SAME zones off ONE mutation path — the
     patch graph v2 dropped its per-zone nodes, so this is where a drum's zones are wired. The drum
     is fixed by the caller (a patch trigger names its drum by id; a graph trigger resolves it from
     its source / selected pad), so this component assumes a known drum and owns only the list. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Radio from '@lucide/svelte/icons/radio';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import InputActivityBadge from '../../../ui/InputActivityBadge.svelte';
  import Select from '../../../ui/Select.svelte';
  import { formatMidiNote, parseMidiNote } from '../../../midi/midi-note';
  import { SLOT_LABELS } from '@ledrums/core';
  import {
    addDeclaredZone,
    availableSlots,
    moveZoneSlot,
    removeZone as removeZoneFromMap,
    setZoneMidiNote,
    setZoneOscAddress,
    zoneMidiNote,
    zoneOscAddress,
    zoneSlotsForDrum,
  } from '../patch-inspector';

  let { store, drumId, drumLabel }: { store: TriggerLab; drumId: string; drumLabel?: string } = $props();

  // Widened view of the canonical slot labels for label→index lookups (indexOf on the
  // `as const` tuple rejects a plain string).
  const SLOTS: readonly string[] = SLOT_LABELS;
  const project = $derived(store.project);

  // Every zone the drum HAS (declared or bound) — persisted in the input map, so Add persists
  // immediately (a zone needs no MIDI/OSC to exist) and survives a reselect / reload.
  const zoneSlots = $derived(project ? zoneSlotsForDrum(project.inputMap, drumId) : []);

  // Slots with no zone on this drum yet — what a new / renamed zone may take.
  const freeSlots = $derived(project ? availableSlots(project.inputMap, drumId, []) : []);
  const canAdd = $derived(freeSlots.length > 0);

  /** Slot dropdown options for a zone at `slot`: its own label plus every still-free slot,
      in canonical slot order. Value is the slot index (stringified). */
  function slotOptionsFor(slot: number): Array<{ value: string; label: string }> {
    const labels = [SLOT_LABELS[slot]!, ...freeSlots.filter((l) => l !== SLOT_LABELS[slot])];
    return labels
      .map((l) => ({ value: String(SLOTS.indexOf(l)), label: l }))
      .sort((a, b) => Number(a.value) - Number(b.value));
  }

  function addZone(): void {
    if (!project || freeSlots.length === 0) return;
    store.setInputMap(addDeclaredZone(project.inputMap, drumId, SLOTS.indexOf(freeSlots[0]!)));
  }

  function removeZone(slot: number): void {
    if (project) store.setInputMap(removeZoneFromMap(project.inputMap, drumId, slot));
  }

  /** Move a zone (its note + address) from `oldSlot` to the chosen slot (a re-label). */
  function changeSlot(oldSlot: number, v: string): void {
    if (project) store.setInputMap(moveZoneSlot(project.inputMap, drumId, oldSlot, Number(v)));
  }

  function commitZoneNote(slot: number, v: string): void {
    if (!project) return;
    if (v === '') {
      store.setInputMap(setZoneMidiNote(project.inputMap, drumId, slot, null));
      return;
    }
    const parsed = parseMidiNote(v);
    if (parsed !== null) store.setInputMap(setZoneMidiNote(project.inputMap, drumId, slot, parsed));
  }

  function commitZoneOsc(slot: number, v: string): void {
    if (!project) return;
    const trimmed = v.trim();
    store.setInputMap(setZoneOscAddress(project.inputMap, drumId, slot, trimmed ? v : null));
  }

  function zoneLearning(slot: number): boolean {
    const t = store.midiLearnTarget;
    return t?.kind === 'zone' && t.drumId === drumId && t.slot === slot;
  }
</script>

<div class="zones">
  <div class="sectionhead">
    <span class="seclabel">Zones{#if drumLabel}<span class="secdrum"> · {drumLabel}</span>{/if}</span>
    <IconButton icon={Plus} label="Add zone" variant="soft" size={14} disabled={!canAdd} onclick={addZone} />
  </div>

  {#if zoneSlots.length === 0}
    <p class="hint">No zones wired yet — <b>Add</b> one to map a slot to a MIDI note or OSC address.</p>
  {:else}
    <div class="zonelist">
      {#each zoneSlots as slot (slot)}
        {@const note = project ? zoneMidiNote(project.inputMap, drumId, slot) : null}
        {@const addr = project ? zoneOscAddress(project.inputMap, drumId, slot) : null}
        {@const heardNote = store.inputBadge(note !== null ? { kind: 'midi', note } : null)}
        {@const heardOsc = store.inputBadge(addr ? { kind: 'osc', address: addr } : null)}
        {@const armed = zoneLearning(slot)}
        <div class="zone">
          <div class="zhead">
            <Select
              value={String(slot)}
              options={slotOptionsFor(slot)}
              onChange={(v) => changeSlot(slot, v)}
              ariaLabel="Zone slot"
            />
            <IconButton icon={Trash2} label="Remove zone" variant="soft" size={13} onclick={() => removeZone(slot)} />
          </div>
          <Field layout="row" label="Note" hint={note === null ? 'C-1 - G9' : String(note)}>
            <div class="note-row">
              <CommitInput
                value={note === null ? '' : formatMidiNote(note)}
                placeholder="none"
                autofocus={false}
                mono
                allowEmpty
                ariaLabel="Zone MIDI note"
                onCommit={(v) => commitZoneNote(slot, v)}
              />
              <button
                type="button"
                class="learn"
                class:active={armed}
                onclick={(e) => {
                  e.preventDefault();
                  armed ? store.cancelMidiLearn() : store.startMidiLearn({ kind: 'zone', drumId, slot });
                }}
              >
                <Radio size={13} aria-hidden="true" />
                {armed ? 'Listening' : 'Learn'}
              </button>
            </div>
          </Field>
          {#if heardNote}
            <div class="heard"><InputActivityBadge {...heardNote} /></div>
          {/if}
          <Field layout="row" label="OSC" hint="Sensory Percussion / Ableton">
            <CommitInput
              value={addr ?? ''}
              mono
              autofocus={false}
              allowEmpty
              placeholder="/drum/zone"
              ariaLabel="Zone OSC address"
              onCommit={(v) => commitZoneOsc(slot, v)}
            />
          </Field>
          {#if heardOsc}
            <div class="heard"><InputActivityBadge {...heardOsc} /></div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .zones {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .sectionhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 24px;
  }
  .seclabel {
    font-size: var(--text-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .secdrum {
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-muted);
  }
  .zonelist {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .zone {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
  }
  .zhead {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
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
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
  .hint b {
    color: var(--text);
    font-weight: 600;
  }
  /* Last-heard confirmation, tucked just under its field. */
  .heard {
    margin-top: calc(-1 * var(--space-1));
    padding-left: var(--space-1);
    min-width: 0;
  }
</style>
