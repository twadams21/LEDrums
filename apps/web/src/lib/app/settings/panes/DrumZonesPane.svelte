<script lang="ts">
  /* Settings › Drum trigger zones — the per-drum zone→input wiring, split out of the Input
     pane so the mapping every drummer edits is one click away instead of three panels down.
     `DrumZonesList` is reused wholesale from its Inspector path (the Trigger-graph source
     editor renders the same list), one per drum in kit order, on the same `setInputMap`
     mutation path. The lists carry no gating of their own, so the Inspector's
     natively-disabled fieldset wraps them here exactly as it did in Input. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import DrumZonesList from '../../docks/inspectors/DrumZonesList.svelte';
  import { patchLabel } from '../../docks/inspectors/forms';
  import { drumZoneId } from '../../patch-zones';
  import PaneHeader from '../PaneHeader.svelte';

  let { store }: { store: TriggerLab } = $props();

  /* Zone lists follow the AUTHORITATIVE kit (project.kit.drums) — same truth source as the
     sibling Drums & Hoops pane — falling back to the build-time fixture only offline. */
  const drums = $derived(store.project?.kit.drums ?? store.drums);
</script>

<div class="pane-body">
  <PaneHeader id="zones" />
  <p class="zhint">
    Map each drum's zones to the MIDI notes / OSC addresses that fire them — shared by every
    trigger graph on that drum.
  </p>
  <fieldset class="drums" disabled={!store.canEdit}>
    {#each drums as drum (drum.id)}
      <div class="drumcard">
        <DrumZonesList {store} drumId={drum.id} drumLabel={patchLabel(store, drumZoneId(drum.id), drum.label || drum.id)} />
      </div>
    {/each}
  </fieldset>
</div>

<style>
  .pane-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .zhint {
    margin: 0;
    max-width: 60ch;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  /* One card per drum; the fieldset is the viewer read-only gate (Inspector idiom) and
     must lay out like a plain column. */
  .drums {
    border: none;
    margin: 0;
    padding: 0;
    min-inline-size: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .drumcard {
    padding: var(--space-2) var(--space-3) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
  }
</style>
