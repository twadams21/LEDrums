<script lang="ts">
  /* Settings › Controller (S4d) — the box and its transport, re-homed from the retired
     Patch-graph controller inspector. Three sections: live status (OutputStatusPanel →
     ControllerStatusPanel with discover / adopt / auth / identify / test-pattern /
     back-to-live, reused wholesale), the Art-Net / sACN transport form (setOutput), and
     the controller-facing kit globals — expanded output mode, max px/output, mirror
     (setKitGlobal). Offline-safe (controls disabled); viewers get a natively-disabled
     fieldset, same treatment as the dock Inspector.

     Lifecycle (must-keep, per the S4a pane spec §2.4): watch-on-mount / unwatch-on-unmount
     is the ONLY thing gating the server's controller poll loop. SettingsModal renders just
     the active pane, so switching sections or closing the modal stops the poll. */
  import { onMount } from 'svelte';
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Select from '../../../ui/Select.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Separator from '../../../ui/Separator.svelte';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import OutputStatusPanel from '../../docks/inspectors/OutputStatusPanel.svelte';
  import { onNum } from '../../docks/inspectors/forms';
  import { PROTOCOL_OPTS } from '../../views/node-options';

  let { store }: { store: TriggerLab } = $props();

  const project = $derived(store.project);
  const out = $derived(project?.output ?? null);
  // Advatek expanded output mode (B2) — a kit-global, not a transport field: ON splits each of
  // the 4 physical ports into 2 data lines → 8 logical outputs.
  const expanded = $derived(project?.kit.global.expanded ?? false);
  const maxPixelsPerOutput = $derived(project?.kit.global.maxPixelsPerOutput ?? null);
  const mirror = $derived(project?.kit.global.mirror ?? 'none');

  // Interface options = the server's enumerated NICs (so the operator picks the adapter the
  // PixLite is plugged into) + a "Default (auto)" no-bind. A persisted iface that isn't among
  // the current machine's NICs (e.g. a project moved between machines) is preserved as a
  // "(manual)" entry so switching machines never silently drops it.
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

  const MIRROR_OPTS = [
    { value: 'none', label: 'None' },
    { value: 'x', label: 'X' },
    { value: 'y', label: 'Y' },
  ];

  // Subscribe to controller status while this pane is open — the ONLY thing that gates the
  // server's poll loop (no idle traffic). Watch on mount, un-watch on teardown; a link drop
  // clears it server-side. Also ask the server to enumerate its NICs so the subnet
  // recommendation + adapter picker have data.
  onMount(() => {
    store.watchController(true);
    store.requestNetworkAdapters();
    return () => store.watchController(false);
  });
</script>

<div class="pane-body">
  <h3>Controller</h3>
  <!-- Viewer (read-only) gate: native fieldset disables every nested form control; the store
       mutators already no-op for a viewer — this makes that visible. -->
  <fieldset class="editgate" disabled={!store.canEdit}>
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

    {#if out}
      <Separator />
      <Eyebrow>Transport</Eyebrow>
      <p class="grouphint">Where pixel data is sent.</p>
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

      <Separator />
      <Eyebrow>Kit globals</Eyebrow>
      <p class="grouphint">
        Advatek expanded output — on, each of the 4 physical ports drives 2 data lines (8 logical
        outputs); off, the 4 ports are the outputs.
      </p>
      <label class="checkrow">
        <Toggle
          pressed={expanded}
          disabled={!project}
          onChange={(v) => store.setKitGlobal({ expanded: v })}
          ariaLabel="Expanded output mode"
        />
        <span>Expanded output mode</span>
      </label>
      <Field layout="row" label="Max px / output" hint="per physical output">
        <CommitInput
          type="number"
          min={1}
          value={maxPixelsPerOutput ?? ''}
          disabled={!project}
          ariaLabel="Max pixels per output"
          onCommit={(v) => onNum(v, (n) => store.setKitGlobal({ maxPixelsPerOutput: n }))}
        />
      </Field>
      <Field layout="row" label="Mirror" hint="geometry-only world reflection">
        <SegmentedControl
          value={mirror}
          options={MIRROR_OPTS}
          disabled={!project}
          onChange={(v) => store.setKitGlobal({ mirror: v as 'none' | 'x' | 'y' })}
          ariaLabel="Kit mirror axis"
        />
      </Field>
    {/if}
  </fieldset>
</div>

<style>
  .pane-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .editgate {
    /* fieldset reset — it carries the read-only gate but must lay out like a plain column */
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  /* Read-only viewer: dim + stop drag-based controls (segmented) the native
     fieldset[disabled] can't reach (they're div/role-based, not form controls). */
  .editgate:disabled {
    opacity: 0.6;
  }
  .editgate:disabled :global(.seg) {
    pointer-events: none;
  }
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
