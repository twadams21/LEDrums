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
  import { resolveVoiceSustainMs, type CurveValue, type Hsv } from '@ledrums/core';
  import { lifeParamKey, seedLifeEnvelope } from '../../../trigger-lab/life-envelope';
  import { num } from '../../views/node-options';
  import { groupParamsFiltered } from './param-families';
  import { paramFold } from './param-disclosure.svelte';
  import ParamRow from './ParamRow.svelte';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import SearchField from '../../../ui/SearchField.svelte';
  import Disclosure from '../../../ui/Disclosure.svelte';
  import ColorSwatch from '../../../ui/ColorSwatch.svelte';
  import CurveField from '../../../ui/CurveField.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import Spline from '@lucide/svelte/icons/spline';
  import Undo2 from '@lucide/svelte/icons/undo-2';

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

  // --- life envelope (S6b, re-seated here when S4's layout landed) ----------
  // An effect that DECLARES a life param (`EffectGenerator.voiceLife`) can have that scalar
  // drawn as a shape instead. The curve's x axis is normalised over exactly that declared
  // life, so `h1.x = 1` is the Life slider's own value and seeding changes nothing visually.
  // While a filter is active the curve steps aside like the swatch does, and the scalar row
  // (which still sets the curve's time span) answers the "find this exact param" gesture.
  const lifeKey = $derived(lifeParamKey(eff.generatorId));
  const lifeEnvelope = $derived(node.lifeEnvelope ?? null);
  /** Real-time width of the envelope's x axis — what the author is actually drawing across. */
  const lifeSpanMs = $derived(resolveVoiceSustainMs(eff.generatorId, live, store.bpm, eff.sustainMs));
  const lifeSpec = $derived(lifeKey ? eff.params.find((p) => p.key === lifeKey) ?? null : null);
  /** One undo per gesture: the first live frame opens the checkpoint, the rest fold into it. */
  let lifeDragging = $state(false);

  function onLifeChange(v: CurveValue): void {
    if (lifeDragging) store.updateLifeEnvelope(node, v);
    else {
      lifeDragging = true;
      store.setLifeEnvelope(node, v); // snapshots the PRE-drag state, then writes
    }
  }
  function onLifeCommit(v: CurveValue): void {
    store.updateLifeEnvelope(node, v);
    lifeDragging = false;
  }
  const fmtLifeX = (u: number): string =>
    lifeSpanMs >= 1000 ? `${(u * lifeSpanMs / 1000).toFixed(2)} s` : `${Math.round(u * lifeSpanMs)} ms`;

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
        {#each grouped.commonParams.filter((p) => !(lifeEnvelope && p.key === lifeKey && !filtering)) as spec (spec.key)}
          {#if spec.key === lifeKey && !lifeEnvelope}
            <ParamRow {store} {node} {spec} {live}>
              {#snippet trailing()}
                <IconButton
                  icon={Spline}
                  label="Draw {spec.label} as a curve"
                  variant="soft"
                  size={14}
                  onclick={() => store.setLifeEnvelope(node, seedLifeEnvelope(eff.generatorId))}
                />
              {/snippet}
            </ParamRow>
          {:else}
            <ParamRow {store} {node} {spec} {live} />
          {/if}
        {/each}
        {#if lifeEnvelope && !filtering}
          <div class="lifeenv">
            <div class="lifehead">
              <span class="plabel">{lifeSpec?.label ?? 'Life'}</span>
              <span class="lifespan">{fmtLifeX(1)}</span>
              <IconButton
                icon={Undo2}
                label="Detach the curve — back to the {lifeSpec?.label ?? 'Life'} slider"
                variant="soft"
                size={14}
                onclick={() => store.setLifeEnvelope(node, null)}
              />
            </div>
            <CurveField
              value={lifeEnvelope}
              onChange={onLifeChange}
              onCommit={onLifeCommit}
              xAxis={{ label: 'time', format: fmtLifeX }}
              yAxis={{ label: 'level', format: (u) => `${Math.round(u * 100)}%` }}
              height={104}
              ariaLabel="{lifeSpec?.label ?? 'Life'} envelope"
            />
          </div>
        {/if}
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
  .lifeenv {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-1);
  }
  .lifehead {
    /* Same column rhythm as a param row, so the Detach button lands in the gutter the
       draw-as-a-curve button left behind — the swap happens in place, not somewhere new. */
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr) var(--control-icon-size);
    align-items: center;
    gap: var(--space-2);
  }
  .lifehead :global(.ib) {
    justify-self: center;
  }
  .lifespan {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
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
