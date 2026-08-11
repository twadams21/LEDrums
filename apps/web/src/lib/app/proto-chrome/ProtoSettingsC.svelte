<script lang="ts">
  /* PROTOTYPE (throwaway — see NOTES.md). Variant C's Settings: NO patch graph.
     The entire patch — drums, hoops, output chains, controller transport — is
     expressed as conventional settings lists/forms. The question this variant
     answers is "can the format express the whole thing", so the data is REAL
     (read from the live kit/project) but the edit controls are inert: they
     render as editable and toast instead of writing. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { Component } from 'svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Field from '../../ui/Field.svelte';
  import Select from '../../ui/Select.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import { pushToast } from '../../ui/toast.svelte';
  import { midiChannelOptions } from '../../midi/midi-note';
  import { deviceListEmptyState } from '../chrome/midi-devices';
  import OscInputPanel from '../chrome/OscInputPanel.svelte';
  import UpdateControl from '../chrome/UpdateControl.svelte';
  import { DEFAULT_KIT } from '@ledrums/core';
  import { outputsToPatch, type PatchOutput } from '../patch-routing';
  import { defaultRouting } from '../patch-graph';
  import { PROTOCOL_OPTS, RGB_OPTS } from '../views/node-options';
  import { ZONE_LABELS } from '../../trigger-lab/fixtures';
  import Music from '@lucide/svelte/icons/music';
  import Drum from '@lucide/svelte/icons/circle-dot';
  import Cable from '@lucide/svelte/icons/cable';
  import Cpu from '@lucide/svelte/icons/cpu';
  import Wrench from '@lucide/svelte/icons/wrench';

  let {
    store,
    open,
    initialPane = null,
    onClose,
  }: {
    store: TriggerLab;
    open: boolean;
    /** ui-shot deep-link (`?pane=outputs` etc.): land on a specific section. */
    initialPane?: string | null;
    onClose: () => void;
  } = $props();

  type Pane = 'input' | 'drums' | 'outputs' | 'controller' | 'system';
  const PANES: readonly Pane[] = ['input', 'drums', 'outputs', 'controller', 'system'];
  // svelte-ignore state_referenced_locally -- deep-link seed, initial value by design
  let pane = $state<Pane>(PANES.includes(initialPane as Pane) ? (initialPane as Pane) : 'drums');

  const NAV: Array<{ id: Pane; label: string; icon: Component }> = [
    { id: 'input', label: 'Input', icon: Music },
    { id: 'drums', label: 'Drums & Hoops', icon: Drum },
    { id: 'outputs', label: 'Outputs & Chains', icon: Cable },
    { id: 'controller', label: 'Controller', icon: Cpu },
    { id: 'system', label: 'System', icon: Wrench },
  ];

  /** Inert edit affordance — the variant proves the FORMAT, not the wiring. */
  function inert(): void {
    pushToast('Prototype — edits are not wired in this variant');
  }

  // ---- Input pane (same as B) ----------------------------------------------
  const channelValue = $derived(store.midiChannel === null ? 'all' : String(store.midiChannel));
  const midiEmpty = $derived(
    deviceListEmptyState(store.midiAvailable, store.midiUnavailableReason, store.midiDevices.length),
  );
  const CHANNEL_OPTS = midiChannelOptions();
  function setChannel(v: string): void {
    store.setMidiChannel(v === 'all' ? null : Number(v));
  }

  // ---- Real patch data, read-only (DEFAULT_KIT offline, like PatchGraphView) --
  const kit = $derived(store.project?.kit ?? DEFAULT_KIT);
  const transport = $derived(store.project?.output ?? null);

  function zonesForDrum(drumId: string): string[] {
    const canonical = drumId === 'kick' ? ['center', 'shell'] : ZONE_LABELS;
    const authored = store.pads.filter((p) => p.drumId === drumId).map((p) => p.zoneLabel);
    return [...new Set<string>([...canonical, ...authored])];
  }

  type DrumRow = { id: string; label: string; zones: number; hoops: Array<{ n: number; px: number | null; reverse: boolean }> };
  const drumRows = $derived.by<DrumRow[]>(() => {
    return store.drums.map((d) => {
      const kd = kit.drums.find((k) => k.id === d.id);
      // a drum without an explicit hoops[] resolves per count with density-derived pixels ('—')
      const count = kd?.hoops?.length ?? kd?.hoopCount ?? kit.global.hoopCount;
      const hoops =
        kd?.hoops?.map((h, i) => ({ n: i + 1, px: h.pixelCount as number | null, reverse: h.reverse })) ??
        Array.from({ length: count }, (_, i) => ({ n: i + 1, px: null, reverse: false }));
      return { id: d.id, label: d.label, zones: zonesForDrum(d.id).length, hoops };
    });
  });

  const routing = $derived.by<PatchOutput[]>(() => {
    if (kit.outputs.length) return outputsToPatch(kit.outputs).outputs;
    const routingDrums = store.drums.map((d) => {
      const kd = kit.drums.find((k) => k.id === d.id);
      return { id: d.id, hoopCount: kd?.hoops?.length ?? kit.global.hoopCount };
    });
    return defaultRouting(routingDrums).outputs;
  });

  function drumLabel(drumId: string): string {
    return store.drums.find((d) => d.id === drumId)?.label ?? drumId;
  }
  function hoopPixels(drumId: string, hoop: number): number | null {
    const kd = kit?.drums.find((k) => k.id === drumId);
    return kd?.hoops?.[hoop - 1]?.pixelCount ?? null;
  }
  function outputPixels(o: PatchOutput): number {
    return o.hoops.reduce((n, h) => n + (hoopPixels(h.drumId, h.hoop) ?? 0), 0);
  }
