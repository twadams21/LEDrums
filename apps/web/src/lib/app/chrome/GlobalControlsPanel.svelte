<script lang="ts">
  /* Global control bindings — the app-general MIDI/OSC actions (Settings).

     These live here, beside the MIDI channel filter, because they are app-general input
     ROUTING: "next song" belongs to no song and no section, so putting it on one would be
     a lie about its scope.

     The section is a LIST driven by `GLOBAL_CONTROL_CATALOG`, not a hand-written block per
     action — a new control appears here the moment core gains its catalogue entry, with no
     edit to this file.

     Two independent Learn arms per row (MIDI note, OSC address): arming one must not disarm
     the other, so they read from two separate store targets. The OSC one is the app's first
     — see `osc-learn.svelte.ts`. */
  import { GLOBAL_CONTROL_CATALOG, RESERVED_SECTION_RECALL_CC, type GlobalControlAction } from '@ledrums/core';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import Field from '../../ui/Field.svelte';
  import InputActivityBadge from '../../ui/InputActivityBadge.svelte';
  import LearnButton from '../../ui/LearnButton.svelte';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { formatMidiNote, parseMidiNote } from '../../midi/midi-note';
  import { globalControlZoneWarning } from '../global-control-labels';

  let { store }: { store: TriggerLab } = $props();

  const locked = $derived(!store.canEdit || !store.project);

  /** Commit a MIDI note field: an emptied field CLEARS the binding, an unparseable one is
      ignored (CommitInput has already reverted the draft). */
  function commitNote(action: GlobalControlAction, raw: string): void {
    const text = raw.trim();
    if (!text) {
      store.setGlobalControlBinding(action, { midiNote: undefined });
      return;
    }
    const parsed = parseMidiNote(text);
    if (parsed !== null) store.setGlobalControlBinding(action, { midiNote: parsed });
  }

  /** Commit an OSC address; an emptied field clears the binding (core trims + drops it). */
  function commitOsc(action: GlobalControlAction, raw: string): void {
    store.setGlobalControlBinding(action, { oscAddress: raw.trim() || undefined });
  }

  /** Commit a CC number (continuous controls only). Controller 0 is reserved for global
      section recall, so it is refused rather than silently stealing that convention. */
  function commitCc(action: GlobalControlAction, raw: string): void {
    const text = raw.trim();
    if (!text) {
      store.setGlobalControlBinding(action, { midiCc: undefined });
      return;
    }
    const n = Number(text);
    if (!Number.isInteger(n) || n <= RESERVED_SECTION_RECALL_CC || n > 127) return;
    store.setGlobalControlBinding(action, { midiCc: n });
  }

  function toggleCcLearn(action: GlobalControlAction, armed: boolean): void {
    if (armed) store.cancelMidiLearn();
    else store.startMidiLearn({ kind: 'global-control-cc', action });
  }

  function toggleMidiLearn(action: GlobalControlAction, armed: boolean): void {
    if (armed) store.cancelMidiLearn();
    else store.startMidiLearn({ kind: 'global-control', action });
  }

  function toggleOscLearn(action: GlobalControlAction, armed: boolean): void {
    if (armed) store.cancelOscLearn();
    else store.startOscLearn({ kind: 'global-control', action });
  }
</script>

