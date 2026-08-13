<script lang="ts">
  /* Settings › Controller (S4d) — the box and its transport, re-homed from the retired
     Patch-graph controller inspector. Two sections: live status (OutputStatusPanel →
     ControllerStatusPanel with discover / adopt / auth / identify / test-pattern /
     back-to-live, reused wholesale) and the Art-Net / sACN transport form (setOutput).
     The kit globals that used to trail this pane moved to the panes that show their
     effect — expanded / max px per output to Outputs & Chains (they define that pane's
     output cards), mirror to Drums & Hoops › Kit defaults (it is geometry). Offline-safe
     (controls disabled); viewers get a natively-disabled fieldset, same treatment as the
     dock Inspector.

     Lifecycle (must-keep, per the S4a pane spec §2.4): watch-while-mounted (re-sent each
     time the link opens) / unwatch-on-unmount is the ONLY thing gating the server's
     controller poll loop. SettingsModal renders just the active pane, so switching
     sections or closing the modal stops the poll. */
  import { onMount, untrack } from 'svelte';
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Select from '../../../ui/Select.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import OutputStatusPanel from '../../docks/inspectors/OutputStatusPanel.svelte';
  import { onNum } from '../../docks/inspectors/forms';
  import { PROTOCOL_OPTS } from '../../views/node-options';
  import PaneHeader from '../PaneHeader.svelte';

  let { store }: { store: TriggerLab } = $props();

  const project = $derived(store.project);
  const out = $derived(project?.output ?? null);

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

  // Subscribe to controller status while this pane is open — the ONLY thing that gates the
  // server's poll loop (no idle traffic). Sent whenever the link (re)opens while mounted, not
  // just at mount: on a ?settings=controller deep-link boot the WS isn't OPEN yet (WSClient.send
  // no-ops → dead pane), and a link drop clears the watch server-side, so a reconnect must
  // re-arm it. Also ask the server to enumerate its NICs so the subnet recommendation +
  // adapter picker have data. The sends are untracked: the WS onSend monitor hook reads AND
  // writes store state, which tracked here would re-run this effect forever (the BackupsDialog
  // effect-loop lesson). Un-watch on teardown.
  $effect(() => {
    if (store.link !== 'open') return;
    untrack(() => {
      store.watchController(true);
      store.requestNetworkAdapters();
    });
  });
  onMount(() => () => store.watchController(false));
</script>


<div class="pane-body">
  <PaneHeader id="controller" />
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
      <section class="transport" aria-label="Transport">
        <Eyebrow>Transport</Eyebrow>
        <p class="grouphint">Where pixel data is sent.</p>
        <div class="tgrid">
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
        </div>
      </section>
    {/if}
  </fieldset>
</div>

<style>
  .pane-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    /* The two-column split below sizes off THIS pane, not the viewport — the modal is a
       fixed width, so a viewport query would answer the wrong question. */
    container-type: inline-size;
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
  .transport {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  /* Transport as a two-up form: seven short fields stacked was most of this pane's height,
     and the pane has to fit the modal without scrolling (a controller you are diagnosing is
     read at a glance). Narrow containers fall back to one column. */
  .tgrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1) var(--space-4);
    align-items: start;
    min-width: 0;
  }
  @container (max-width: 560px) {
    .tgrid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  /* Read-only viewer: dim, on top of the native fieldset[disabled] gate. */
  .editgate:disabled {
    opacity: 0.6;
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