</script>

<Dialog {open} {onClose} title="Settings" class="proto-settings-c">
  <header class="head">
    <h2>Settings</h2>
    <span class="subtitle">Variant C — the whole patch as settings, no graph canvas</span>
  </header>
  <div class="split">
    <nav class="snav" aria-label="Settings sections">
      {#each NAV as n (n.id)}
        <button type="button" class="sitem" class:on={pane === n.id} onclick={() => (pane = n.id)}>
          <n.icon size={14} aria-hidden="true" />
          {n.label}
        </button>
      {/each}
    </nav>

    <div class="pane">
      {#if pane === 'input'}
        <Field label="MIDI channel" hint="input filter">
          <Select
            value={channelValue}
            options={CHANNEL_OPTS}
            onChange={setChannel}
            disabled={!store.canEdit || !store.project}
            ariaLabel="MIDI channel"
          />
        </Field>
        <section class="block" aria-label="MIDI input devices">
          <span class="blabel">MIDI devices</span>
          {#if midiEmpty}
            <p class="empty">{midiEmpty}</p>
          {:else}
            <ul class="rows">
              {#each store.midiDevices as device (device.id)}
                <li class="row">
                  <span class="rname">{device.name}</span>
                  <StatusPill
                    tone={device.state === 'connected' ? 'ok' : 'muted'}
                    label={device.state === 'connected' ? 'Connected' : 'Disconnected'}
                  />
                </li>
              {/each}
            </ul>
          {/if}
        </section>
        <OscInputPanel {store} />
      {:else if pane === 'drums'}
        <section class="block">
          <span class="blabel">Drums<em class="bhint">sensor zones · LED hoops per drum</em></span>
          <ul class="rows">
            {#each drumRows as d (d.id)}
              <li class="drum">
                <div class="drumhead">
                  <span class="rname">{d.label}</span>
                  <span class="rsub">{d.zones} zones · {d.hoops.length} hoops</span>
                </div>
                <ul class="hoops">
                  {#each d.hoops as h (h.n)}
                    <li class="hoop">
                      <span class="hn">Hoop {h.n}</span>
                      <span class="hpx"><CommitInput value={h.px != null ? String(h.px) : '—'} ariaLabel="{d.label} hoop {h.n} pixels" onCommit={inert} /> px</span>
                      <span class="hrev">
                        <Toggle pressed={h.reverse} onChange={inert} ariaLabel="Reverse direction" onLabel="reversed" offLabel="forward" />
                      </span>
                    </li>
                  {/each}
                </ul>
              </li>
            {/each}
          </ul>
        </section>
      {:else if pane === 'outputs'}
        <section class="block">
          <span class="blabel">Physical outputs<em class="bhint">each output is one data run through hoops, in transmit order</em></span>
          <ul class="rows">
            {#each routing as o, i (o.id)}
              <li class="output">
                <div class="outhead">
                  <span class="rname">Output {i + 1}</span>
                  <span class="outmeta">
                    <span class="om">universe <CommitInput value={o.startUniverse != null ? String(o.startUniverse) : 'auto'} ariaLabel="Start universe" onCommit={inert} /></span>
                    <span class="om">order <Select value={o.rgbOrder ?? 'RGB'} options={RGB_OPTS} onChange={inert} ariaLabel="RGB order" /></span>
                    <span class="om mono">{outputPixels(o)} px</span>
                  </span>
                </div>
                <ol class="chain">
                  {#each o.hoops as h, hi (`${h.drumId}:${h.hoop}:${hi}`)}
                    <li class="link">
                      <button type="button" class="hooplink" onclick={inert} title="Reorder / reassign (not wired in prototype)">
                        {drumLabel(h.drumId)} · {h.hoop}
                        {#if hoopPixels(h.drumId, h.hoop) != null}
                          <span class="lpx">{hoopPixels(h.drumId, h.hoop)}px</span>
                        {/if}
                      </button>
                    </li>
                  {/each}
                  <li class="link">
                    <button type="button" class="addlink" onclick={inert}>+ hoop</button>
                  </li>
                </ol>
              </li>
            {/each}
          </ul>
        </section>
      {:else if pane === 'controller'}
        <div class="grid2">
          <Field label="Protocol">
            <Select value={transport?.protocol ?? 'sacn'} options={PROTOCOL_OPTS} onChange={inert} ariaLabel="Protocol" />
          </Field>
          <Field label="Controller host" hint="PixLite IP">
            <CommitInput value={transport?.host ?? '—'} ariaLabel="Controller host" onCommit={inert} />
          </Field>
          <Field label="Port">
            <CommitInput value={transport?.port != null ? String(transport.port) : '—'} ariaLabel="Port" onCommit={inert} />
          </Field>
          <Field label="FPS">
            <CommitInput value={transport?.fps != null ? String(transport.fps) : '—'} ariaLabel="FPS" onCommit={inert} />
          </Field>
          <Field label="Expanded output mode" hint="PixLite: 2 logical outputs per port">
            <Toggle pressed={kit.global.expanded} onChange={inert} ariaLabel="Expanded output mode" />
          </Field>
          <Field label="Max pixels per output">
            <CommitInput value={String(kit.global.maxPixelsPerOutput)} ariaLabel="Max pixels per output" onCommit={inert} />
          </Field>
        </div>
        {#if !transport}
          <p class="empty">Engine link is down — transport values show placeholders until a project loads.</p>
        {/if}
      {:else}
        <Field label="Updates" hint="desktop app">
          <UpdateControl />
        </Field>
      {/if}
    </div>
  </div>
</Dialog>

<style>
  :global(.proto-settings-c) {
    width: min(980px, calc(100vw - 48px));
    height: min(680px, calc(100vh - 48px));
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
  }
  .subtitle {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .split {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    min-height: 0;
    flex: 1;
  }
  .snav {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border-right: 1px solid var(--border-faint);
    background: var(--surface-2);
  }
  .sitem {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
  }
  .sitem:hover {
    color: var(--text);
    background: var(--surface-3);
  }
  .sitem.on {
    background: var(--surface-3);
    color: var(--ink);
    border-color: var(--border);
  }
  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    min-height: 0;
    overflow-y: auto;
  }
  .pane :global(.sel) {
    width: 100%;
    max-width: 240px;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .blabel {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .bhint {
    font-style: normal;
    color: var(--text-faint);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
  }
  .rname {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .rsub {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .empty {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--text-muted);
  }

  /* Drums & Hoops */
  .drum {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-3);
    background: var(--surface-inset);
  }
  .drumhead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .hoops {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .hoop {
    display: grid;
    grid-template-columns: 64px auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-3);
    padding: 3px 0;
  }
  .hn {
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .hpx {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .hpx :global(input) {
    width: 56px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .hrev {
    justify-self: start;
  }

  /* Outputs & Chains */
  .output {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-3);
    background: var(--surface-inset);
  }
  .outhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .outmeta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
  }
  .om {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .om :global(input) {
    width: 52px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .om.mono {
    font-family: var(--font-mono);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .chain {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    counter-reset: link;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .link:not(:first-child)::before {
    content: '→';
    color: var(--text-faint);
    font-size: var(--text-xs);
    margin-right: var(--space-1);
  }
  .hooplink {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 3px var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-2);
    font-size: var(--text-xs);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
  }
  .hooplink:hover {
    border-color: var(--border-strong);
  }
  .lpx {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .addlink {
    padding: 3px var(--space-2);
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-2);
    background: transparent;
    font-size: var(--text-xs);
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
  }
  .addlink:hover {
    border-color: var(--accent-dim);
    color: var(--accent);
  }

  /* Controller */
  .grid2 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-4);
    max-width: 560px;
  }
</style>
