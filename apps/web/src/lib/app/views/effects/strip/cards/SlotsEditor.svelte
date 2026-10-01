<script lang="ts">
  /* The Splice / Slice slots, on the Generator card: one row per band — a colour, a nested
     Generator, or both (the colour then tints the Generator), or neither (blank). As the graph
     Splice inspector's rows (`docks/inspectors/SpliceRows.svelte`) did, there are exactly Count
     rows: rows past the authored slots show what the cycling fallback renders there, and editing
     one materialises it. Add / remove keep Count in step. Every edit is one undo step. */
  import type { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../../trigger-lab/effects-api';
  import ColorField from '../../../../../ui/ColorField.svelte';
  import Select from '../../../../../ui/Select.svelte';
  import IconButton from '../../../../../ui/IconButton.svelte';
  import Tooltip from '../../../../../ui/Tooltip.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Power from '@lucide/svelte/icons/power';
  import GestureScope from './GestureScope.svelte';
  import ParamRows from './ParamRows.svelte';
  import { slotsAtCount, spliceCountOf } from './splice-face';
  import {
    SLOT_NO_GENERATOR,
    currentStyle,
    describeSlot,
    isBlankSlot,
    slotGeneratorOptions,
    styleOptions,
    type CardParam,
    type SpliceSlot,
  } from './card-model';

  interface Props {
    api: EffectsAuthoringApi;
    effect: effectChain.Effect;
  }

  let { api, effect }: Props = $props();

  const noun = $derived(effect.generator.kind === 'slice' ? 'Slice' : 'Splice');
  const authored = $derived(effect.generator.slots ?? []);
  const count = $derived(spliceCountOf(effect.generator.params));
  const slots = $derived(slotsAtCount(authored, count));
  const genOptions = slotGeneratorOptions();
  const disabled = $derived(!api.canEdit);

  /** A new slot gets the next colour of a spread palette, so it is visibly its own band. */
  const NEW_SLOT_COLOURS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#bf5af2', '#ffffff'];

  function write(next: SpliceSlot[]): void {
    api.setSpliceSlots(effect.id, next);
  }
  /** Slots and Count together, as one undo step. */
  function writeWithCount(next: SpliceSlot[]): void {
    api.beginGesture();
    api.setSpliceSlots(effect.id, next);
    api.setGeneratorParam(effect.id, 'count', next.length);
    api.endGesture();
  }
  function patch(index: number, change: Partial<SpliceSlot>): void {
    write(
      slots.map((s, i) => {
        if (i !== index) return s;
        const merged: SpliceSlot = { ...s, ...change };
        // Absent, not undefined, keeps the stored slot clean (and file round-trips exact).
        for (const k of Object.keys(merged) as (keyof SpliceSlot)[]) if (merged[k] === undefined) delete merged[k];
        return merged;
      }),
    );
  }
  /** A new row copies the last one (as the inspector did); the first gets a palette colour. */
  function add(): void {
    if (slots.length >= 64) return;
    const last = slots[slots.length - 1];
    const next = last && !isBlankSlot(last) ? (JSON.parse(JSON.stringify(last)) as SpliceSlot) : { color: NEW_SLOT_COLOURS[slots.length % NEW_SLOT_COLOURS.length]! };
    writeWithCount([...slots, next]);
  }
  function remove(index: number): void {
    if (slots.length <= 1) return;
    writeWithCount(slots.filter((_, i) => i !== index));
  }
  function setGenerator(index: number, kind: string): void {
    patch(index, { generator: kind === SLOT_NO_GENERATOR ? undefined : { kind: kind as effectChain.GeneratorKind, style: '', params: {} } });
  }
  function setStyle(index: number, style: string): void {
    const g = slots[index]?.generator;
    if (g) patch(index, { generator: { ...g, style, params: {} } });
  }

  const allBlank = $derived(slots.every(isBlankSlot));

  // Tint: how strongly a slot's colour recolours its Generator — shown once a row has both.
  const anyTinted = $derived(slots.some((s) => !s.muted && !!s.color && !!s.generator));
  const TINT: CardParam = { key: 'tint', label: 'Tint', kind: 'number', min: 0, max: 1, step: 0.01, default: 1, percent: true, unit: '%' };
</script>

<section class="slots" aria-label={`${noun}s`}>
  <div class="head">
    <span class="headlabel">{noun}s</span>
    <span class="count">{slots.length}</span>
    <IconButton icon={Plus} label={`Add ${noun.toLowerCase()}`} size={14} {disabled} onclick={add} />
  </div>


  <ol class="list">
    {#each slots as slot, i (i)}
      {@const styles = slot.generator ? styleOptions(slot.generator.kind) : []}
      <li class="slot" class:off={slot.muted}>
        <div class="slothead">
          <span class="idx">{i + 1}</span>
          <span class="desc" title={describeSlot(slot)}>{describeSlot(slot)}</span>
          <Tooltip text={slot.muted ? `Turn ${noun.toLowerCase()} ${i + 1} on` : `Turn ${noun.toLowerCase()} ${i + 1} off`}>
            <button
              type="button"
              class="pwr"
              class:on={!slot.muted}
              aria-pressed={!slot.muted}
              aria-label={`${noun} ${i + 1} on`}
              {disabled}
              onclick={() => patch(i, { muted: slot.muted ? undefined : true })}
            >
              <Power size={12} aria-hidden="true" />
            </button>
          </Tooltip>
          <IconButton
            icon={Trash2}
            label={`Remove ${noun.toLowerCase()} ${i + 1}`}
            size={13}
            disabled={disabled || slots.length <= 1}
            onclick={() => remove(i)}
          />
        </div>
        <!-- Colour and generator side by side, as the inspector's rows had them. -->
        <div class="body">
          <GestureScope onGestureStart={() => api.beginGesture()} onGestureEnd={() => api.endGesture()}>
            <ColorField
              value={slot.color ?? null}
              {disabled}
              ariaLabel={`${noun} ${i + 1} colour`}
              onChange={(v) => patch(i, { color: v ?? undefined })}
            />
          </GestureScope>
          <div class="gen">
            <Select
              value={slot.generator?.kind ?? SLOT_NO_GENERATOR}
              options={genOptions}
              segment={false}
              {disabled}
              ariaLabel={`${noun} ${i + 1} generator`}
              onChange={(v) => setGenerator(i, v)}
              class="slotsel"
            />
          </div>
        </div>
        {#if slot.generator && styles.length > 1}
          <div class="gen">
            <Select
              value={currentStyle(slot.generator)}
              options={styles}
              segment={false}
              {disabled}
              ariaLabel={`${noun} ${i + 1} style`}
              onChange={(v) => setStyle(i, v)}
            />
          </div>
        {/if}
      </li>
    {/each}
  </ol>

  {#if anyTinted}
    <ParamRows
      params={[TINT]}
      values={effect.generator.params}
      {disabled}
      labelPrefix={noun}
      onChange={(key, v) => api.setGeneratorParam(effect.id, key, v)}
      onGestureStart={() => api.beginGesture()}
      onGestureEnd={() => api.endGesture()}
    />
  {:else if allBlank}
    <!-- The one explanation that earns its space: the empty state, where nothing on screen says
         yet what a row is for. -->
    <p class="hint">Give a {noun.toLowerCase()} a colour, a generator, or both. With both, the colour tints the generator.</p>
  {/if}
</section>

<style>
  .slots {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-1_5);
  }
  .headlabel {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .count {
    flex: 1 1 auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .hint {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: var(--leading-snug);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .slot {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    padding: var(--space-1_5);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    box-shadow: inset 0 0 0 1px var(--border-faint);
  }
  .slot.off .desc {
    color: var(--text-disabled);
  }
  .slothead {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .idx {
    flex: none;
    min-width: 1.4em;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .desc {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .pwr {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    line-height: 0;
  }
  .pwr:hover {
    background: var(--surface-2);
    color: var(--ink);
  }
  .pwr.on {
    color: var(--role-content);
  }
  .pwr:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .pwr:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-ring);
  }
  .body {
    display: flex;
    align-items: center;
    gap: var(--space-1_5);
    min-width: 0;
  }
  /* The swatch (+ clear) only — the row's header already spells the colour out — and the
     generator takes the rest of the row. */
  .body :global(.colorfield) {
    flex: none;
    width: auto;
  }
  .body :global(.colorfield .hex) {
    display: none;
  }
  .body > .gen {
    flex: 1 1 0;
  }
  .body :global(.slotsel) {
    width: 100%;
    min-width: 0;
  }
  .gen {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
</style>
