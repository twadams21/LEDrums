<script lang="ts">
  /* A device's params on its card face: label left, control right, one row each. Numbers and
     booleans ride the compact face control (the node-face precedent — rail + drag field,
     gesture-bracketed, modulated badge); an enum is a Select, because a card has the width a
     node face lacked and a cycle chip hides the choices; a colour is a ColorField. Params that name
     a section (core `ParamSpec.section`) sit under capitalised headers, short sections sharing a
     column (`sectionColumns`). */
  import FaceParamControl from '../../../../../ui/FaceParamControl.svelte';
  import Select from '../../../../../ui/Select.svelte';
  import ColorField from '../../../../../ui/ColorField.svelte';
  import Tooltip from '../../../../../ui/Tooltip.svelte';
  import Info from '@lucide/svelte/icons/info';
  import type { MappableSpec } from '../../../../../trigger-lab/map-api';
  import { mappable } from '../../../../map-mode/mappable.svelte';
  import { effectChain } from '@ledrums/core';
  import { enumLabel, formatParam, isTempoParam, paramColumns, paramSections, paramValue, sectionColumns, tempoBeats, tempoTogglePatch, type CardParam, type ParamValue } from './card-model';
  import { beatsLabel, type KitPlan } from '../strip-model';
  import OrderList from '../../../../../ui/OrderList.svelte';
  import HoopAngleRing from './HoopAngleRing.svelte';
  import SegmentedControl from '../../../../../ui/SegmentedControl.svelte';
  import SpacePointPicker from './SpacePointPicker.svelte';
  import SpaceMotionPreview from './SpaceMotionPreview.svelte';
  import ColorSwatch from '../../../../../ui/ColorSwatch.svelte';
  import PaletteEditor from './PaletteEditor.svelte';
  import type { PixelModel } from '@ledrums/core';

  interface Props {
    params: readonly CardParam[];
    values: Readonly<Record<string, ParamValue>> | undefined;
    /** Keys a control is driving (badged; still editable — the base value). */
    modulated?: ReadonlySet<string>;
    disabled?: boolean;
    /** Prefix for accessible names ("Strobe" → "Strobe Rate"). */
    labelPrefix?: string;
    onChange: (key: string, value: ParamValue) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
    /** MIDI-map registration for a param's control, or null when it can't be mapped. Only
        number params are offered: a mapped CC / OSC value scales into the param's range. */
    mapParam?: (param: CardParam) => MappableSpec | null;
    /** Several keys at once (`undefined` removes one). Given, a ms / Hz param gets a switch to
        beats; without it (a host that can't remove a key) the param stays in its unit. */
    onPatch?: (patch: Record<string, ParamValue | undefined>) => void;
    /** The choices for a param whose options are the kit's drums (`optionsFrom: 'drums'`). */
    drumOptions?: readonly { value: string; label: string }[];
    /** The kit in plan, for a point-in-space widget (null: the views show the bounds only). */
    kitPlan?: KitPlan | null;
    /** The kit's pixel model, for a live space-motion preview (null: no preview). */
    pixelModel?: PixelModel | null;
  }

  let {
    params,
    values,
    modulated,
    disabled = false,
    labelPrefix = '',
    onChange,
    onGestureStart,
    onGestureEnd,
    mapParam,
    onPatch,
    drumOptions = [],
    kitPlan = null,
    pixelModel = null,
  }: Props = $props();

  /** A number param's value, or its default from the list (it may have no row). */
  const valueOf = (key: string, fallback: number): number => {
    const v = values?.[key];
    if (typeof v === 'number') return v;
    const d = params.find((p) => p.key === key)?.default;
    return typeof d === 'number' ? d : fallback;
  };
  /** Several params at once: through onPatch when the host has it (one undo step), else one by one. */
  const patchAll = (patch: Record<string, ParamValue>) => {
    if (onPatch) onPatch(patch);
    else for (const [k, val] of Object.entries(patch)) onChange(k, val);
  };

  /** A 0..1 param a widget edits, read from the values (it may have no row — `partOf`). */
  const amount = (key: string): number => {
    const v = values?.[key];
    return typeof v === 'number' ? v : 0.5;
  };
  /** The kit's drums in a drum-order param's order: listed ids first, then the rest. */
  function orderedDrums(list: string): { id: string; label: string }[] {
    const drums = drumOptions.filter((d) => !d.value.startsWith('@')).map((d) => ({ id: d.value, label: d.label }));
    const ids = list.split(',').map((id) => id.trim()).filter(Boolean);
    const first = ids.map((id) => drums.find((d) => d.id === id)).filter((d): d is { id: string; label: string } => !!d);
    return [...first, ...drums.filter((d) => !ids.includes(d.id))];
  }

  // More than PARAM_ROWS_MAX rows: balanced columns, filled top to bottom, then left to right.
  const layout = $derived(paramColumns(params.length));
  // Sectioned params: headers, the sections packed into columns left to right.
  const sections = $derived(paramSections(params));
  // The last arrangement, kept while it fits so sections don't jump columns as rows come and go.
  let lastColumns: string[][] | null = null;
  const columns = $derived.by(() => {
    if (!sections) return [];
    const cols = sectionColumns(sections, lastColumns);
    lastColumns = cols.map((col) => col.map((sec) => sec.label));
    return cols;
  });

  /** What a typed value means: a percent is typed as shown (25 → 0.25); ms / beats read units. */
  const entryOf = (p: CardParam) => (p.percent ? { factor: 100, unit: '%' } : { unit: p.unit });

  const aria = (p: CardParam): string => (labelPrefix ? `${labelPrefix} ${p.aria ?? p.label}` : (p.aria ?? p.label));
  /** A row's height when it holds a shared place: the tallest of its alternatives (26px a row). */
  const slotHeight = (p: CardParam): string | undefined => (p.slotLines ? `${p.slotLines * 26}px` : undefined);
