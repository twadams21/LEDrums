<script lang="ts">
  /* Patch controller node — the Art-Net / sACN transport: protocol, host, port, interface,
     RGB order, FPS, broadcast/multicast, and sACN priority. Writes through store.setOutput.
     Offline-safe (controls disabled, rename still works). */
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
</script>

<OutputStatusPanel output={store.output} packetsPerSec={store.outputPacketsPerSec} port={out?.port} />
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
  <div class="tworow">
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
    <Field layout="row" label="Interface" hint="source NIC · blank = default">
      <CommitInput
        value={out.iface ?? ''}
        mono
        autofocus={false}
        allowEmpty
        placeholder="0.0.0.0"
        disabled={!project}
        ariaLabel="Source interface"
        onCommit={(v) => store.setOutput({ iface: v.trim() })}
      />
    </Field>
  </div>
  <div class="tworow">
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
  </div>
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
  .tworow {
    display: flex;
    gap: var(--space-3);
  }
  .tworow :global(.field) {
    flex: 1;
    min-width: 0;
  }
  .checkrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text);
  }
</style>
