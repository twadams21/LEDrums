<script lang="ts">
  /* PLACEHOLDER (ui-strip-chain) — the real Control card ships in `ui-strip-cards` and wins at merge. */
  import type { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../../trigger-lab/effects-api';
  import DeviceCard from '../DeviceCard.svelte';
  let { api, effect, control }: { api: EffectsAuthoringApi; effect: effectChain.Effect; control: effectChain.ControlDevice } = $props();
</script>

<DeviceCard title={control.kind.toUpperCase()} tint="var(--role-mod)" width={200}>
  <span class="ph" data-effect={effect.id} data-can-edit={api.canEdit}>{control.mappings.length} mappings</span>
</DeviceCard>

<style>
  .ph { color: var(--text-faint); font-size: var(--text-2xs); font-variant-numeric: tabular-nums; }
</style>
