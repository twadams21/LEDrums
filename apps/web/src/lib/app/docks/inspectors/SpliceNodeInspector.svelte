<script lang="ts">
  /* Splice-node editor. Three parts, in the order an author thinks about them:
       Cut  — how many splices, over what (hoop / drum / scope), how uneven.
       Move — chase (content hops splice to splice) or spin (the cut itself rotates), at a
              musical division or free milliseconds.
       Splices — one row each: a colour, an effect, or both (the colour then tints the
              effect), or neither (the splice is blank and you see through it).
     The shared node header (kind selector + remove) lives in the parent Inspector. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import { voice } from '@ledrums/core';
  import Field from '../../../ui/Field.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';
  import Slider from '../../../ui/Slider.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import ColorField from '../../../ui/ColorField.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { DIVISION_OPTS } from '../../views/node-options';
  import {
    SPLICE_CHASE_HINTS,
    SPLICE_CHASE_OPTS,
    SPLICE_MOTION_MODE_HINTS,
    SPLICE_MOTION_MODE_OPTS,
    SPLICE_OFFSET_MODE_OPTS,
    SPLICE_ORDER_OPTS,
    SPLICE_DIRECTION_OPTS,
    SPLICE_NO_EFFECT,
    SPLICE_PARTITION_OPTS,
    SPLICE_RATE_MODE_OPTS,
    describeSpliceRow,
    spliceEffectOptions,
    spliceRows,
    spliceUnitNoun,
  } from '../../views/splice-options';
  import { MODE_OPTS, SCOPE_OPTS } from '../../views/node-options';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const rows = $derived(spliceRows(node));
  const effectOpts = $derived(spliceEffectOptions(store.effects));
  const chase = $derived(node.spliceChase ?? 'off');
  const rateMode = $derived(node.spliceRateMode ?? 'beats');
  const jitter = $derived(node.spliceJitter ?? 0);
  const tint = $derived(node.spliceTint ?? 1);
  const anyTinted = $derived(rows.some((r) => r.color && r.effectId && !r.muted));
  const effectName = (id: string) => store.effects.find((e) => e.id === id)?.name ?? id;
  const partition = $derived(node.splicePartition ?? 'hoop');
  const offsetMode = $derived(node.spliceOffsetMode ?? 'beats');
  // The cascade offsets ACROSS units, so it means nothing when the whole scope is one unit.
  const canCascade = $derived(partition !== 'scope');
  const unitNoun = $derived(spliceUnitNoun(partition));
  const motionMode = $derived(node.spliceMotionMode ?? 'restart');

  /** Scope-target options, derived from the current scope — same shape the play inspector uses. */
  const targetOptions = $derived.by(() => {
    const infos = store.kitDrumInfos;
    if (node.scope === 'drum') return infos.map((d) => ({ value: d.id, label: d.label }));
    if (node.scope === 'hoop') {
      return infos.flatMap((d) =>
        Array.from({ length: d.hoopCount }, (_, i) => ({ value: `${d.id}#${i + 1}`, label: `${d.label} · Hoop ${i + 1}` })),
      );
    }
    return [];
  });
</script>

