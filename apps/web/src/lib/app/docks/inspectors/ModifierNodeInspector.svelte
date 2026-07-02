<script lang="ts">
  /* Modifier-node editor — the media-effects (Trail / Bloom / Grain…) node. Pick the modifier,
     bypass it, and tune its params (sliders / enums / toggles) with optional per-param
     envelopes — the SAME editing surface as a play node's effect params, driven by the core
     modifier registry's paramSpec. The shared node header (kind selector + remove) lives in the
     parent Inspector. A modifier node takes no trigger-flow input; it wires to a play (or
     another modifier) node's `mod` input. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import { listModifiers, type ParamSpec as CoreParamSpec } from '@ledrums/core';
  import { num } from '../../views/node-options';
  import Slider from '../../../ui/Slider.svelte';
  import Select from '../../../ui/Select.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import Spline from '@lucide/svelte/icons/spline';
  import Blend from '@lucide/svelte/icons/blend';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const MODS = listModifiers();
  const MOD_OPTS = MODS.map((m) => ({ value: m.id, label: m.name }));
  const def = $derived(MODS.find((m) => m.id === node.modifierId) ?? null);
  const specs = $derived<CoreParamSpec[]>(def?.paramSpec ?? []);
  const live = $derived(node.params);

  /** Read a param as string (enum choice), else fall back to `d`. */
  const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
  const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  /** Number read-out honouring the spec's step (2dp for sub-integer steps) + unit. */
  function fmtNum(spec: CoreParamSpec, v: number): string {
    return `${spec.step && spec.step < 1 ? v.toFixed(2) : Math.round(v)}${spec.unit ?? ''}`;
  }
</script>

<header class="ihead">
  <span class="chip"><Blend size={16} aria-hidden="true" /></span>
  <div class="titles">
    <h3>{def?.name ?? 'Modifier'}</h3>
    <span class="sub">{def?.category ?? 'none'} · modifier</span>
  </div>
</header>

<div class="bar">
  <label class="lblrow">
    <span class="k">Modifier</span>
    <Select
      value={node.modifierId ?? ''}
      options={MOD_OPTS}
      onChange={(v) => store.setModifierId(node, v)}
      ariaLabel="Modifier type"
    />
  </label>
  <label class="bypass">
    <span class="k">Bypass</span>
    <Toggle pressed={!!node.bypass} onChange={(v) => store.setModifierBypass(node, v)} ariaLabel="Bypass modifier" />
  </label>
</div>

{#if specs.length}
  <div class="params">
    {#each specs as spec (spec.key)}
      {@const enveloped = store.isEnveloped(node, spec.key)}
      <div class="prow">
        <span class="plabel">{spec.label}</span>
        {#if spec.type === 'number'}
          <Slider
            value={num(live[spec.key], typeof spec.default === 'number' ? spec.default : 0)}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            disabled={enveloped}
            format={(v) => (enveloped ? 'swept' : fmtNum(spec, v))}
            onChange={(v) => store.setParam(node, spec.key, v)}
            ariaLabel={spec.label}
          />
        {:else if spec.type === 'enum'}
          <Select
            value={str(live[spec.key], spec.options?.[0] ?? '')}
            options={(spec.options ?? []).map((o) => ({ value: o, label: titleCase(o) }))}
            onChange={(v) => store.setParam(node, spec.key, v)}
            ariaLabel={spec.label}
            class="paramsel"
          />
        {:else}
          <Toggle pressed={live[spec.key] === true} onChange={(v) => store.setParam(node, spec.key, v)} ariaLabel={spec.label} class="boolcell" />
        {/if}
        {#if spec.type === 'number'}
          <IconButton
            icon={Spline}
            label="Assign envelope"
            variant={enveloped ? 'solid' : 'soft'}
            size={12}
            onclick={() => store.openEnv(node, spec.key)}
          />
        {:else}
          <span class="envspace"></span>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <div class="kindbody">
    <p class="hint">This modifier node has no modifier selected — pick one above.</p>
  </div>
{/if}

<p class="foot">
  {node.bypass ? 'Bypassed — passes the frame through unchanged.' : 'Applies to every effect wired from this node’s mod output.'}
</p>

<style>
  .ihead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex: none;
    border-radius: var(--radius-2);
    color: var(--role-mod);
    background: color-mix(in oklch, var(--role-mod) 16%, transparent);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
  }
  .sub {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    text-transform: capitalize;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .lblrow {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
  }
  .lblrow :global(.select-trigger) {
    flex: 1;
    min-width: 0;
  }
  .bypass {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .k {
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-size: var(--text-2xs);
    white-space: nowrap;
  }
  .params {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .prow {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }
  .plabel {
    font-size: var(--text-xs);
    color: var(--text);
  }
  .prow :global(.boolcell) {
    justify-self: start;
  }
  .prow :global(.paramsel) {
    width: 100%;
    min-width: 0;
  }
  .envspace {
    width: 1px;
  }
  .kindbody {
    padding: var(--space-3);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  .foot {
    margin: 0;
    padding: var(--space-3);
    border-top: 1px solid var(--border-faint);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
</style>
