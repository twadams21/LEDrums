<script lang="ts">
  /* A device's params on its card face: label left, control right, one row each. Numbers and
     booleans ride the compact face control (the node-face precedent — rail + drag field,
     gesture-bracketed, modulated badge); an enum is a Select, because a card has the width a
     node face lacked and a cycle chip hides the choices; a colour is a ColorField. */
  import FaceParamControl from '../../../../../ui/FaceParamControl.svelte';
  import Select from '../../../../../ui/Select.svelte';
  import ColorField from '../../../../../ui/ColorField.svelte';
  import GestureScope from './GestureScope.svelte';
  import { enumLabel, formatParam, paramValue, type CardParam, type ParamValue } from './card-model';

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
  }: Props = $props();

  const aria = (p: CardParam): string => (labelPrefix ? `${labelPrefix} ${p.label}` : p.label);
</script>

{#if params.length}
  <ul class="rows">
    {#each params as p (p.key)}
      {@const v = paramValue(p, values)}
      <li class="row" class:modulated={modulated?.has(p.key)}>
        <span class="label" title={p.label}>{p.label}</span>
        <span class="ctl">
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
          {:else}
            <FaceParamControl
              kind={p.kind}
              value={v}
              display={formatParam(p, v)}
              min={p.min}
              max={p.max}
              step={p.step}
              modulated={modulated?.has(p.key) ?? false}
              {disabled}
              ariaLabel={aria(p)}
              onChange={(next) => onChange(p.key, next)}
              {onGestureStart}
              {onGestureEnd}
            />
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
  .row.modulated .label {
    color: var(--role-modulation);
  }
  .ctl {
    display: inline-flex;
    justify-content: flex-end;
    flex: none;
    max-width: 62%;
  }
  .ctl :global(.cardsel) {
    width: 128px;
  }
</style>
