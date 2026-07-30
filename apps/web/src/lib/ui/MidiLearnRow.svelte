<script lang="ts">
  /* A value field paired with a MIDI-learn pill — the "type it, or hit Learn and play it" row.
     Written out in DrumZonesList, TriggerSourceInspector and CcNodeInspector before this existed;
     the grid and the 29px pill were byte-identical in all three (CcNodeInspector called its grid
     `.cc-row` rather than `.note-row`, same four declarations).

     TARGET-AGNOSTIC BY DESIGN. This component takes no learn-target descriptor: each caller keeps
     its own `store.midi.startLearn({ kind, ... })` dispatch and passes only `learning` + `onToggle`.
     That is deliberate — it is what lets a learn-target address change (INIT-07's {drumId,slot})
     land without touching this component, and it removes any ordering dependency between the two
     initiatives. All three sites already owned their dispatch, so nothing had to move.

     The field itself is the caller's snippet: their CommitInputs genuinely differ
     (placeholder / allowEmpty / mono / onCommit), and that difference is not this row's business.

     Deliberately NOT unified with lib/ui/ActionButton: the learn pill is 29px / text-2xs /
     weight 600 / text-muted against the action's 30px / text-xs / normal / ink, and the veto
     round decided the two stay distinct. */
  import type { Snippet } from 'svelte';
  import Radio from '@lucide/svelte/icons/radio';

  let {
    learning,
    disabled = false,
    onToggle,
    children,
  }: {
    /** Armed — the pill lights accent and reads "Listening". */
    learning: boolean;
    disabled?: boolean;
    /** Arm or cancel. The caller owns which target it arms. */
    onToggle: () => void;
    /** The value field this row is learning into. */
    children: Snippet;
  } = $props();
</script>

<div class="note-row">
  {@render children()}
  <button
    type="button"
    class="learn"
    class:active={learning}
    {disabled}
    onclick={(e) => {
      e.preventDefault();
      onToggle();
    }}
  >
    <Radio size={13} aria-hidden="true" />
    {learning ? 'Listening' : 'Learn'}
  </button>
</div>

<style>
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
</style>
