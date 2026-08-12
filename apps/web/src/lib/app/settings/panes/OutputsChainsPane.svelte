<script lang="ts">
  /* Settings › Outputs & Chains (S4c) — routing without the canvas. One card per physical
     output (fixed port set: 8 logical expanded / 4 normal) holding its ordered hoop chain +
     transport scalars; below them the unassigned-hoops pool (the `hoop-uncovered` indicator)
     and the whole-kit Pixel Output Map, re-homed from PatchOutputInspector.

     Reads the AUTHORITATIVE routing (`store.project.kit.outputs` → `outputsToPatch`); every
     chain edit reduces to the next PatchRouting (chain-editor.ts), is checked by core's ONE
     routing-validation seam, and commits via `store.setRouting` — the same compile path the
     canvas used. A blocking issue toasts and leaves the routing untouched (unreachable via
     the pool model; backstop only). Viewer gating rides a natively-disabled fieldset. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { KitConfig, RgbOrder } from '@ledrums/core';
  import { outputsToPatch, patchToOutputs, pixelRanges, type HoopRef, type PatchRouting } from '../../patch-routing';
  import { buildPixelOutputTable, perHoopPixelCount } from '../../docks/patch-inspector';
  import { patchLabel } from '../../docks/inspectors/forms';
  import { hoopNodeId } from '../../patch-graph';
  import { drumZoneId } from '../../patch-zones';
  import { pushToast } from '../../../ui/toast.svelte';
  import { addHoop, chainBlockers, moveHoop, removeHoop, unassignedHoops } from './chain-editor';
  import OutputChainCard from './OutputChainCard.svelte';
  import UnassignedPool from './UnassignedPool.svelte';

  let { store }: { store: TriggerLab } = $props();

  const project = $derived(store.project);
  const kit = $derived<KitConfig | null>(project?.kit ?? null);
  const routing = $derived<PatchRouting | null>(kit ? outputsToPatch(kit.outputs) : null);
  const expanded = $derived(kit?.global.expanded ?? false);

  function pixelsForHoop(h: HoopRef): number {
    const d = kit?.drums.find((x) => x.id === h.drumId);
    return d && kit ? perHoopPixelCount(d, kit, h.hoop) : 0;
  }
  const ranges = $derived(routing ? pixelRanges(routing, pixelsForHoop) : null);
  const pool = $derived(kit && routing ? unassignedHoops(kit, routing) : []);
  const pixelTable = $derived(kit && routing ? buildPixelOutputTable(routing, kit, pixelsForHoop) : []);

  /** "Kick · Hoop 2" — drum + hoop display names, honouring rename overrides on the
      surviving `drum:<id>` / `hoop:<drumId>:<n>` node-id grammar. */
  function hoopLabel(h: HoopRef): string {
    const drum = kit?.drums.find((d) => d.id === h.drumId);
    const drumName = patchLabel(store, drumZoneId(h.drumId), drum?.label || h.drumId);
    return `${drumName} · ${patchLabel(store, hoopNodeId(h), `Hoop ${h.hoop}`)}`;
  }

  /** Reduce → validate (core seam) → setRouting. A blocking issue toasts instead of
      committing — the same message the server write-gate would refuse with. */
  function commitChains(next: PatchRouting): void {
    if (!kit) return;
    const blockers = chainBlockers(kit, next);
    if (blockers.length) {
      pushToast(blockers[0]!.message, { tone: 'error' });
      return;
    }
    store.setRouting(patchToOutputs(next));
  }

  /** Rebuild the outputs array with one port's transport scalars changed → setRouting —
      the PatchOutputInspector idiom, verbatim. Blank startUniverse clears the snap (dense);
      blank rgbOrder inherits the controller order. */
  function setOutputScalar(
    outputId: string,
    partial: { startUniverse?: number; channelsPerPixel?: number; rgbOrder?: RgbOrder },
  ): void {
    if (!kit) return;
    store.setRouting(kit.outputs.map((o) => (o.id === outputId ? { ...o, ...partial } : o)));
  }

  /** Device-facing universe/channel (both 1-based, PixLite Mk3 API v1.7); unwired = em-dash. */
  const fmtUni = (u: number | null): string => (u === null ? '—' : `${u + 1}`);
  const fmtCh = (u: number | null, ch: number): string => (u === null ? '—' : `${(ch % 512) + 1}`);
</script>

<fieldset class="pane-body" disabled={!store.canEdit}>
  <h3>Outputs &amp; Chains</h3>
  {#if kit && routing}
    <p class="grouphint">
      Each physical output drives one ordered chain of hoops — pixel transmit order, top to
      bottom. Remove a hoop and it returns to the pool below; an unrouted hoop is legal, it
      just stays dark.
    </p>
    <div class="cards">
      {#each routing.outputs as output, i (output.id)}
        <OutputChainCard
          {store}
          {output}
          index={i}
          {expanded}
          {pool}
          {hoopLabel}
          span={ranges?.byOutput[output.id]}
          disabled={!project}
          canEdit={store.canEdit}
          onScalar={(partial) => setOutputScalar(output.id, partial)}
          onAdd={(h) => routing && commitChains(addHoop(routing, output.id, h))}
          onRemove={(idx) => routing && commitChains(removeHoop(routing, output.id, idx))}
          onMove={(from, to) => routing && commitChains(moveHoop(routing, output.id, from, to))}
        />
      {/each}
    </div>

    <UnassignedPool {pool} {hoopLabel} />

    {#if pixelTable.length}
      <div class="pxtable">
        <span class="tbl-head">Pixel output map</span>
        <div class="tbl-row tbl-colhead">
          <span class="c-idx">#</span>
          <span class="c-num">Uni</span>
          <span class="c-num">Ch</span>
          <span class="c-num">Px</span>
        </div>
        {#each pixelTable as row (row.outputId)}
          <div class="tbl-row">
            <span class="c-idx">{row.index + 1}</span>
            <span class="c-num">{fmtUni(row.startUniverse)}</span>
            <span class="c-num">{fmtCh(row.startUniverse, row.startChannel)}</span>
            <span class="c-num">{row.pixelCount}</span>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="grouphint">Offline — reconnect to the rig to edit output chains.</p>
  {/if}
</fieldset>

<style>
  /* fieldset reset — it carries the read-only viewer gate but lays out like a plain column. */
  .pane-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    border: 0;
    min-inline-size: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .grouphint {
    margin: 0;
    max-width: 62ch;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: var(--space-3);
    align-items: start;
  }
  .pxtable {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-width: 22rem;
  }
  .tbl-head {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    margin-bottom: 2px;
  }
  .tbl-row {
    display: grid;
    grid-template-columns: 2.5em 1fr 1fr 1fr;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .tbl-colhead {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .c-idx {
    color: var(--text-faint);
  }
  .c-num {
    text-align: right;
  }
</style>
