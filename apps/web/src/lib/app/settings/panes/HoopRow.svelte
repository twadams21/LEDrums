<script lang="ts">
  /* One hoop row in the Drums & Hoops pane's per-drum grid: name (rename on the
     `hoop:<drumId>:<n>` id) · pixel count + reverse (setHoopConfig) · Identify flash
     (identifyHoop, drives real hardware) · first/last global pixel span. Re-homes
     PatchHoopInspector; the parent grid supplies the column template (root is
     display:contents so the cells align across rows). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { DrumConfig, KitConfig } from '@ledrums/core';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import { commitLabel, onNum, patchLabel } from '../../docks/inspectors/forms';
  import { perHoopPixelCount } from '../../docks/patch-inspector';
  import { hoopNodeId } from '../../patch-graph';
  import type { PixelSpan } from '../../patch-routing';
  import { fmtSpan } from '../../views/node-options';

  let { store, drum, kit, hoop, span }: {
    store: TriggerLab;
    drum: DrumConfig;
    kit: KitConfig;
    /** 1-based hoop index (A1). */
    hoop: number;
    /** First/last GLOBAL pixel span, null when the hoop is in no output chain. */
    span: PixelSpan | null;
  } = $props();

  const project = $derived(store.project);
  const nodeId = $derived(hoopNodeId({ drumId: drum.id, hoop }));
  const fallback = $derived(`Hoop ${hoop}`);
  const pixelCount = $derived(perHoopPixelCount(drum, kit, hoop));
  const reverse = $derived(drum.hoops?.[hoop - 1]?.reverse ?? false);
</script>

<div class="hooprow">
  <span class="name">
    <CommitInput
      value={patchLabel(store, nodeId, fallback)}
      autofocus={false}
      allowEmpty
      placeholder={fallback}
      ariaLabel={`Hoop ${hoop} name`}
      onCommit={(v) => commitLabel(store, nodeId, fallback, v)}
    />
  </span>
  <span class="px">
    <CommitInput
      type="number"
      min={1}
      value={pixelCount}
      disabled={!project}
      suffix="px"
      ariaLabel={`Pixel count for hoop ${hoop}`}
      onCommit={(v) => onNum(v, (n) => store.setHoopConfig(drum.id, hoop, { pixelCount: n }))}
    />
  </span>
  <span class="cell">
    <Toggle
      pressed={reverse}
      disabled={!project}
      ariaLabel={`Reverse pixel direction on hoop ${hoop}`}
      onChange={(v) => store.setHoopConfig(drum.id, hoop, { reverse: v })}
    />
  </span>
  <span class="cell">
    <IconButton
      icon={Lightbulb}
      label="Identify on rig"
      variant="soft"
      size={14}
      disabled={!store.canEdit}
      onclick={() => store.identifyHoop(drum.id, hoop)}
    />
  </span>
  <span class="span" class:unrouted={!span}>{span ? fmtSpan(span) : 'unrouted'}</span>
</div>

<style>
  .hooprow {
    display: contents;
  }
  .name,
  .px,
  .cell {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .name :global(.ci),
  .px :global(.ci) {
    flex: 1;
    min-width: 0;
  }
  .span {
    align-self: center;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    text-align: right;
    white-space: nowrap;
  }
  .span.unrouted {
    color: var(--text-faint);
    font-family: inherit;
  }
</style>
