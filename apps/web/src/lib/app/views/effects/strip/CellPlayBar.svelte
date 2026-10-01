<script lang="ts">
  /* How the selected cell's stack plays a hit (Tim, 2026-10-01 — the graph's Sequence and Random
     nodes, re-homed on the cell because they choose BETWEEN Effects): Layer (every Effect, the
     default) · Sequence (one per hit, in stack order) · Random (one per hit, never twice running).
     The steps ARE the Effect rows below, so editing, reordering and auditioning a step is just
     using the strip — there is no separate step editor to open.

     To have each step stop the one before at once, set the steps' Retrigger to Cut.

     A Sequence / Random cell rewinds to step 1 whenever its section starts, and optionally on an
     input: a drum zone, a MIDI note or CC (with Learn), or an OSC address. A reset note may also
     play a zone — the one hit then does both (the store says so when Learn binds one). */
  import type { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import SegmentedControl from '../../../../ui/SegmentedControl.svelte';
  import Select from '../../../../ui/Select.svelte';
  import CommitInput from '../../../../ui/CommitInput.svelte';
  import LearnButton from '../../../../ui/LearnButton.svelte';
  import Tooltip from '../../../../ui/Tooltip.svelte';
  import Info from '@lucide/svelte/icons/info';
  import { formatMidiNote, parseMidiNote } from '../../../../midi/midi-note';

  type EffectCell = effectChain.EffectCell;
  type CellReset = effectChain.CellReset;

  let { api, cell, steps }: { api: EffectsAuthoringApi; cell: EffectCell; steps: number } = $props();

  const MODE_OPTS = [
    { value: 'layer', label: 'Layer' },
    { value: 'sequence', label: 'Sequence' },
    { value: 'random', label: 'Random' },
  ];
  const RESET_OPTS = [
    { value: 'none', label: 'Section start only' },
    { value: 'zone', label: 'Drum zone' },
    { value: 'midiNote', label: 'MIDI note' },
    { value: 'midiCc', label: 'MIDI CC' },
    { value: 'osc', label: 'OSC address' },
  ];
  const MODE_INFO =
    'Layer plays every Effect in this cell on each hit. Sequence plays one per hit, top to bottom, then starts over. Random plays one per hit, never the same one twice in a row. Reorder the rows below to change the order. Set Retrigger to Cut on the steps to stop the previous step the moment the next one plays.';

  const play = $derived(api.cellPlay(cell));
  const mode = $derived(play?.mode ?? 'layer');
  const reset = $derived(play?.reset ?? null);
  const disabled = $derived(!api.canEdit);
  const learning = $derived.by(() => {
    const armed = api.cellResetLearnCell;
    return !!armed && JSON.stringify(armed) === JSON.stringify(cell);
  });

  const drums = $derived(api.gridRows.filter((r) => r.id !== 'kit'));
  const zones = $derived(
    api.gridColumns.flatMap((c) => (c.column.kind === 'zone' ? [{ value: String(c.column.slot), label: c.label }] : [])),
  );

  /** Switch the reset kind, carrying the least-surprising default for the new kind. */
  function setResetKind(kind: string): void {
    if (kind === 'none') {
      api.setCellReset(cell, null);
      if (learning) api.cancelCueLearn();
      return;
    }
    let next: CellReset;
    if (kind === 'zone') next = { kind: 'zone', drumId: drums[0]?.id ?? '', slot: Number(zones[0]?.value ?? 0) };
    else if (kind === 'midiNote') next = { kind: 'midiNote', note: 36 };
    else if (kind === 'midiCc') next = { kind: 'midiCc', cc: 1 };
    else next = { kind: 'osc', address: '/reset' };
    if (next.kind === 'zone' && !next.drumId) return;
    api.setCellReset(cell, next);
  }
  function learn(via: 'midi' | 'osc'): void {
    if (learning) api.cancelCueLearn();
    else api.startCellResetLearn(cell, via);
  }
</script>

<div class="playbar" role="group" aria-label="How this cell plays">
  <span class="lab">
    Play
    <Tooltip text={MODE_INFO} side="top">
      <span class="info" aria-label="About Play"><Info size={12} aria-hidden="true" /></span>
    </Tooltip>
  </span>
  <SegmentedControl
    value={mode}
    options={MODE_OPTS}
    {disabled}
    onChange={(v) => api.setCellPlayMode(cell, v as effectChain.CellPlayMode)}
    ariaLabel="How this cell plays"
  />
  {#if mode !== 'layer' && steps < 2}
    <span class="hint">Add another Effect to give it steps.</span>
  {/if}

  {#if mode !== 'layer'}
    <span class="lab reset-lab">Reset</span>
    <span class="field">
      <Select
        value={reset?.kind ?? 'none'}
        options={RESET_OPTS}
        segment={false}
        {disabled}
        onChange={setResetKind}
        ariaLabel="Reset to step 1 on"
      />
    </span>
    {#if reset?.kind === 'zone'}
      <span class="field">
        <Select
          value={reset.drumId}
          options={drums.map((d) => ({ value: d.id, label: d.label }))}
          segment={false}
          {disabled}
          onChange={(v) => api.setCellReset(cell, { kind: 'zone', drumId: v, slot: reset.slot })}
          ariaLabel="Reset drum"
        />
      </span>
      <span class="field">
        <Select
          value={String(reset.slot)}
          options={zones}
          segment={false}
          {disabled}
          onChange={(v) => api.setCellReset(cell, { kind: 'zone', drumId: reset.drumId, slot: Number(v) })}
          ariaLabel="Reset zone"
        />
      </span>
    {:else if reset?.kind === 'midiNote'}
      <span class="num">
        <CommitInput
          value={formatMidiNote(reset.note)}
          mono
          autofocus={false}
          ariaLabel="Reset MIDI note"
          onCommit={(v) => {
            const note = parseMidiNote(v);
            if (note !== null) api.setCellReset(cell, { kind: 'midiNote', note });
          }}
        />
      </span>
      <LearnButton armed={learning} {disabled} ariaLabel="Learn reset MIDI note" onclick={() => learn('midi')} />
    {:else if reset?.kind === 'midiCc'}
      <span class="num">
        <CommitInput
          type="number"
          min={1}
          max={127}
          value={reset.cc}
          autofocus={false}
          ariaLabel="Reset MIDI CC"
          onCommit={(v) => {
            const cc = Number(v);
            if (Number.isInteger(cc) && cc >= 1 && cc <= 127) api.setCellReset(cell, { kind: 'midiCc', cc });
          }}
        />
      </span>
      <LearnButton armed={learning} {disabled} ariaLabel="Learn reset MIDI CC" onclick={() => learn('midi')} />
    {:else if reset?.kind === 'osc'}
      <span class="addr">
        <CommitInput
          value={reset.address}
          mono
          autofocus={false}
          ariaLabel="Reset OSC address"
          onCommit={(v) => {
            const address = v.trim();
            if (address) api.setCellReset(cell, { kind: 'osc', address });
          }}
        />
      </span>
      <LearnButton armed={learning} {disabled} ariaLabel="Learn reset OSC address" onclick={() => learn('osc')} />
    {/if}
    {#if learning}<span class="hint">Send the note, controller or address to bind it…</span>{/if}
  {/if}
</div>

<style>
  .playbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1_5) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .lab {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .reset-lab {
    margin-left: var(--space-2);
  }

  .info {
    display: inline-flex;
    color: var(--text-faint);
  }
  .field {
    display: inline-flex;
  }
  .num {
    display: inline-flex;
    width: 64px;
  }
  .addr {
    display: inline-flex;
    width: 140px;
  }
  .hint {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
</style>
