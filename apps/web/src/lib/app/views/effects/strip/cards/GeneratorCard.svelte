<script lang="ts">
  /* PLACEHOLDER (ui-strip-chain) — the real Generator card ships in `ui-strip-cards` and wins at merge. */
  import { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../../trigger-lab/effects-api';
  import DeviceCard from '../DeviceCard.svelte';
  let { api, effect }: { api: EffectsAuthoringApi; effect: effectChain.Effect } = $props();
  const label = $derived(effectChain.getGeneratorDef(effect.generator.kind)?.label ?? effect.generator.kind);
</script>

<DeviceCard title={label} tint="var(--role-content)"><span class="ph" data-can-edit={api.canEdit}>{effect.generator.style || 'Default'}</span></DeviceCard>

<style>
  .ph { color: var(--text-faint); font-size: var(--text-2xs); }
</style>
