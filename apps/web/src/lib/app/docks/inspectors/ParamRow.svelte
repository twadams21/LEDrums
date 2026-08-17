<script lang="ts">
  /* One declared effect parameter: its own label, its own control, its own range and unit.
     Extracted from PlayNodeInspector when S4 split the params into a common section and a
     disclosure fold — both render rows through here, so the two sections cannot drift into
     rendering the same param differently. A row NEVER substitutes a spec: whatever the
     generator declared under this key is what appears. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, ParamSpec, ParamValues } from '../../../trigger-lab/sim';
  import { num, fmt } from '../../views/node-options';
  import Slider from '../../../ui/Slider.svelte';
  import Select from '../../../ui/Select.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import FaceExposeButton from './FaceExposeButton.svelte';
  import ParamLabel from './ParamLabel.svelte';

  let {
    store,
    node,
    spec,
    live,
  }: { store: TriggerLab; node: GraphNode; spec: ParamSpec; live: ParamValues } = $props();

  /** Read a param as a string (enum choice / colour hex), falling back to `d`. */
  const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
  /** Enum value → a friendly Select label ("out" → "Out", "x" → "X"). */
  const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
</script>

<div class="prow">
  <FaceExposeButton {store} {node} param={spec.key} label={spec.label} />
  <ParamLabel
    label={spec.label}
    unit={spec.unit}
    min={spec.min}
    max={spec.max}
    title={`${spec.label} — key "${spec.key}"`}
  />
  {#if spec.kind === 'number'}
    <Slider
      value={num(live[spec.key], 0)}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      format={(v) => fmt(spec, v)}
      showUnit={false}
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
</div>

<style>
  .prow {
    display: grid;
    /* face-expose affordance (S5, re-seated left by F3 item 1) · label · control */
    grid-template-columns: auto 84px minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
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
