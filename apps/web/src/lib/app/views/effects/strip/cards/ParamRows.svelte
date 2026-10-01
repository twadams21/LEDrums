<script lang="ts">
  /* A device's params on its card face: label left, control right, one row each. Numbers and
     booleans ride the compact face control (the node-face precedent — rail + drag field,
     gesture-bracketed, modulated badge); an enum is a Select, because a card has the width a
     node face lacked and a cycle chip hides the choices; a colour is a ColorField. */
  import FaceParamControl from '../../../../../ui/FaceParamControl.svelte';
  import Select from '../../../../../ui/Select.svelte';
  import ColorField from '../../../../../ui/ColorField.svelte';
  import GestureScope from './GestureScope.svelte';
  import Tooltip from '../../../../../ui/Tooltip.svelte';
  import Info from '@lucide/svelte/icons/info';
  import type { MappableSpec } from '../../../../../trigger-lab/map-api';
  import { mappable } from '../../../../map-mode/mappable.svelte';
  import { effectChain } from '@ledrums/core';
  import { enumLabel, formatParam, isTempoParam, paramColumns, paramValue, tempoBeats, tempoTogglePatch, type CardParam, type ParamValue } from './card-model';
  import { beatsLabel } from '../strip-model';

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
  }: Props = $props();

  // More than PARAM_ROWS_MAX rows: balanced columns, filled top to bottom, then left to right.
  const layout = $derived(paramColumns(params.length));

  /** What a typed value means: a percent is typed as shown (25 → 0.25); ms / beats read units. */
  const entryOf = (p: CardParam) => (p.percent ? { factor: 100, unit: '%' } : { unit: p.unit });

  const aria = (p: CardParam): string => (labelPrefix ? `${labelPrefix} ${p.label}` : p.label);
</script>

{#if params.length}
  <ul class="rows" class:cols={layout.columns > 1} style:--param-rows={layout.rows}>
    {#each params as p (p.key)}
      {@const v = paramValue(p, values)}
      {@const map = p.kind === 'number' ? (mapParam?.(p) ?? null) : null}
      {@const tempo = !!onPatch && isTempoParam(p)}
      {@const beats = tempo ? tempoBeats(p, values) : undefined}
      <li class="row" class:modulated={modulated?.has(p.key)}>
        <span class="label" title={p.unit ? `${p.label} (${p.unit})` : p.label}>{p.label}{#if p.unit && p.kind === 'number' && !tempo}<span class="unit">{p.unit}</span>{/if}{#if p.info}<Tooltip text={p.info} side="top"><span class="info" aria-label={`About ${p.label}`}><Info size={11} aria-hidden="true" /></span></Tooltip>{/if}</span>
        <span class="ctl" {@attach map && mappable(map)}>
          {#if p.kind === 'enum'}
            <Select
              value={String(v)}
              options={(p.options ?? []).map((o) => ({ value: o, label: enumLabel(o) }))}
              segment={false}
              {disabled}
              ariaLabel={aria(p)}
              onChange={(next) => onChange(p.key, next)}
              class="cardsel"
            />
          {:else if p.kind === 'color'}
            <GestureScope onGestureStart={() => onGestureStart?.()} onGestureEnd={() => onGestureEnd?.()}>
              <ColorField
                value={typeof v === 'string' ? v : null}
                fallback={typeof p.default === 'string' ? p.default : '#ffffff'}
                clearable={false}
                {disabled}
                ariaLabel={aria(p)}
                onChange={(next) => onChange(p.key, next ?? p.default)}
              />
            </GestureScope>
          {:else if beats !== undefined}
            <!-- In beats: a duration lasts this many, a rate runs one cycle per this many. -->
            <FaceParamControl
              kind="number"
              value={beats}
              display={beatsLabel(beats)}
              min={0}
              max={64}
              step={0.0625}
              {disabled}
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
              {disabled}
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
              {disabled}
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
    {/each}
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
  .ctl :global(.cardsel) {
    width: 128px;
  }
</style>
