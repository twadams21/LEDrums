<script lang="ts">
  /* Sequence-node editor — the step blurb plus the node's own RESET binding (issue #159): the
     input that snaps THIS sequence back to its first step, independent of what fires its graph.
     Mirrors the trigger node's source editor (Drum zone / MIDI note + Learn / OSC address), with
     a `None` state because a reset binding is optional. Contained in the node on purpose: no
     cross-graph target exists, so copied songs/sections can never reset the original. The shared
     node header (kind selector + remove) lives in the parent Inspector. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, TriggerSource } from '../../../trigger-lab/sim';
  import { describeTriggerSource } from '../../trigger-source-label';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { SOURCE_OPTS } from '../../views/node-options';
  import { zoneOptions } from '../patch-inspector';
  import LearnButton from '../../../ui/LearnButton.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import InputActivityBadge from '../../../ui/InputActivityBadge.svelte';
  import ReadRow from './ReadRow.svelte';
  import { formatMidiNote, parseMidiNote } from '../../../midi/midi-note';
  import { bindingFromSource } from '../../../trigger-lab/input-activity';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const RESET_OPTS = [{ value: 'none', label: 'None' }, ...SOURCE_OPTS];

  const src = $derived(node.resetSource);
  const kindNow = $derived(src?.kind ?? 'none');
  // Last-heard confirmation for the active MIDI-note / OSC field (null for none/drum).
  const heard = $derived(store.inputBadge(bindingFromSource(src)));
  const learning = $derived(
    store.midiLearnTarget?.kind === 'sequence-reset' && store.midiLearnTarget.nodeId === node.id,
  );

  /* The kit's drums and each drum's zones as declared in Settings › Drum trigger zones — the same
     lists the Trigger node offers. These used to come from the build-time demo pads, so a drum
     offered only the zones the demo kit had, different per drum, never the user's own. */
  const drums = $derived(store.project?.kit.drums ?? store.drums);
  const DRUM_OPTS = $derived(drums.map((d) => ({ value: d.id, label: d.label || d.id })));
  const zoneOptsFor = (drumId: string) => zoneOptions(store.project?.inputMap, drumId);

  /** Switch drum, keeping the zone when the new drum has it, else its first zone. */
  function selectDrum(drumId: string, current: string): void {
    const options = zoneOptsFor(drumId);
    const zone = options.find((option) => option.value === current)?.value ?? options[0]?.value ?? '';
    store.setSequenceResetSource(node, { kind: 'drum', drumId, zone });
  }

  /** Switch the reset binding to a new kind, carrying compatible fields and filling the same
      least-surprising defaults as the trigger source editor. `none` clears the binding. */
  function setResetKind(cur: TriggerSource | undefined, kind: string): void {
    if (kind === 'none') {
      store.setSequenceResetSource(node, null);
      if (learning) store.cancelMidiLearn();
      return;
    }
    let next: TriggerSource;
    if (kind === 'drum') {
      const drumId = drums[0]?.id ?? '';
      next = cur?.kind === 'drum' ? cur : { kind: 'drum', drumId, zone: zoneOptsFor(drumId)[0]?.value ?? '' };
    }
    // Start on a note nothing else uses: a zone's note would be refused and leave the reset off.
    else if (kind === 'midi') next = cur?.kind === 'midi' ? cur : { kind: 'midi', note: store.freeResetNote(node) ?? 60 };
    else next = cur?.kind === 'osc' ? cur : { kind: 'osc', address: '' };
    store.setSequenceResetSource(node, next);
  }

  function commitResetNote(v: string): void {
    const parsed = parseMidiNote(v);
    if (parsed !== null) store.setSequenceResetSource(node, { kind: 'midi', note: parsed });
  }
</script>

<div class="kindbody">
  <p class="hint">Plays the next wired child on each hit, in order.</p>

  <!-- the node's own reset binding — divided from the step blurb above -->
  <div class="resetsection">
    <!-- stacked, not layout="row": four segments don't fit beside a label at dock width -->
    <Field label="Reset by">
      <SegmentedControl value={kindNow} options={RESET_OPTS} onChange={(v) => setResetKind(src, v)} ariaLabel="Reset source" />
    </Field>

    {#if src?.kind === 'drum'}
      <!-- Dropdowns, not segments: four drums as segments ran off the dock's edge. -->
      <Field layout="row" label="Drum">
        <Select value={src.drumId} options={DRUM_OPTS} segment={false} onChange={(v) => selectDrum(v, src.zone)} ariaLabel="Reset drum" />
      </Field>
      <Field layout="row" label="Zone">
        <Select
          value={src.zone}
          options={zoneOptsFor(src.drumId)}
          segment={false}
          placeholder="Select a configured zone"
          onChange={(v) => store.setSequenceResetSource(node, { kind: 'drum', drumId: src.drumId, zone: v })}
          ariaLabel="Reset zone"
        />
      </Field>
    {:else if src?.kind === 'midi'}
      <Field layout="row" label="Note" hint={src.note === undefined ? 'C-1 - G9' : String(src.note)}>
        <div class="note-row">
          <CommitInput
            value={src.note === undefined ? '' : formatMidiNote(src.note)}
            placeholder="C4"
            autofocus={false}
            mono
            ariaLabel="Reset MIDI note"
            onCommit={(v) => commitResetNote(v)}
          />
          <LearnButton
            armed={learning}
            ariaLabel="Learn reset MIDI note"
            onclick={() => (learning ? store.cancelMidiLearn() : store.startMidiLearn({ kind: 'sequence-reset', nodeId: node.id }))}
          />
        </div>
      </Field>
      {#if learning}
        <p class="hint">Press the pad or pedal to bind it.</p>
      {/if}
      {#if heard}
        <div class="heard"><InputActivityBadge {...heard} /></div>
      {/if}
      <p class="hint">Any note no drum zone or trigger uses. Channel filter is in Settings.</p>
    {:else if src?.kind === 'osc'}
      <Field layout="row" label="Address" hint="e.g. /reset">
        <CommitInput
          value={src.address}
          mono
          autofocus={false}
          placeholder="/reset"
          ariaLabel="Reset OSC address"
          onCommit={(v) => store.setSequenceResetSource(node, { kind: 'osc', address: v.trim() })}
        />
      </Field>
      {#if heard}
        <div class="heard"><InputActivityBadge {...heard} /></div>
      {/if}
    {/if}

    {#if src}
      <ReadRow label="Resets on" value={describeTriggerSource(src, store.project?.kit.drums ?? store.drums, store.project?.inputMap).sub} />
      <p class="hint resethint">
        <RotateCcw size={12} aria-hidden="true" />
        That input snaps this sequence back to step 1. It never plays anything itself.
      </p>
    {:else}
      <p class="hint">
        Optionally bind an input that snaps this sequence back to step 1 — a pad, a MIDI note, or an
        OSC address. The sequence itself keeps firing from this graph's trigger.
      </p>
    {/if}
  </div>
</div>

<style>
  .kindbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
  /* the reset-binding block — divided from the step blurb above */
  .resetsection {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-faint);
  }
  .resetsection :global(.sel) {
    width: 100%;
  }
  .note-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
  }
  /* Last-heard confirmation, tucked just under its field. */
  .heard {
    margin-top: calc(-1 * var(--space-1));
    padding-left: var(--space-1);
    min-width: 0;
  }
  /* the bound-reset summary — accent glyph + hint, matches the trigger inspector's link hint */
  .resethint {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text);
  }
  .resethint :global(svg) {
    color: var(--accent);
    flex: none;
  }
</style>
