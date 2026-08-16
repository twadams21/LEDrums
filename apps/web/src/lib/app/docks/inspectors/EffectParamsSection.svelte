<script lang="ts">
  /* Effect parameters, S4's progressive disclosure (option 4): a filter box over a COMMON
     section that is always visible and a fold holding the effect's own params.

     The load-bearing rule lives in `param-families.ts` and is asserted across the whole
     registry: a family decides only WHERE a param renders, never HOW. Every row is the
     generator's own declared spec under its own key — `baseHue` stays `baseHue`, `lifeBeats`
     stays `lifeBeats` — so the common section works today without the core key normalisation
     (S7). Nothing may silently vanish: common ∪ fold is exactly the declared set. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { EffectDef, GraphNode } from '../../../trigger-lab/sim';
  import type { Hsv } from '@ledrums/core';
  import { num } from '../../views/node-options';
  import { groupParamsFiltered } from './param-families';
  import { paramFold } from './param-disclosure.svelte';
  import ParamRow from './ParamRow.svelte';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import SearchField from '../../../ui/SearchField.svelte';
  import Disclosure from '../../../ui/Disclosure.svelte';
  import ColorSwatch from '../../../ui/ColorSwatch.svelte';

  let { store, node, eff }: { store: TriggerLab; node: GraphNode; eff: EffectDef } = $props();

  const live = $derived(store.liveParams(node));

  /* The filter is a lens on THIS node's params, so it resets when you select another node.
     A filter carried across a selection would read as "this effect has three params". */
  let filter = $state('');
  $effect(() => {
    void node.id;
    filter = '';
  });

  const filtering = $derived(filter.trim().length > 0);
  const grouped = $derived(groupParamsFiltered(eff.params, filter));
  const hiddenAll = $derived(filtering && grouped.commonParams.length === 0 && grouped.specific.length === 0);

  /** Effects that carry hue + saturation + brightness numeric params get a colour swatch
      that writes through to all three (the picker is UI-only — persistence stays numeric). */
  const COLOR_KEYS = ['hue', 'saturation', 'brightness'] as const;
  const hasColorSwatch = $derived(COLOR_KEYS.every((k) => eff.params.some((p) => p.key === k)));
  // A colour param is "modulated" when it's an exposed target with at least one incoming
  // modulation wire (doc 10) — the legacy per-param envelope was folded into these mappings (S35).
  const colorModulated = $derived(hasColorSwatch && COLOR_KEYS.some((k) => store.mappingsFor(node, k).length > 0));
  // The swatch is a shortcut that writes all three colour params at once, not a declared param
  // of its own. While a filter is active it would edit rows the filter has hidden, so it steps
  // aside — filtering is a "find this exact param" gesture, and the three rows it writes are
  // still reachable by their own keys.
  const showSwatch = $derived(hasColorSwatch && !filtering);

  function applyColor(hsv: Hsv): void {
    store.setParam(node, 'hue', hsv.h);
    store.setParam(node, 'saturation', hsv.s);
    store.setParam(node, 'brightness', hsv.v);
  }

  // An active filter forces the fold open — otherwise a match inside it would be invisible —
  // without overwriting what the user left it set to.
  const foldOpen = $derived(paramFold.open || filtering);
</script>

<div class="fxparams">
  <div class="filterrow">
    <SearchField
      bind:value={filter}
      placeholder="Filter params…"
      ariaLabel="Filter parameters"
      class="pfilter"
    />
  </div>

  {#if showSwatch || grouped.commonParams.length}
    <section class="common">
      <div class="secthead">
        <Eyebrow>Common</Eyebrow>
        <span class="count">{grouped.commonParams.length}</span>
      </div>
      <div class="rows">
        {#if showSwatch}
          <div class="swatchrow">
            <span class="plabel">Colour</span>
            <ColorSwatch
              hue={num(live['hue'], 0)}
              saturation={num(live['saturation'], 1)}
              brightness={num(live['brightness'], 1)}
              modulated={colorModulated}
              onChange={applyColor}
              ariaLabel="Effect colour"
            />
          </div>
        {/if}
        {#each grouped.commonParams as spec (spec.key)}
          <ParamRow {store} {node} {spec} {live} />
        {/each}
      </div>
    </section>
  {/if}

  <Disclosure
    label={eff.name}
    count={grouped.specific.length}
    open={foldOpen}
    onToggle={(v) => {
      if (!filtering) paramFold.open = v;
    }}
  >
    <div class="rows">
      {#each grouped.specific as spec (spec.key)}
        <ParamRow {store} {node} {spec} {live} />
      {:else}
        <p class="none">
          {filtering ? 'No effect-specific parameter matches the filter.' : 'This effect has no parameters of its own.'}
        </p>
      {/each}
    </div>
  </Disclosure>

  {#if hiddenAll}
    <p class="none empty">No parameter matches “{filter.trim()}”.</p>
  {/if}
</div>

<style>
  .filterrow {
    padding: var(--space-2) var(--space-3);
  }
  .filterrow :global(.pfilter) {
    display: flex;
    width: 100%;
  }
  .secthead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-1);
  }
  .count {
    margin-left: auto;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-disabled);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-3);
  }
  .swatchrow {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
  }
  .plabel {
    font-size: var(--text-xs);
    color: var(--text);
  }
  .none {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    line-height: var(--leading-normal);
  }
  .empty {
    padding: var(--space-3);
    border-top: 1px solid var(--border-faint);
  }
</style>
