<script lang="ts">
  /* A drum's VELOCITY SENSITIVITY — the transfer curve from how hard the trigger was hit to
     the velocity every graph on that drum sees. Per DRUM, not per zone (Trent, 2026-08-17:
     "Kick has 1 sensitivity curve, not each zone of the kick drum"), so it sits beside the
     drum's zone list rather than inside it.

     Live feedback is the point of putting it here: recent hits plot as fading markers on the
     curve WHILE you drum, against the shape currently on screen — so a tweak you have not let
     go of yet already shows whether it helps. The markers carry only their input velocity;
     their height is read off the curve, which is what makes an unsaved edit re-plot hits that
     already landed.

     Writes go through the same validated `store.setInputMap` gate the zones use, once per
     gesture (`onCommit`) so one drag is one undo — never per drag frame. */
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { IDENTITY_CURVE, isIdentityCurve, withVelocityCurve, type CurveValue } from '@ledrums/core';
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import CurveField from '../../../ui/CurveField.svelte';
  import IconButton from '../../../ui/IconButton.svelte';

  let { store, drumId, drumLabel }: { store: TriggerLab; drumId: string; drumLabel?: string } = $props();

  const project = $derived(store.project);
  /** The stored curve, or nothing — absent IS the identity, so nothing is the common case. */
  const stored = $derived(project?.inputMap.velocityCurves[drumId]);
  /** Mid-gesture the draft leads; between gestures the model does. */
  let draft = $state<CurveValue | null>(null);
  const value = $derived(draft ?? stored ?? IDENTITY_CURVE);
  const custom = $derived(stored !== undefined && !isIdentityCurve(stored));

  /** MIDI's own units on both axes — 0..127 is what a drummer reads on a trigger module. */
  const asVelocity = (u: number): string => String(Math.round(u * 127));

  function commit(next: CurveValue): void {
    if (!project) {
      draft = null;
      return;
    }
    // Hold the gesture's value across the write so the curve cannot flicker back for a frame.
    draft = next;
    store.setInputMap(withVelocityCurve(project.inputMap, drumId, next));
    // The model is authoritative again — including when the gate REFUSED the write, where
    // falling back to `stored` is exactly the right correction.
    draft = null;
  }

  function reset(): void {
    if (!project) return;
    draft = null;
    store.setInputMap(withVelocityCurve(project.inputMap, drumId, null));
  }
</script>

<div class="velocity">
  <div class="sectionhead">
    <!-- No drum name here: this section sits INSIDE that drum's card, under a zone list that
         already names it. Repeating it would be chrome. The name still rides the plot's
         accessible label, where there is no card to supply the context. -->
    <span class="seclabel">Velocity</span>
    <span class="secstate" class:on={custom}>{custom ? 'custom' : 'linear'}</span>
    <IconButton
      icon={RotateCcw}
      label="Reset to linear"
      variant="soft"
      size={14}
      disabled={!custom || !project}
      onclick={reset}
    />
  </div>
  <CurveField
    {value}
    onChange={(v) => (draft = v)}
    onCommit={commit}
    xAxis={{ label: 'hit', format: asVelocity }}
    yAxis={{ label: 'out', format: asVelocity }}
    ghost={(x) => x}
    hits={store.velocityHitsFor(drumId)}
    height={104}
    showPreview={false}
    disabled={!project}
    ariaLabel={`Velocity sensitivity — ${drumLabel ?? drumId}`}
  />
  <p class="hint">
    How hard a hit reads: <b>hit</b> is what the trigger sent, <b>out</b> is what every graph on
    this drum sees. The dashed line is no change; hits plot live while you play.
  </p>
</div>

<style>
  .velocity {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  /* Section language borrowed wholesale from the zone list above it, so the two read as one
     card rather than two panels that happen to share a border. */
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
  /* Sits where the zone list puts its count — same rhythm, and it is the same kind of fact:
     one glance says whether this drum has been tuned. */
  .secstate {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .secstate.on {
    color: var(--text-muted);
  }
  .hint {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-faint);
    text-wrap: pretty;
  }
  .hint b {
    font-weight: 600;
    color: var(--text-muted);
  }
</style>
