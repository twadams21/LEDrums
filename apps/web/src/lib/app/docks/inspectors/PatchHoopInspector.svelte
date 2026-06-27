<script lang="ts">
  /* Patch hoop node — its literal pixel count (shared by every hoop on the drum) and the
     read-only first/last GLOBAL pixel span, derived from the live patch routing. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { ShellStore } from '../../shell-store.svelte';
  import type { KitConfig } from '@ledrums/core';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import RenameField from './RenameField.svelte';
  import ReadRow from './ReadRow.svelte';
  import { onNum } from './forms';
  import { hoopPixelSpan, pixelsPerHoopForDrum, type PatchEditor } from '../patch-inspector';
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

  function pixelsForHoop(h: HoopRef): number {
    const d = kit?.drums.find((x) => x.id === h.drumId);
    return d && kit ? pixelsPerHoopForDrum(d, kit) : 0;
  }
  const span = $derived(
    drum && liveRouting ? hoopPixelSpan(liveRouting, { drumId: drum.id, hoop: editor.hoop }, pixelsForHoop) : null,
  );
</script>

{#if drum}
  <Field label="Pixels per hoop" hint="literal count · applies to every hoop on this drum">
    <CommitInput
      type="number"
      min={1}
      value={pixelsForHoop({ drumId: drum.id, hoop: editor.hoop })}
      disabled={!project}
      suffix="px"
      ariaLabel="Pixels per hoop"
      onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { pixelsPerHoop: n }))}
    />
  </Field>
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
</style>
