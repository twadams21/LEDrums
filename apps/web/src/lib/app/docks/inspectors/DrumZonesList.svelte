<script lang="ts">
  /* A drum's zones (C6, reworked 2026-08-14) — the (drumId, slot) MIDI-note / OSC entries in
     the authoritative `project.inputMap`, shared by EVERY graph on that drum. Edited via the
     pure setZoneMidiNote / setZoneOscAddress / setZoneLabel helpers through store.setInputMap.

     What a zone IS, per Trent: a MIDI note (or OSC address) on a drum, with a NAME. So the
     Sensory-Percussion slot dropdown is gone — the name is free text, and a drum may have as
     many zones as it likes. The numeric SLOT survives as hidden identity: the engine keys pads
     `padKey(drumId, String(slot))` and section bindings reference `(drumId, slot)`, so a
     rename must never move a zone's slot or every graph bound to it would miss.

     Extracted so BOTH the Trigger-graph source editor (TriggerSourceInspector) and the
     Settings zones pane list the SAME zones off ONE mutation path. The drum is fixed by the
     caller, so this component assumes a known drum and owns only the list. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Radio from '@lucide/svelte/icons/radio';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import InputActivityBadge from '../../../ui/InputActivityBadge.svelte';
  import { formatMidiNote, parseMidiNote } from '../../../midi/midi-note';
  import {
    addDeclaredZone,
    nextZoneSlot,
    removeZone as removeZoneFromMap,
    setZoneLabel,
    setZoneMidiNote,
    setZoneOscAddress,
    zoneLabel,
    zoneMidiNote,
    zoneOscAddress,
    zoneSlotsForDrum,
  } from '../patch-inspector';

  let { store, drumId, drumLabel }: { store: TriggerLab; drumId: string; drumLabel?: string } = $props();

  const project = $derived(store.project);

  // Every zone the drum HAS (declared or bound) — persisted in the input map, so Add persists
  // immediately (a zone needs no MIDI/OSC to exist) and survives a reselect / reload.
  const zoneSlots = $derived(project ? zoneSlotsForDrum(project.inputMap, drumId) : []);

  /* Collapsed zones show their whole binding on one line, so a drum with a dozen zones stays
     scannable. A zone opens on click; a freshly added one opens itself, because the next
     thing you want is to name it. */
  let open = $state<Set<number>>(new Set());
  const isOpen = (slot: number): boolean => open.has(slot);
  function toggle(slot: number): void {
    const next = new Set(open);
    if (!next.delete(slot)) next.add(slot);
    open = next;
  }

  function addZone(): void {
    if (!project) return;
    const slot = nextZoneSlot(project.inputMap, drumId);
    store.setInputMap(addDeclaredZone(project.inputMap, drumId, slot));
    open = new Set([...open, slot]);
  }

  function removeZone(slot: number): void {
    if (project) store.setInputMap(removeZoneFromMap(project.inputMap, drumId, slot));
  }

  function commitName(slot: number, v: string): void {
    if (project) store.setInputMap(setZoneLabel(project.inputMap, drumId, slot, v));
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

  function zoneOscLearning(slot: number): boolean {
    const t = store.oscLearnTarget;
    return t?.kind === 'zone' && t.drumId === drumId && t.slot === slot;
  }

  /** The one-line summary a collapsed zone shows: what fires it, or that nothing does. */
  function summary(slot: number): string {
    if (!project) return '';
    const note = zoneMidiNote(project.inputMap, drumId, slot);
    const addr = zoneOscAddress(project.inputMap, drumId, slot);
    const parts = [note === null ? null : formatMidiNote(note), addr].filter(Boolean);
    return parts.length ? parts.join('  ·  ') : 'unbound';
  }
</script>

<div class="zones">
  <div class="sectionhead">
    <span class="seclabel">Zones{#if drumLabel}<span class="secdrum"> · {drumLabel}</span>{/if}</span>
    <span class="seccount">{zoneSlots.length}</span>
    <IconButton icon={Plus} label="Add zone" variant="soft" size={14} onclick={addZone} />
  </div>

  {#if zoneSlots.length === 0}
    <p class="hint empty">No zones yet — <b>Add</b> one, name it, and give it a MIDI note or OSC address.</p>
  {:else}
    <div class="zonelist">
      {#each zoneSlots as slot (slot)}
        {@const note = project ? zoneMidiNote(project.inputMap, drumId, slot) : null}
        {@const addr = project ? zoneOscAddress(project.inputMap, drumId, slot) : null}
        {@const name = project ? zoneLabel(project.inputMap, drumId, slot) : ''}
        {@const heardNote = store.inputBadge(note !== null ? { kind: 'midi', note } : null)}
        {@const heardOsc = store.inputBadge(addr ? { kind: 'osc', address: addr } : null)}
        {@const armed = zoneLearning(slot)}
        {@const oscArmed = zoneOscLearning(slot)}
        <div class="zone" class:bound={note !== null || !!addr} class:open={isOpen(slot)}>
          <div class="zhead">
            <button type="button" class="ztoggle" aria-expanded={isOpen(slot)} onclick={() => toggle(slot)}>
              <ChevronRight class="zchev" size={13} aria-hidden="true" />
              <span class="zname">{name}</span>
              <span class="zsummary">{summary(slot)}</span>
            </button>
            <IconButton icon={Trash2} label="Remove zone" variant="soft" size={13} onclick={() => removeZone(slot)} />
          </div>

          {#if isOpen(slot)}
            <div class="zbody">
              <Field label="Name">
                <CommitInput
                  value={name}
                  autofocus={false}
                  allowEmpty
                  placeholder="zone name"
                  ariaLabel="Zone name"
                  onCommit={(v) => commitName(slot, v)}
                />
              </Field>
              <Field label="MIDI note" info={note === null ? 'C-1 to G9 — or Learn the next note played' : `note number ${note}`}>
                <div class="learn-row">
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
                    aria-label={armed ? 'Cancel MIDI learn' : 'Learn zone MIDI note'}
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
              <Field label="OSC address">
                <div class="learn-row">
                  <CommitInput
                    value={addr ?? ''}
                    mono
                    autofocus={false}
                    allowEmpty
                    placeholder="/drum/zone"
                    ariaLabel="Zone OSC address"
                    onCommit={(v) => commitZoneOsc(slot, v)}
                  />
                  <button
                    type="button"
                    class="learn"
                    class:active={oscArmed}
                    aria-label={oscArmed ? 'Cancel OSC learn' : 'Learn zone OSC address'}
                    onclick={(e) => {
                      e.preventDefault();
                      oscArmed ? store.cancelOscLearn() : store.startOscLearn({ kind: 'zone', drumId, slot });
                    }}
                  >
                    <Radio size={13} aria-hidden="true" />
                    {oscArmed ? 'Listening' : 'Learn'}
                  </button>
                </div>
              </Field>
              {#if heardOsc}
                <div class="heard"><InputActivityBadge {...heardOsc} /></div>
              {/if}
            </div>
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
  .seccount {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .zonelist {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  /* One zone = one collapsible card. Colour identity rides a 2px left bar in the zone role
     hue, and only once the zone is bound — an unbound zone stays quiet, so the eye finds the
     live ones. */
  .zone {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    transition-property: border-color;
    transition-duration: var(--dur-120);
  }
  .zone.bound {
    border-color: color-mix(in oklch, var(--role-mod) 22%, var(--border-faint));
  }
  .zone.bound::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: color-mix(in oklch, var(--role-mod) 70%, transparent);
  }
  .zhead {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-1);
    align-items: center;
    padding: 2px var(--space-1) 2px 0;
  }
  .ztoggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-1);
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .ztoggle:hover {
    background: color-mix(in oklch, var(--ink) 5%, transparent);
  }
  .ztoggle :global(.zchev) {
    flex: none;
    color: var(--text-faint);
    transition-property: transform;
    transition-duration: var(--dur-120);
  }
  .zone.open .ztoggle :global(.zchev) {
    transform: rotate(90deg);
  }
  .zname {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The whole binding on one line while collapsed — the answer to "what fires this?" */
  .zsummary {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .zbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2) var(--space-2);
  }
  .learn-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
    width: 100%;
    min-width: 0;
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
  .hint.empty {
    padding: var(--space-2) var(--space-3);
    border: 1px dashed var(--border);
    border-radius: var(--radius-2);
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
