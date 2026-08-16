<script lang="ts">
  /* One declared effect parameter: its own label, its own control, its own range and unit.
     Extracted from PlayNodeInspector when S4 split the params into a common section and a
     disclosure fold — both render rows through here, so the two sections cannot drift into
     rendering the same param differently. A row NEVER substitutes a spec: whatever the
     generator declared under this key is what appears. */
  import type { Snippet } from 'svelte';
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, ParamSpec, ParamValues } from '../../../trigger-lab/sim';
  import { num, fmt } from '../../views/node-options';
  import Slider from '../../../ui/Slider.svelte';
  import Select from '../../../ui/Select.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import FaceExposeButton from './FaceExposeButton.svelte';

  let {
    store,
    node,
    spec,
    live,
    trailing,
  }: { store: TriggerLab; node: GraphNode; spec: ParamSpec; live: ParamValues; trailing?: Snippet } = $props();

  /** Read a param as a string (enum choice / colour hex), falling back to `d`. */
  const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
  /** Enum value → a friendly Select label ("out" → "Out", "x" → "X"). */
  const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
</script>

<div class="prow">
  <span class="plabel" title={`${spec.label} — key "${spec.key}"`}>{spec.label}</span>
  {#if spec.kind === 'number'}
    <Slider
      value={num(live[spec.key], 0)}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      format={(v) => fmt(spec, v)}
      onChange={(v) => store.setParam(node, spec.key, v)}
      ariaLabel={spec.label}
    />
  {:else if spec.kind === 'enum'}
    <Select
      value={str(live[spec.key], spec.options?.[0] ?? '')}
      options={(spec.options ?? []).map((o) => ({ value: o, label: titleCase(o) }))}
      onChange={(v) => store.setParam(node, spec.key, v)}
      ariaLabel={spec.label}
      class="paramsel"
    />
  {:else}
    <!-- bool → Toggle. `color` specs map (fixtures.mapParamSpec) but their inspector
         control — the write-through swatch — is owned by S19; no effect declares one yet. -->
    <Toggle
      pressed={live[spec.key] === true}
      onChange={(v) => store.setParam(node, spec.key, v)}
      ariaLabel={spec.label}
      class="boolcell"
    />
  {/if}
  <!-- Reserved gutter (S6b): only one row carries a trailing affordance (draw-life-as-a-curve),
       and without the reservation that row's control would run one icon shorter than the rest. -->
  <span class="ptrail">{@render trailing?.()}</span>
  <FaceExposeButton {store} {node} param={spec.key} label={spec.label} />
</div>

<style>
  .prow {
    display: grid;
    /* label · control · face-expose affordance (S5) */
    grid-template-columns: 84px minmax(0, 1fr) var(--control-icon-size) auto;
    align-items: center;
    gap: var(--space-2);
  }
  .plabel {
    font-size: var(--text-xs);
    color: var(--text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ptrail {
    display: inline-flex;
    justify-content: center;
  }
  .prow :global(.boolcell) {
    justify-self: start;
  }
  /* Enum Select fills the middle (value) column, like the scope-target select. */
  .prow :global(.paramsel) {
    width: 100%;
    min-width: 0;
  }
</style>