</script>

{#snippet labelOf(p: CardParam, unit: boolean)}
  <!-- A dimmed setting's ⓘ says first when it applies. -->
  {@const about = p.inactive ? `${p.inactive}.${p.info ? ` ${p.info}` : ''}` : p.info}
  <span class="label" title={p.unit ? `${p.label} (${p.unit})` : p.label}>{p.label}{#if p.unit && p.kind === 'number' && unit}<span class="unit">{p.unit}</span>{/if}{#if about}<Tooltip text={about} side="top"><span class="info" aria-label={`About ${p.aria ?? p.label}`}><Info size={11} aria-hidden="true" /></span></Tooltip>{/if}</span>
{/snippet}

{#snippet row(p: CardParam)}
  <!-- A setting that doesn't apply right now is dimmed and can't be touched; it keeps its place. -->
  {@const dis = disabled || !!p.inactive}
  {#if p.widget?.kind === 'space-point'}
    {@const [kx, ky, kz] = p.widget.keys}
    <!-- A point in the kit's space: two views to click, editing three params at once. -->
    <li class="widget" class:inactive={!!p.inactive} class:sub={p.sub} class:slotted={!!p.slotLines} style:min-height={slotHeight(p)}>
      {@render labelOf(p, false)}
      <SpacePointPicker
        plan={kitPlan}
        value={{ width: amount(kx), depth: amount(ky), height: amount(kz) }}
        disabled={dis}
        onChange={(next) => {
          const patch: Record<string, ParamValue> = {};
          if (next.width !== undefined) patch[kx] = next.width;
          if (next.depth !== undefined) patch[ky] = next.depth;
          if (next.height !== undefined) patch[kz] = next.height;
          if (onPatch) onPatch(patch);
          else for (const [k, val] of Object.entries(patch)) onChange(k, val);
        }}
        {onGestureStart}
        {onGestureEnd}
      />
    </li>
  {:else if p.widget?.kind === 'space-motion'}
    {@const [kh, ke] = p.widget.keys}
    <!-- Which way it flies, set on the kit with the effect running live. -->
    <li class="widget" class:inactive={!!p.inactive} class:sub={p.sub} class:slotted={!!p.slotLines} style:min-height={slotHeight(p)}>
      {@render labelOf(p, false)}
      <SpaceMotionPreview
        model={pixelModel}
        params={values}
        headingKey={kh}
        elevationKey={ke}
        disabled={dis}
        ariaLabel={aria(p)}
        onChange={(patch) => patchAll(patch)}
        {onGestureStart}
        {onGestureEnd}
      />
    </li>
  {:else if p.widget?.kind === 'drum-order'}
    <!-- The kit's drums as chips to drag into order, stored as comma-separated ids. -->
    <li class="widget" class:inactive={!!p.inactive} class:sub={p.sub} class:slotted={!!p.slotLines} style:min-height={slotHeight(p)}>
      {@render labelOf(p, false)}
      <OrderList
        items={orderedDrums(String(paramValue(p, values)))}
        disabled={dis}
        ariaLabel={aria(p)}
        onReorder={(ids) => onChange(p.key, ids.join(','))}
      />
    </li>
  {:else if p.widget?.kind === 'hoop-pick'}
    <!-- A button per hoop (Tim, 2026-10-05: "only 4 options … i don't like the slider"). -->
    {@const hoops = Math.max(1, Math.round(p.max ?? 1))}
    <li class="row pick" class:inactive={!!p.inactive} class:sub={p.sub} class:slotted={!!p.slotLines} style:min-height={slotHeight(p)}>
      {@render labelOf(p, false)}
      <span class="ctl">
        <SegmentedControl
          value={String(Math.min(hoops, Math.max(1, Math.round(Number(paramValue(p, values))))))}
          options={Array.from({ length: hoops }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
          disabled={dis}
          ariaLabel={aria(p)}
          onChange={(v) => onChange(p.key, Number(v))}
          class="hoops"
        />
      </span>
    </li>
  {:else if p.widget?.kind === 'hoop-angle'}
    <!-- The Start angle as the hoop seen from the throne — its dots the start hoop's pixels
         (ringCount; 36 when the host can't say). No number: a pixel is picked on the ring. -->
    <li class="widget" class:inactive={!!p.inactive} class:sub={p.sub} class:slotted={!!p.slotLines} style:min-height={slotHeight(p)}>
      {@render labelOf(p, false)}
      <span class="ringwrap">
        <HoopAngleRing
          count={p.ringCount ?? 36}
          value={Number(paramValue(p, values))}
          disabled={dis}
          ariaLabel={aria(p)}
          onChange={(deg) => onChange(p.key, deg)}
          {onGestureStart}
          {onGestureEnd}
        />
      </span>
    </li>
  {:else if p.widget?.kind === 'colour'}
    {@const [kh, ks, kb] = p.widget.keys}
    <!-- A colour, picked from the colour window — no sliders (Tim, 2026-10-07). -->
    <li class="row" class:inactive={!!p.inactive} class:sub={p.sub} class:slotted={!!p.slotLines} style:min-height={slotHeight(p)}>
      {@render labelOf(p, false)}
      <span class="ctl">
        <!-- One pick — the colour window open to closed — is one undo step. -->
        <ColorSwatch
          hue={valueOf(kh!, 0)}
          saturation={ks ? valueOf(ks, 1) : 1}
          brightness={kb ? valueOf(kb, 1) : 1}
          modulated={p.widget.keys.some((k) => modulated?.has(k))}
          disabled={dis}
          ariaLabel={aria(p)}
          onChange={(hsv) => {
            const patch: Record<string, ParamValue> = { [kh!]: Math.round(hsv.h) % 360 };
            if (ks) patch[ks] = Number(hsv.s.toFixed(2));
            if (kb) patch[kb] = Number(hsv.v.toFixed(2));
            patchAll(patch);
          }}
          onGestureStart={() => onGestureStart?.()}
          onGestureEnd={() => onGestureEnd?.()}
        />
      </span>
    </li>
  {:else if p.widget?.kind === 'palette'}
    <!-- Several colours in order, as colour boxes. -->
    <li class="widget" class:inactive={!!p.inactive} class:sub={p.sub} class:slotted={!!p.slotLines} style:min-height={slotHeight(p)}>
      {@render labelOf(p, false)}
      <PaletteEditor
        value={String(paramValue(p, values) || p.default)}
        disabled={dis}
        ariaLabel={aria(p)}
        onChange={(next) => onChange(p.key, next)}
        {onGestureStart}
        {onGestureEnd}
      />
    </li>
  {:else}
    {@render plainRow(p, dis)}
  {/if}
{/snippet}

{#snippet plainRow(p: CardParam, dis: boolean)}
  {@const v = paramValue(p, values)}
  {@const map = p.kind === 'number' ? (mapParam?.(p) ?? null) : null}
  {@const tempo = !!onPatch && isTempoParam(p)}
  {@const beats = tempo ? tempoBeats(p, values) : undefined}
  <li class="row" class:modulated={modulated?.has(p.key)} class:inactive={!!p.inactive} class:sub={p.sub} class:slotted={!!p.slotLines} style:min-height={slotHeight(p)}>
    {@render labelOf(p, !tempo)}
    <span class="ctl" {@attach map && mappable(map)}>
      {#if p.kind === 'enum'}
        <Select
          value={String(v)}
          options={p.optionsFrom === 'drums' ? [...drumOptions] : (p.options ?? []).map((o) => ({ value: o, label: enumLabel(o) }))}
          segment={false}
          disabled={dis}
          ariaLabel={aria(p)}
          onChange={(next) => onChange(p.key, next)}
          class="cardsel"
        />
      {:else if p.kind === 'color'}
        <ColorField
          value={typeof v === 'string' ? v : null}
          fallback={typeof p.default === 'string' ? p.default : '#ffffff'}
          clearable={false}
          disabled={dis}
          ariaLabel={aria(p)}
          onChange={(next) => onChange(p.key, next ?? p.default)}
          onGestureStart={() => onGestureStart?.()}
          onGestureEnd={() => onGestureEnd?.()}
        />
      {:else if beats !== undefined}
        <!-- In beats: a duration lasts this many, a rate runs one cycle per this many. -->
        <FaceParamControl
          kind="number"
          value={beats}
          display={beatsLabel(beats)}
          min={0}
          max={64}
          step={0.0625}
          disabled={dis}
          ariaLabel={`${aria(p)} beats`}
          entry={{ unit: 'beats' }}
          onChange={(next) => onChange(effectChain.tempoKey(p.key), next)}
          {onGestureStart}
          {onGestureEnd}
        />
      {:else}
        <FaceParamControl
          kind={p.kind}
          value={v}
          display={formatParam(p, v, { unit: false })}
          min={p.min}
          max={p.max}
          step={p.step}
          modulated={modulated?.has(p.key) ?? false}
          disabled={dis}
          ariaLabel={aria(p)}
          entry={entryOf(p)}
          onChange={(next) => onChange(p.key, next)}
          {onGestureStart}
          {onGestureEnd}
        />
      {/if}
      {#if tempo}
        <button
          type="button"
          class="utog"
          class:beats={beats !== undefined}
          disabled={dis}
          aria-label={`${aria(p)}: in ${beats !== undefined ? 'beats' : p.unit}. Switch to ${beats !== undefined ? p.unit : 'beats'}`}
          title={beats !== undefined
            ? `In beats — ${p.unit === 'Hz' ? 'one cycle per' : 'lasts'} this many, at the tempo. Click for ${p.unit}.`
            : `In ${p.unit}. Click to set it in beats, so it follows the tempo.`}
          onclick={(ev) => {
            ev.stopPropagation();
            onPatch?.(tempoTogglePatch(p, values));
          }}
        >{beats !== undefined ? 'beats' : p.unit}</button>
      {/if}
    </span>
  </li>
{/snippet}

{#if sections}
  <div class="sections">
    {#each columns as column, c (c)}
      <div class="scol">
        {#each column as section, i (i)}
          <section class="sec" aria-label={section.label || undefined}>
            {#if section.label}<h4 class="sectitle">{section.label}</h4>{/if}
            <ul class="rows">
              {#each section.params as p (p.key)}{@render row(p)}{/each}
            </ul>
          </section>
        {/each}
      </div>
    {/each}
  </div>
{:else if params.length}
  <ul class="rows" class:cols={layout.columns > 1} style:--param-rows={layout.rows}>
    {#each params as p (p.key)}{@render row(p)}{/each}
  </ul>
{/if}

<style>
  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* Landscape: rows go down a column to --param-rows, then the next column starts to the right. */
  .rows.cols {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(var(--param-rows), auto);
    grid-auto-columns: var(--param-col-w, 240px);
    align-content: start;
    column-gap: var(--space-4);
  }
  /* Sections: columns left to right, a hairline between them (as on the Splice face); short
     sections stack in one column. */
  .sections {
    display: flex;
    align-items: flex-start;
  }
  .scol {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-2);
    width: var(--param-col-w, 240px);
    min-width: 0;
  }
  .scol + .scol {
    margin-left: var(--space-2);
    padding-left: var(--space-4);
    box-shadow: inset 1px 0 0 var(--border-faint);
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .sectitle {
    display: flex;
    align-items: center;
    min-height: 20px;
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  /* A widget's row: its label above, the widget below, the column's full width. (Not `.block`:
     the styleguide's page styles own that name.) */
  .widget {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 0 4px;
  }
  .ringwrap {
    display: flex;
    justify-content: center;
  }
  /* The hoop buttons keep their label: it never gives way to them. */
  .row.pick .label {
    flex: none;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 26px;
  }
  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .unit {
    margin-left: var(--space-1);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--text-faint);
  }
  .info {
    display: inline-flex;
    margin-left: 4px;
    vertical-align: -1px;
    color: var(--text-faint);
  }
  /* A setting that doesn't apply in the current mode: in its place, greyed (its ⓘ says when). */
  .inactive > :global(:not(.label)) {
    opacity: 0.38;
  }
  .inactive > .label {
    color: var(--text-faint);
  }
  /* A shared place, sized for its tallest alternative: a short one sits at its top, not adrift. */
  .row.slotted {
    align-items: flex-start;
  }
  .row.slotted > .label,
  .row.slotted > .ctl {
    min-height: 26px;
    display: inline-flex;
    align-items: center;
  }
  /* A sub-row (a Random under what it varies): set in, a hairline joining it to its setting. */
  .sub {
    margin-left: 6px;
    padding-left: 8px;
    box-shadow: inset 1px 0 0 var(--border-faint);
  }
  .sub > .label {
    color: var(--text-faint);
  }
  .row.modulated .label {
    color: var(--role-modulation);
  }
  /* The control takes the row's spare width, so a slider's rail is as long as the row allows. */
  .ctl {
    display: inline-flex;
    justify-content: flex-end;
    flex: 1 1 auto;
    min-width: 0;
    max-width: 62%;
  }
  /* The unit switch: a quiet chip after the value — `ms` / `Hz`, or `beats` (accented). */
  .utog {
    flex: none;
    height: 16px;
    margin-left: 4px;
    padding: 0 5px;
    border: 0;
    border-radius: var(--radius-1);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--border-faint);
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    line-height: 16px;
    cursor: pointer;
  }
  .utog:hover {
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .utog.beats {
    color: var(--accent);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 50%, transparent);
  }
  .utog:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 2px var(--accent-soft);
  }
  .ctl :global(.hoops) {
    flex: 0 1 auto;
  }
  .ctl :global(.cardsel) {
    width: 128px;
  }
</style>
