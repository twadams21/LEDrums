<script lang="ts">
  /* Patch controller node — the Art-Net / sACN transport: protocol, host, port, interface,
     RGB order, FPS, broadcast/multicast, and sACN priority. Writes through store.setOutput.
     Offline-safe (controls disabled, rename still works). */
  import { onMount } from 'svelte';
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { RgbOrder } from '@ledrums/core';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Select from '../../../ui/Select.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import RenameField from './RenameField.svelte';
  import Separator from '../../../ui/Separator.svelte';
  import OutputStatusPanel from './OutputStatusPanel.svelte';
  import { onNum } from './forms';
  import { PROTOCOL_OPTS, RGB_OPTS } from '../../views/node-options';

  let { store, nodeId, title }: { store: TriggerLab; nodeId: string; title: string } = $props();

  const project = $derived(store.project);
  const out = $derived(project?.output ?? null);

  // Interface options = the server's enumerated NICs (so the operator picks the adapter the PixLite
  // is plugged into) + a "Default (auto)" no-bind. A persisted iface that isn't among the current
  // machine's NICs (e.g. a project moved between machines) is preserved as a "(manual)" entry so
  // switching machines never silently drops it.
  // bits-ui Select renders the placeholder for value '' (it reads as "no selection"),
  // so "Default (auto)" carries a sentinel value mapped back to '' on write.
  const AUTO = 'auto';
  const ifaceOptions = $derived.by(() => {
    const opts = [{ value: AUTO, label: 'Default (auto)' }];
    for (const a of store.networkAdapters) opts.push({ value: a.address, label: `${a.name} · ${a.address}` });
    const cur = out?.iface ?? '';
    if (cur && !store.networkAdapters.some((a) => a.address === cur)) {
      opts.push({ value: cur, label: `${cur} (manual)` });
    }
    return opts;
  });

  // S48: subscribe to controller status while this panel is open — the ONLY thing that gates the
  // server's poll loop (no idle traffic). Watch on mount, un-watch on teardown; a link drop clears
  // it server-side. onMount's cleanup fires on unmount, so a closed panel stops the poll. Also ask
  // the server to enumerate its NICs so the subnet recommendation + adapter picker have data.
  onMount(() => {
    store.watchController(true);
    store.requestNetworkAdapters();
    return () => store.watchController(false);
  });
</script>

<OutputStatusPanel
  output={store.output}
  packetsPerSec={store.outputPacketsPerSec}
  port={out?.port}
  controller={store.controllerStatus}
  candidates={store.controllerCandidates}
  scanning={store.controllerScanning}
  takeover={store.controllerTakeover}
  recommendation={store.controllerRecommendation}
  canEdit={store.canEdit}
  onDiscover={() => store.discoverControllers()}
  onAdopt={(host) => store.adoptController(host)}
  onSetAuth={(password) => store.setControllerAuth(password)}
  onIdentify={() => store.identifyController()}
  onTestData={(pattern) => store.setControllerTestData(pattern)}
  onBackToLive={() => store.backToLive()}
/>
<Separator />

{#if out}
  <p class="grouphint">Art-Net / sACN transport — where the pixel stream is sent.</p>
  <Field layout="row" label="Protocol">
    <Select
      value={out.protocol}
      options={PROTOCOL_OPTS}
      disabled={!project}
      onChange={(v) => store.setOutput({ protocol: v as 'artnet' | 'sacn' })}
      ariaLabel="Protocol"
    />
  </Field>
  <Field layout="row" label="Host / IP" hint={out.broadcast ? 'broadcast / multicast target' : 'unicast target'}>
    <CommitInput
      value={out.host}
      mono
      autofocus={false}
      placeholder="255.255.255.255"
      disabled={!project}
      ariaLabel="Host / IP"
      onCommit={(v) => v.trim() && store.setOutput({ host: v.trim() })}
    />
  </Field>
  <Field layout="row" label="Port" hint={out.protocol === 'sacn' ? 'default 5568' : 'default 6454'}>
    <CommitInput
      type="number"
      min={1}
      max={65535}
      value={out.port ?? ''}
      placeholder={out.protocol === 'sacn' ? '5568' : '6454'}
      disabled={!project}
      ariaLabel="Output port"
      onCommit={(v) => onNum(v, (n) => store.setOutput({ port: n }))}
    />
  </Field>
  <Field layout="row" label="Interface" hint="the NIC the PixLite is on">
    <Select
      value={out.iface || AUTO}
      options={ifaceOptions}
      disabled={!project}
      onChange={(v) => store.setOutput({ iface: v === AUTO ? '' : v })}
      ariaLabel="Source interface (network adapter)"
    />
  </Field>
  <Field layout="row" label="RGB order">
    <Select
      value={out.rgbOrder}
      options={RGB_OPTS}
      disabled={!project}
      onChange={(v) => store.setOutput({ rgbOrder: v as RgbOrder })}
      ariaLabel="RGB order"
    />
  </Field>
  <Field layout="row" label="FPS" hint="≤ 120">
    <CommitInput
      type="number"
      min={1}
      max={120}
      value={out.fps}
      disabled={!project}
      suffix="fps"
      ariaLabel="Output FPS"
      onCommit={(v) => onNum(v, (n) => store.setOutput({ fps: n }))}
    />
  </Field>
  <label class="checkrow">
    <Toggle
      pressed={out.broadcast}
      disabled={!project}
      onChange={(v) => store.setOutput({ broadcast: v })}
      ariaLabel={out.protocol === 'sacn' ? 'Multicast' : 'Broadcast'}
    />
    <span>{out.protocol === 'sacn' ? 'Multicast' : 'Broadcast'}</span>
  </label>
  {#if out.protocol === 'sacn'}
    <Field layout="row" label="Priority" hint="1–200 · higher wins at a merge">
      <CommitInput
        type="number"
        min={1}
        max={200}
        value={out.priority}
        disabled={!project}
        ariaLabel="sACN priority"
        onCommit={(v) => onNum(v, (n) => store.setOutput({ priority: n }))}
      />
    </Field>
  {/if}
  <RenameField {store} {nodeId} fallback={title} />
{/if}

<style>
  .grouphint {
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
</style>