{#if node.kind === 'splice'}
  <div class="kindbody">
    <section class="group">
      <h4 class="grouptitle">Cut</h4>

      <Field label="On">
        <SegmentedControl
          value={node.scope}
          options={SCOPE_OPTS}
          onChange={(v) => store.setScope(node, v as 'kit' | 'drum' | 'hoop')}
          ariaLabel="Splice scope"
        />
      </Field>

      {#if node.scope !== 'kit'}
        <Field layout="row" label="Target">
          <Select
            value={node.targetId ?? ''}
            options={targetOptions}
            onChange={(v) => store.setTargetId(node, v || undefined)}
            placeholder="Auto (triggering drum)"
            ariaLabel="Splice scope target"
          />
        </Field>
      {/if}

      <Field layout="row" label="Splices">
        <CommitInput
          type="number"
          value={node.spliceCount ?? voice.DEFAULT_SPLICE_COUNT}
          min={voice.MIN_SPLICE_COUNT}
          max={voice.MAX_SPLICE_COUNT}
          step={1}
          onCommit={(v) => store.setSpliceCount(node, Number(v))}
          ariaLabel="Splice count"
        />
      </Field>

      <Field label="Per">
        <SegmentedControl
          value={node.splicePartition ?? 'hoop'}
          options={SPLICE_PARTITION_OPTS}
          onChange={(v) => store.setSpliceSetting(node, { splicePartition: v as voice.SplicePartition })}
          ariaLabel="Splice partition"
        />
      </Field>

      <Field layout="row" label="Random lengths">
        <Slider
          value={jitter}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => store.setSpliceSetting(node, { spliceJitter: v })}
          format={(v) => `${Math.round(v * 100)}%`}
          ariaLabel="Splice length jitter"
        />
      </Field>

      {#if jitter > 0}
        <Field layout="row" label="Seed">
          <CommitInput
            type="number"
            value={node.spliceSeed ?? 1}
            min={0}
            max={9999}
            step={1}
            onCommit={(v) => store.setSpliceSetting(node, { spliceSeed: Number(v) })}
            ariaLabel="Splice jitter seed"
          />
        </Field>
      {/if}
    </section>

    <section class="group">
      <h4 class="grouptitle">Move</h4>

      <Field label="Motion">
        <SegmentedControl
          value={chase}
          options={SPLICE_CHASE_OPTS}
          onChange={(v) => store.setSpliceSetting(node, { spliceChase: v as voice.SpliceChaseMode })}
          ariaLabel="Splice motion"
        />
      </Field>

      {#if chase !== 'off'}
        <Field label="On each hit">
          <SegmentedControl
            value={motionMode}
            options={SPLICE_MOTION_MODE_OPTS}
            onChange={(v) => store.setSpliceSetting(node, { spliceMotionMode: v as voice.SpliceMotionMode })}
            ariaLabel="Splice motion mode"
          />
        </Field>
        <p class="hint">{SPLICE_MOTION_MODE_HINTS[motionMode]}</p>

        <Field label="Rate">
          <SegmentedControl
            value={rateMode}
            options={SPLICE_RATE_MODE_OPTS}
            onChange={(v) => store.setSpliceSetting(node, { spliceRateMode: v as 'beats' | 'time' })}
            ariaLabel="Splice rate mode"
          />
        </Field>

        {#if rateMode === 'beats'}
          <Field layout="row" label="Division">
            <Select
              value={node.spliceDivision ?? voice.DEFAULT_SPLICE_DIVISION}
              options={DIVISION_OPTS}
              onChange={(v) => store.setSpliceSetting(node, { spliceDivision: v })}
              ariaLabel="Splice division"
            />
          </Field>
        {:else}
          <Field layout="row" label="Time" unit="ms">
            <CommitInput
              type="number"
              value={node.spliceRateMs ?? voice.DEFAULT_SPLICE_RATE_MS}
              min={10}
              max={60000}
              step={1}
              onCommit={(v) => store.setSpliceSetting(node, { spliceRateMs: Number(v) })}
              ariaLabel="Splice rate milliseconds"
            />
          </Field>
        {/if}

        {#if chase === 'stagger'}
          <Field layout="row" label="Increment" unit="px">
            <CommitInput
              type="number"
              value={node.spliceIncrementPx ?? voice.DEFAULT_SPLICE_INCREMENT_PX}
              min={0}
              max={voice.MAX_SPLICE_INCREMENT_PX}
              step={1}
              onCommit={(v) => store.setSpliceSetting(node, { spliceIncrementPx: Number(v) })}
              ariaLabel="Splice stagger increment"
            />
          </Field>
        {/if}

        <Field label="Direction">
          <SegmentedControl
            value={String(node.spliceDirection ?? 1)}
            options={SPLICE_DIRECTION_OPTS}
            onChange={(v) => store.setSpliceSetting(node, { spliceDirection: v === '-1' ? -1 : 1 })}
            ariaLabel="Splice direction"
          />
        </Field>

        {#if canCascade}
          <Field layout="row" label="{unitNoun} offset">
            <SegmentedControl
              value={offsetMode}
              options={SPLICE_OFFSET_MODE_OPTS}
              onChange={(v) => store.setSpliceSetting(node, { spliceOffsetMode: v as 'beats' | 'time' })}
              ariaLabel="{unitNoun} offset mode"
            />
          </Field>

          {#if offsetMode === 'beats'}
            <Field layout="row" label="Division">
              <Select
                value={node.spliceOffsetDivision ?? ''}
                options={[{ value: '', label: 'None (together)' }, ...DIVISION_OPTS]}
                onChange={(v) => store.setSpliceSetting(node, { spliceOffsetDivision: v || undefined })}
                ariaLabel="{unitNoun} offset division"
              />
            </Field>
          {:else}
            <Field layout="row" label="Time" unit="ms">
              <CommitInput
                type="number"
                value={node.spliceOffsetMs ?? 0}
                min={0}
                max={60000}
                step={1}
                onCommit={(v) => store.setSpliceSetting(node, { spliceOffsetMs: Number(v) })}
                ariaLabel="{unitNoun} offset milliseconds"
              />
            </Field>
          {/if}

          <!-- A Select, not a 4-up SegmentedControl: "Outside in" overflows the panel's control
               column by 15px, and the set is likely to grow. -->
          <Field layout="row" label="{unitNoun} order">
            <Select
              value={node.spliceOrder ?? 'up'}
              options={SPLICE_ORDER_OPTS}
              onChange={(v) => store.setSpliceSetting(node, { spliceOrder: v as voice.SpliceOrder })}
              ariaLabel="{unitNoun} order"
            />
          </Field>
        {/if}

        <p class="hint">{SPLICE_CHASE_HINTS[chase]}</p>
        {#if canCascade}
          <p class="hint">
            An offset starts each {unitNoun.toLowerCase()} later than the one before it, in the order above —
            so the motion travels {partition === 'drum' ? 'across the kit' : 'up the drum'} instead of every
            {unitNoun.toLowerCase()} moving together. A {unitNoun.toLowerCase()} waiting its turn holds still rather than going dark.
          </p>
        {/if}
      {/if}
    </section>

    <section class="group">
      <h4 class="grouptitle">Hold</h4>

      <Field layout="row" label="Play">
        <SegmentedControl
          value={node.mode}
          options={MODE_OPTS}
          onChange={(v) => store.setMode(node, v as 'oneshot' | 'loop' | 'hold')}
          ariaLabel="Splice play mode"
        />
      </Field>

      <Field layout="row" label="Attack" unit="ms">
        <CommitInput
          type="number"
          value={node.spliceAttackMs ?? voice.DEFAULT_SPLICE_ATTACK_MS}
          min={0}
          max={voice.MAX_SPLICE_ENVELOPE_MS}
          step={1}
          onCommit={(v) => store.setSpliceSetting(node, { spliceAttackMs: Number(v) })}
          ariaLabel="Splice attack milliseconds"
        />
      </Field>

      <Field layout="row" label="Hold" unit="ms">
        <CommitInput
          type="number"
          value={node.spliceHoldMs ?? voice.DEFAULT_SPLICE_HOLD_MS}
          min={0}
          max={voice.MAX_SPLICE_ENVELOPE_MS}
          step={10}
          onCommit={(v) => store.setSpliceSetting(node, { spliceHoldMs: Number(v) })}
          ariaLabel="Splice hold milliseconds"
        />
      </Field>

      <Field layout="row" label="Fade" unit="ms">
        <CommitInput
          type="number"
          value={node.spliceReleaseMs ?? voice.DEFAULT_SPLICE_RELEASE_MS}
          min={0}
          max={voice.MAX_SPLICE_ENVELOPE_MS}
          step={10}
          onCommit={(v) => store.setSpliceSetting(node, { spliceReleaseMs: Number(v) })}
          ariaLabel="Splice fade milliseconds"
        />
      </Field>

      <p class="hint">
        How long the lights stay up after a hit: rise, hold at full, then fade. A One-shot runs the
        whole shape; Loop and Hold stay up until the voice is stopped.
      </p>
    </section>

    <section class="group">
      <div class="grouphead">
        <h4 class="grouptitle">Splices</h4>
        <IconButton
          icon={Plus}
          label="Add splice"
          variant="soft"
          size={14}
          onclick={() => store.addSplice(node)}
        />
      </div>

      <ul class="rows">
        {#each rows as row (row.index)}
          <li class="row" class:blank={row.blank}>
            <div class="rowhead">
              <span class="idx">{row.index + 1}</span>
              <span class="rowdesc">{describeSpliceRow(row, effectName)}</span>
              <span class="rowactions">
                <Toggle
                  pressed={!row.muted}
                  onChange={(on) => store.setSpliceAt(node, row.index, { muted: !on })}
                  ariaLabel="Splice {row.index + 1} on"
                />
                <IconButton
                  icon={Trash2}
                  label="Remove splice {row.index + 1}"
                  variant="soft"
                  size={13}
                  disabled={rows.length <= 1}
                  onclick={() => store.removeSplice(node, row.index)}
                />
              </span>
            </div>

            <div class="rowbody">
              <ColorField
                value={row.color}
                onChange={(v) => store.setSpliceAt(node, row.index, { color: v })}
                ariaLabel="Splice {row.index + 1} colour"
              />
              <Select
                value={row.effectId ?? SPLICE_NO_EFFECT}
                options={effectOpts}
                onChange={(v) => store.setSpliceAt(node, row.index, { effectId: v === SPLICE_NO_EFFECT ? undefined : v })}
                ariaLabel="Splice {row.index + 1} effect"
              />
            </div>
          </li>
        {/each}
      </ul>

      {#if anyTinted}
        <Field layout="row" label="Tint">
          <Slider
            value={tint}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => store.setSpliceSetting(node, { spliceTint: v })}
            format={(v) => `${Math.round(v * 100)}%`}
            ariaLabel="Splice tint amount"
          />
        </Field>
        <p class="hint">How strongly a splice's colour recolours the effect inside it. A splice with no colour is never tinted.</p>
      {:else}
        <p class="hint">Give a splice a colour, an effect, or both — with both, the colour tints the effect. With neither, it stays blank.</p>
      {/if}
    </section>
  </div>
{/if}

<style>
  .kindbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-3);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .grouphead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .grouptitle {
    margin: 0;
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-2);
    background: var(--surface-raised);
    box-shadow: inset 0 0 0 1px var(--border-faint);
  }
  /* A blank splice renders nothing on the kit — say so quietly rather than hiding the row. */
  .row.blank .rowdesc {
    opacity: 0.6;
    font-style: italic;
  }
  .rowhead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .idx {
    flex: none;
    min-width: 1.4em;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .rowdesc {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rowactions {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  /* One control per line: at the inspector's real width a colour well + a full effect
     name side by side truncates both (the hex reads "#F…" and the effect name wraps). */
  .rowbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
</style>