<section class="gc" aria-label="Global controls" data-shot="global-controls">
  <span class="glabel">Global controls<em class="ghint">app-general MIDI / OSC</em></span>

  <ul class="rows">
    {#each GLOBAL_CONTROL_CATALOG as def (def.id)}
      {@const binding = store.globalControls[def.id]}
      {@const midiArmed = store.midiLearnTarget?.kind === 'global-control' && store.midiLearnTarget.action === def.id}
      {@const oscArmed = store.oscLearnTarget?.kind === 'global-control' && store.oscLearnTarget.action === def.id}
      {@const noteHeard = binding?.midiNote === undefined ? null : store.inputBadge({ kind: 'midi', note: binding.midiNote })}
      {@const oscHeard = binding?.oscAddress ? store.inputBadge({ kind: 'osc', address: binding.oscAddress }) : null}
      {@const warning = store.project ? globalControlZoneWarning(store.project.inputMap, binding, store.drums) : null}

      <li class="row" class:bound={!!binding}>
        <div class="rhead">
          <span class="rname">{def.label}</span>
          <span class="rhint">{def.hint}</span>
        </div>

        {#if def.fields.includes('note')}
          <Field layout="row" label="MIDI note">
            <div class="learn-row">
              <CommitInput
                value={binding?.midiNote === undefined ? '' : formatMidiNote(binding.midiNote)}
                placeholder="unbound"
                autofocus={false}
                allowEmpty
                mono
                disabled={locked}
                ariaLabel="{def.label} MIDI note"
                onCommit={(v) => commitNote(def.id, v)}
              />
              <LearnButton
                armed={midiArmed}
                disabled={locked}
                ariaLabel="Learn {def.label} MIDI note"
                onclick={() => toggleMidiLearn(def.id, midiArmed)}
              />
            </div>
          </Field>
          {#if noteHeard}
            <div class="heard"><InputActivityBadge {...noteHeard} /></div>
          {/if}
        {/if}

        {#if def.fields.includes('cc')}
          {@const ccArmed = store.midiLearnTarget?.kind === 'global-control-cc' && store.midiLearnTarget.action === def.id}
          <Field layout="row" label="MIDI CC" hint="1-127 · CC 0 reserved for section recall">
            <div class="learn-row">
              <CommitInput
                type="number"
                min={RESERVED_SECTION_RECALL_CC + 1}
                max={127}
                value={binding?.midiCc ?? ''}
                placeholder="unbound"
                autofocus={false}
                disabled={locked}
                ariaLabel="{def.label} MIDI CC"
                onCommit={(v) => commitCc(def.id, v)}
              />
              <LearnButton
                armed={ccArmed}
                disabled={locked}
                ariaLabel="Learn {def.label} MIDI CC"
                onclick={() => toggleCcLearn(def.id, ccArmed)}
              />
            </div>
          </Field>
        {/if}

        <Field layout="row" label="OSC address">
          <div class="learn-row">
            <CommitInput
              value={binding?.oscAddress ?? ''}
              placeholder="unbound"
              autofocus={false}
              allowEmpty
              mono
              disabled={locked}
              ariaLabel="{def.label} OSC address"
              onCommit={(v) => commitOsc(def.id, v)}
            />
            <LearnButton
              armed={oscArmed}
              disabled={locked}
              ariaLabel="Learn {def.label} OSC address"
              onclick={() => toggleOscLearn(def.id, oscArmed)}
            />
          </div>
        </Field>
        {#if oscHeard}
          <div class="heard"><InputActivityBadge {...oscHeard} /></div>
        {/if}

        {#if warning}
          <p class="warn"><TriangleAlert size={12} aria-hidden="true" />{warning}</p>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .gc {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    /* Two short labels ("MIDI note" / "OSC address") — a tighter column than the
       inspector default keeps the inputs wide enough to read a real address. */
    --field-label-col: 5.25rem;
  }
  .glabel {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .ghint {
    font-style: normal;
    color: var(--text-faint);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    transition-property: border-color;
    transition-duration: var(--dur-150);
  }
  /* A bound control reads as configured at a glance, without shouting. */
  .row.bound {
    border-color: var(--border);
  }
  .rhead {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .rname {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .rhint {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-wrap: pretty;
  }
  .learn-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
    width: 100%;
    min-width: 0;
  }
  /* Last-heard confirmation, tucked under its field and aligned to the control column. */
  .heard {
    margin-top: calc(-1 * var(--space-1));
    padding-left: calc(var(--field-label-col) + var(--space-2));
    min-width: 0;
  }
  /* This binding silences a mapped drum zone — say so, or the dead pad is a mystery. */
  .warn {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text);
    text-wrap: pretty;
  }
  .warn :global(svg) {
    flex: none;
    color: var(--warn);
  }
</style>
