<script lang="ts">
  /* PLACEHOLDER (ui-strip-chain) — the real Modifier card ships in `ui-strip-cards` and wins at merge. */
  import { tryGetModifier, type effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi, MASTER_CELL } from '../../../../../trigger-lab/effects-api';
  import DeviceCard from '../DeviceCard.svelte';
  let { api, effectId, modifier }: { api: EffectsAuthoringApi; effectId: string | typeof MASTER_CELL; modifier: effectChain.ModifierDevice } = $props();
  const label = $derived(tryGetModifier(modifier.modifierId)?.name ?? modifier.modifierId);
</script>

<DeviceCard title={label} tint="var(--role-effect)" width={200}
  power={{ on: !modifier.bypass, disabled: !api.canEdit, onChange: (on) => api.setModifierBypass(effectId, modifier.uid, !on) }}>
  <span class="ph">Mix {Math.round(modifier.mix * 100)}%</span>
</DeviceCard>

<style>
  .ph { color: var(--text-faint); font-size: var(--text-2xs); font-variant-numeric: tabular-nums; }
</style>
