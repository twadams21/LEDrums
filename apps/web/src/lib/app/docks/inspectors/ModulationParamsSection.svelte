<script lang="ts">
  /* Target-side modulation editor (doc 10, S34) — the "Parameters" section shared by the play +
     modifier inspectors. Exposes a node's numeric params as modulation-target ROWS (each renders
     a scoped input handle on the node face), lists the incoming wires under each row, and edits
     every mapping's depth / invert / range TARGET-SIDE (LOCKED: never on the source). Removing an
     exposed param confirms first, then deletes its wires. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import { kindLabel } from '../../views/trigger-node-meta';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import Select from '../../../ui/Select.svelte';
  import Slider from '../../../ui/Slider.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import X from '@lucide/svelte/icons/x';
  import Unplug from '@lucide/svelte/icons/unplug';
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const rows = $derived(store.modInputsOf(node));
  const specs = $derived(store.modTargetSpecs(node));
  const available = $derived(store.availableModParams(node));
  const addOptions = $derived(available.map((p) => ({ value: p.key, label: p.label })));

  const labelFor = (key: string): string => specs.find((s) => s.key === key)?.label ?? key;
  const sourceLabel = (fromId: string): string => {
    const src = store.selectedGraph?.nodes.find((n) => n.id === fromId);
    return src ? kindLabel[src.kind] : 'source';
  };

  const pct = (v: number): string => `${Math.round(v * 100)}%`;

  /** Add picker: Select fires onChange with the chosen key, then resets to placeholder. */
  let addValue = $state('');
  function onAdd(key: string): void {
    if (key) store.addModInput(node, key);
    addValue = '';
  }

  // Remove-exposure guard: a param with live wires confirms before deleting them.
  let confirming = $state<string | null>(null);
  function onRemove(param: string): void {
    if (store.mappingsFor(node, param).length > 0) confirming = param;
    else store.removeModInput(node, param);
  }
  function confirmRemove(param: string): void {
    store.removeModInput(node, param);
    confirming = null;
  }
</script>

<div class="modparams">
  <div class="head">
    <Eyebrow>Parameters</Eyebrow>
    <span class="grow"></span>
    <Select
      value={addValue}
      options={addOptions}
      onChange={onAdd}
      placeholder="Add parameter…"
      disabled={addOptions.length === 0}
      ariaLabel="Add a modulation parameter"
      class="addsel"
    />
  </div>

  {#if rows.length === 0}
    <p class="hint">Expose a numeric parameter to modulate it — each becomes a handle on the node you can wire a source (envelope) into.</p>
  {/if}

  {#each rows as row (row.param)}
    {@const maps = store.mappingsFor(node, row.param)}
    {@const spec = specs.find((s) => s.key === row.param)}
    <div class="paramrow">
      <div class="rowhead">
        <span class="pname">{labelFor(row.param)}</span>
        <span class="count">{maps.length} {maps.length === 1 ? 'wire' : 'wires'}</span>
        <IconButton icon={X} label={`Remove ${labelFor(row.param)} parameter`} variant="ghost" size={13} onclick={() => onRemove(row.param)} />
      </div>

      {#if confirming === row.param}
        <div class="confirm" role="alert">
          <span>Delete {maps.length} {maps.length === 1 ? 'wire' : 'wires'}?</span>
          <button class="danger" type="button" onclick={() => confirmRemove(row.param)}>Remove</button>
          <button class="cancel" type="button" onclick={() => (confirming = null)}>Keep</button>
        </div>
      {/if}

      {#if maps.length === 0}
        <p class="empty">No wires yet — drag from a modulation source into this row's handle.</p>
      {/if}

      {#each maps as m (m.id)}
        <div class="mapping">
          <div class="maphead">
            <span class="src">{sourceLabel(m.from)}</span>
            <span class="grow"></span>
            <IconButton
              icon={ArrowUpDown}
              label={m.invert === true ? 'Invert (on)' : 'Invert'}
              variant={m.invert === true ? 'solid' : 'ghost'}
              size={13}
              onclick={() => store.setMappingInvert(m.id, !(m.invert === true))}
            />
            <IconButton icon={Unplug} label="Disconnect wire" variant="ghost" size={13} onclick={() => store.disconnect(m.id)} />
          </div>
          <div class="amt">
            <span class="mk">Depth</span>
            <Slider value={m.amount ?? 1} min={0} max={1} step={0.01} format={pct} onChange={(v) => store.setMappingAmount(m.id, v)} ariaLabel="Modulation depth" />
          </div>
          <div class="range">
            <span class="mk">Range</span>
            <CommitInput type="number" value={m.rangeMin ?? spec?.min ?? 0} step={spec ? undefined : 0.01} onCommit={(v) => store.setMappingRange(m.id, Number(v), m.rangeMax ?? spec?.max ?? 1)} ariaLabel="Range minimum" />
            <span class="dash">–</span>
            <CommitInput type="number" value={m.rangeMax ?? spec?.max ?? 1} step={spec ? undefined : 0.01} onCommit={(v) => store.setMappingRange(m.id, m.rangeMin ?? spec?.min ?? 0, Number(v))} ariaLabel="Range maximum" />
          </div>
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .modparams {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-top: 1px solid var(--border-faint);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .grow {
    flex: 1;
  }
  .head :global(.addsel) {
    flex: none;
    min-width: 148px;
  }
  .hint,
  .empty {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
  .paramrow {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
  }
  .rowhead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .pname {
    font-size: var(--text-xs);
    color: var(--ink);
    font-weight: 600;
  }
  .count {
    flex: 1;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .confirm {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .confirm .danger {
    color: var(--warn);
    background: transparent;
    border: none;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .confirm .cancel {
    color: var(--text-faint);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .mapping {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1_5);
    border-radius: var(--radius-1);
    border-left: 2px solid var(--role-modulation);
    background: color-mix(in oklch, var(--role-modulation) 6%, transparent);
  }
  .maphead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .src {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--role-modulation);
  }
  .amt,
  .range {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .mk {
    width: 44px;
    flex: none;
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .amt :global(.slider) {
    flex: 1;
  }
  .range :global(input) {
    width: 100%;
    min-width: 0;
  }
  .dash {
    color: var(--text-faint);
  }
</style>
