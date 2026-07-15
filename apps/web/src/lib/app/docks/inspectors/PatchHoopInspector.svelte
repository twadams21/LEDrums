<script lang="ts">
  /* Patch hoop node — this hoop's authoritative per-hoop pixel count + reverse flag
     (first-class hoops[], B4), a device Identify flash (E1), and the read-only first/last
     GLOBAL pixel span derived from the live patch routing. Edits write the single hoop via
     setHoopConfig; offline-safe. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { ShellStore } from '../../shell-store.svelte';
  import type { KitConfig } from '@ledrums/core';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import RenameField from './RenameField.svelte';
  import ReadRow from './ReadRow.svelte';
  import { onNum } from './forms';
  import { hoopPixelSpan, perHoopPixelCount, type PatchEditor } from '../patch-inspector';
  import { fmtSpan } from '../../views/node-options';
  import type { HoopRef } from '../../patch-routing';

  let { store, shell, editor, nodeId, title }: {
    store: TriggerLab;
    shell: ShellStore;
    editor: Extract<PatchEditor, { kind: 'hoop' }>;
    nodeId: string;
    title: string;
  } = $props();

  const project = $derived(store.project);
  const kit = $derived<KitConfig | null>(project?.kit ?? null);
  const drum = $derived(kit?.drums.find((x) => x.id === editor.drumId) ?? null);
  const liveRouting = $derived(shell.patchRouting);

  // This hoop's authoritative count: hoops[hoop-1].pixelCount (B4) when present, else the
  // drum's uniform density-derived fallback. `editor.hoop` is 1-based (A1).
  const pixelCount = $derived(drum && kit ? perHoopPixelCount(drum, kit, editor.hoop) : 0);
  const reverse = $derived(drum?.hoops?.[editor.hoop - 1]?.reverse ?? false);

  // Span walk honours per-hoop counts so a drum with mixed counts reads correctly.
  function pixelsForHoop(h: HoopRef): number {
    const d = kit?.drums.find((x) => x.id === h.drumId);
    return d && kit ? perHoopPixelCount(d, kit, h.hoop) : 0;
  }
  const span = $derived(
    drum && liveRouting ? hoopPixelSpan(liveRouting, { drumId: drum.id, hoop: editor.hoop }, pixelsForHoop) : null,
  );
</script>

{#if drum}
  <Field layout="row" label="Pixel count" hint="LEDs on this hoop">
    <CommitInput
      type="number"
      min={1}
      value={pixelCount}
      disabled={!project}
      suffix="px"
      ariaLabel="Pixel count for this hoop"
      onCommit={(v) => onNum(v, (n) => store.setHoopConfig(drum.id, editor.hoop, { pixelCount: n }))}
    />
  </Field>

  <label class="checkrow">
    <Toggle
      pressed={reverse}
      disabled={!project}
      onChange={(v) => store.setHoopConfig(drum.id, editor.hoop, { reverse: v })}
      ariaLabel="Reverse pixel direction on this hoop"
    />
    <span>Reverse</span>
  </label>
  <p class="hint">Reverses this hoop's pixel-0 direction — for a strip wired backwards.</p>

  <div class="actions">
    <button
      type="button"
      class="action"
      disabled={!store.canEdit}
      onclick={() => store.identifyHoop(drum.id, editor.hoop)}
    >
      <Lightbulb size={13} aria-hidden="true" /> Identify
    </button>
  </div>

  <ReadRow label="First / last pixel" value={fmtSpan(span)} />
  {#if !span}<p class="hint">Wire this hoop into a data line on the canvas to give it pixels.</p>{/if}
  <RenameField {store} {nodeId} fallback={title} />
{/if}

<style>
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  .checkrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text);
  }
  /* Identify — reuse the app's soft text-button vocabulary (cf. ControllerStatusPanel .action):
     inset surface, hairline border, instant hover, subtle scale-on-press for tactile feedback. */
  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 1;
    min-height: 30px;
    padding: var(--space-1) var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    font-size: var(--text-xs);
    color: var(--ink);
    cursor: pointer;
    transition:
      border-color var(--dur-120) ease,
      color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .action :global(svg) {
    flex: none;
    opacity: 0.8;
  }
  .action:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .action:active:not(:disabled) {
    scale: 0.96;
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
