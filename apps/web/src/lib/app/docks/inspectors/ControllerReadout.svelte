<script lang="ts">
  /* The adopted controller's own numbers: identity (name / model / firmware / IP), then the live
     health block (frame rates, temperature, bank voltage, ethernet links), then per-universe rx.

     This is the "is the box actually HEARING us?" evidence, and it is the one part of the panel
     with no actions at all — every row is read-only. Split out of ControllerStatusPanel (INIT-09
     S7); the value formatters travel with it, since nothing else in the panel calls them. */
  import type { ControllerStatus } from '../../../ws/protocol-types';
  import ReadRow from './ReadRow.svelte';
  import UniverseRxTable from './UniverseRxTable.svelte';
  import { formatTempC, formatFrameRate, formatBankVolts, formatEthLinks } from './output-status';

  let { controller }: { controller: ControllerStatus } = $props();
</script>

<div class="readrows">
  <ReadRow label="Name" value={controller.identity?.nickname || '—'} />
  <ReadRow label="Model" value={controller.identity?.prodName || '—'} />
  <ReadRow label="Firmware" value={controller.identity?.fwVer || '—'} />
  <ReadRow label="IP" value={controller.host} />
</div>

<div class="readrows">
  <ReadRow label="In / Out" value={`${formatFrameRate(controller.rates.inFrmRate)} · ${formatFrameRate(controller.rates.outFrmRate)}`} />
  <ReadRow label="Temp" value={formatTempC(controller.health.tempC)} />
  <ReadRow label="Voltage" value={formatBankVolts(controller.health.bankVoltsMv)} />
  <ReadRow label="Eth link" value={formatEthLinks(controller.health.ethLinkUp)} />
</div>

<UniverseRxTable universes={controller.universes} />

<style>
  .readrows {
    display: flex;
    flex-direction: column;
  }
</style>
