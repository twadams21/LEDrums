<script lang="ts">
  /* Settings › Drum trigger zones — the per-drum zone→input wiring, split out of the Input
     pane so the mapping every drummer edits is one click away instead of three panels down.
     `DrumZonesList` is reused wholesale from its Inspector path (the Trigger-graph source
     editor renders the same list), one per drum in kit order, on the same `setInputMap`
     mutation path. The lists carry no gating of their own, so the Inspector's
     natively-disabled fieldset wraps them here exactly as it did in Input. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import DrumVelocityCurve from './DrumVelocityCurve.svelte';
  import DrumZonesList from '../../docks/inspectors/DrumZonesList.svelte';
  import { patchLabel } from '../../docks/inspectors/forms';
  import { drumZoneId } from '../../patch-zones';
  import PaneHeader from '../PaneHeader.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import { pushToast } from '../../../ui/toast.svelte';

  let { store }: { store: TriggerLab } = $props();

  /* Zone lists follow the AUTHORITATIVE kit (project.kit.drums) — same truth source as the
     sibling Drums & Hoops pane — falling back to the build-time fixture only offline. */
  const drums = $derived(store.project?.kit.drums ?? store.drums);

  /** One-off: bring the show's existing sections up to the zone set new sections get. */
  function fillExisting(): void {
    const added = store.fillAllSectionsWithZoneGraphs();
    pushToast(
      added > 0 ? `Added ${added} zone ${added === 1 ? 'graph' : 'graphs'} to your sections.` : 'Every section already has a graph for each zone.',
      { tone: added > 0 ? 'success' : 'info' },
    );
  }
</script>

<div class="pane-body">
  <PaneHeader id="zones" />
  <p class="zhint">
    Map each drum's zones to the MIDI notes / OSC addresses that fire them — shared by every
    trigger graph on that drum. Each drum also carries one velocity sensitivity curve, shared
    by all of its zones.
  </p>
  <!-- Per SHOW (it travels with the show, not the kit): new sections and songs start with one
       empty graph per zone listed below, so the zones never have to be rebuilt by hand. -->
  <div class="zonegraphs">
    <div class="zg-text">
      <span class="zg-title">A graph per zone in every new section</span>
      <span class="zg-sub">This show. New sections and songs start with an empty graph for each zone below, ready to fill.</span>
    </div>
    <div class="zg-actions">
      <Toggle
        pressed={store.autoZoneGraphs}
        disabled={!store.canEdit}
        onChange={(on) => store.setAutoZoneGraphs(on)}
        ariaLabel="A graph per zone in every new section"
      />
      <button type="button" disabled={!store.canEdit || store.drumZones.length === 0} onclick={fillExisting}>Add to existing sections</button>
    </div>
  </div>
  <fieldset class="drums" disabled={!store.canEdit}>
    {#each drums as drum (drum.id)}
      {@const label = patchLabel(store, drumZoneId(drum.id), drum.label || drum.id)}
      <div class="drumcard">
        <DrumZonesList {store} drumId={drum.id} drumLabel={label} />
        <hr class="rule" />
        <DrumVelocityCurve {store} drumId={drum.id} drumLabel={label} />
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
  .zonegraphs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
  }
  .zg-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 240px;
    min-width: 0;
  }
  .zg-title {
    font-size: var(--text-sm);
    color: var(--ink);
  }
  .zg-sub {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .zg-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
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
  /* Zones and velocity are two facts about the SAME drum, so they share the card and are
     separated by a rule rather than by another border — the drum stays one object. */
  .rule {
    height: 0;
    margin: var(--space-3) 0;
    border: 0;
    border-top: 1px solid var(--border-faint);
  }
</style>
