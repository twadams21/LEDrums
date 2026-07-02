<script lang="ts">
  /* Key app composites, rendered from the REAL components: the shared NodeCard face
     (both graphs), live EffectThumbs (same sampler as the 3D kit), the OutputPill,
     the Monitor log, and the inspector control rows. Store-bound components
     (OutputPill, Monitor, RenameField) run on minimal reactive stubs — they read a
     tiny store surface, so the stub drives the real component, not a copy of it. */
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Link2 from '@lucide/svelte/icons/link-2';
  import NodeCard from '../../app/views/NodeCard.svelte';
  import EffectThumb from '../../trigger-lab/EffectThumb.svelte';
  import OutputPill from '../../app/chrome/OutputPill.svelte';
  import OutputStatusPanel from '../../app/docks/inspectors/OutputStatusPanel.svelte';
  import Monitor from '../../app/docks/Monitor.svelte';
  import ReadRow from '../../app/docks/inspectors/ReadRow.svelte';
  import RenameField from '../../app/docks/inspectors/RenameField.svelte';
  import Field from '../../ui/Field.svelte';
  import Slider from '../../ui/Slider.svelte';
  import DemoCard from '../DemoCard.svelte';
  import { kindIcon, tint, kindLabel } from '../../app/views/trigger-node-meta';
  import { PATTERN_EFFECTS, GENERATOR_EFFECTS } from '../../trigger-lab/fixtures';
  import type { EffectDef, NodeKind, ParamValues } from '../../trigger-lab/sim';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { MonitorEvent, OutputStatus } from '../../ws/protocol-types';
  import { filterMonitorEvents, DEFAULT_MONITOR_FILTERS, type MonitorFilterType } from '../../app/monitor';

  /* ---- OutputStatusPanel (pure props — no store) ------------------------------- */
  const outArmed: OutputStatus = { state: 'armed', protocol: 'artnet', host: '192.168.1.50', packetsSent: 0, lastError: null, universeCount: 8 };
  const outDryRun: OutputStatus = { state: 'dry-run', protocol: 'sacn', host: '239.255.0.1', packetsSent: 0, lastError: null, universeCount: 4 };
  const outErroring: OutputStatus = { state: 'armed', protocol: 'artnet', host: '192.168.1.50', packetsSent: 0, lastError: 'EHOSTUNREACH 192.168.1.50:6454', universeCount: 8 };

  /* ---- NodeCard faces ------------------------------------------------------- */
  const faceSubs: Record<NodeKind, string> = {
    trigger: 'kick · center',
    play: 'Soft strike',
    all: 'all at once',
    random: 'no-repeat',
    sequence: 'in order',
    switch: 'on value',
    chance: '45%',
    toggle: 'on · off',
    delay: '1/8 dotted',
  };
  const faceKinds = Object.keys(faceSubs) as NodeKind[];

  /* ---- EffectThumb ------------------------------------------------------------ */
  const defaults = (eff: EffectDef): ParamValues =>
    Object.fromEntries(eff.params.map((p) => [p.key, p.default]));
  const thumbIds = ['swirl', 'chase', 'sparkle', 'rip', 'wash'];
  const patternThumbs = thumbIds
    .map((id) => PATTERN_EFFECTS.find((e) => e.id === id))
    .filter((e): e is EffectDef => !!e);
  const genThumb = GENERATOR_EFFECTS[0];
  const playFace = patternThumbs[1] ?? patternThumbs[0];

  /* ---- OutputPill (reads store.link + store.output) ---------------------------- */
  const outStatus = (o: Partial<OutputStatus>): OutputStatus => ({
    state: 'armed',
    protocol: 'artnet',
    host: '192.168.1.50',
    packetsSent: 0,
    lastError: null,
    universeCount: 4,
    ...o,
  });
  const pillStub = (link: TriggerLab['link'], output: OutputStatus | null = null) =>
    ({ link, output }) as unknown as TriggerLab;

  /* ---- Monitor — reactive stub store (filters actually work) ------------------- */
  const now = Date.now();
  const demoEvents: MonitorEvent[] = [
    { id: 7, time: now, type: 'output', direction: 'out', source: 'output:artnet', destination: '192.168.1.50', label: 'Art-Net alive — 4 universes @ 44fps', detail: 'coalesced 1s summary' },
    { id: 6, time: now - 900, type: 'effect', direction: 'local', source: 'voice-engine', destination: 'kick', label: 'voice start — Chase (Soft strike)' },
    { id: 5, time: now - 1000, type: 'graph', direction: 'local', source: 'server/voice', destination: 'graph:kick-main', label: 'fired via pad-section', detail: '3 actions · state graph:kick-main#s1' },
    { id: 4, time: now - 1100, type: 'input', direction: 'in', source: 'midi:note 36', destination: 'voice-engine', label: 'kick · center · vel 0.82' },
    { id: 3, time: now - 4200, type: 'persistence', direction: 'local', source: 'server', label: 'project autosaved', detail: 'projects/default.local' },
    { id: 2, time: now - 8000, type: 'system', direction: 'local', source: 'server', label: 'engine=voice · ws :4321 · web ready' },
    { id: 1, time: now - 8100, type: 'error', direction: 'in', source: 'ws', label: 'decode failed: unknown message t=zap' },
  ];

  class MonitorStub {
    monitorTypeFilter = $state<MonitorFilterType>('all');
    monitorTextFilter = $state('');
    monitorSourceFilter = $state('');
    monitorDestinationFilter = $state('');
    monitorEvents = $state<MonitorEvent[]>(demoEvents);
    log: never[] = [];
    get visibleMonitorEvents(): MonitorEvent[] {
      return filterMonitorEvents(this.monitorEvents, {
        type: this.monitorTypeFilter,
        text: this.monitorTextFilter,
        source: this.monitorSourceFilter,
        destination: this.monitorDestinationFilter,
      });
    }
    setMonitorTypeFilter(t: MonitorFilterType): void {
      this.monitorTypeFilter = t;
    }
    setMonitorTextFilter(t: string): void {
      this.monitorTextFilter = t;
    }
    setMonitorSourceFilter(t: string): void {
      this.monitorSourceFilter = t;
    }
    setMonitorDestinationFilter(t: string): void {
      this.monitorDestinationFilter = t;
    }
    resetMonitorFilters(): void {
      this.monitorTypeFilter = DEFAULT_MONITOR_FILTERS.type;
      this.monitorTextFilter = DEFAULT_MONITOR_FILTERS.text;
      this.monitorSourceFilter = DEFAULT_MONITOR_FILTERS.source;
      this.monitorDestinationFilter = DEFAULT_MONITOR_FILTERS.destination;
    }
    clearMonitor(): void {
      this.monitorEvents = [];
    }
  }
  const monitorStub = new MonitorStub() as unknown as TriggerLab;

  /* ---- RenameField — reactive stub (patchLabels + setPatchLabel) --------------- */
  class RenameStub {
    patchLabels = $state<Record<string, string>>({});
    setPatchLabel(id: string, v: string): void {
      const next = { ...this.patchLabels };
      if (v) next[id] = v;
      else delete next[id];
      this.patchLabels = next;
    }
  }
  const renameStub = new RenameStub() as unknown as TriggerLab;

  let inspectorGain = $state(0.7);
</script>

<section class="block" id="composites">
  <div class="block-head">
    <h2>Composites — lib/app</h2>
    <p>
      The recurring assemblies UI work composes with. All rendered from the shipped
      components — the demos below cannot drift from the app.
    </p>
  </div>

  <div class="comp-grid">
    <DemoCard
      title="Node card — every kind"
      src={['lib/app/views/NodeCard', 'lib/app/views/trigger-node-meta']}
      note="The ONE face both graphs render. Kind icon + tint from trigger-node-meta; title bold, sub mono-faint."
      wide
    >
      <div class="face-grid">
        {#each faceKinds as k (k)}
          <NodeCard icon={kindIcon[k]} title={kindLabel[k]} sub={faceSubs[k]} tint={tint[k]} />
        {/each}
        {#if playFace}
          <NodeCard icon={kindIcon.play} title={playFace.name} sub="with EffectThumb" tint={tint.play}>
            {#snippet thumb()}
              <EffectThumb pattern={playFace.pattern} params={defaults(playFace)} w={56} h={32} />
            {/snippet}
          </NodeCard>
        {/if}
      </div>
    </DemoCard>

    <DemoCard
      title="Node card — states"
      src="lib/app/views/NodeCard"
      note="Hover = accent border only (NO lift/motion). Selected adds a crisp ring; wires do not light. Drop target = wider soft ring while a wire hovers the node. Stale = dashed warn card when a node's live model can't be resolved (blank-proof placeholder, incident 09)."
      wide
    >
      <div class="face-grid">
        <NodeCard icon={kindIcon.play} title="Resting" sub="default" tint={tint.play} />
        <NodeCard icon={kindIcon.play} title="Hovered" sub="hovered … wires hot" tint={tint.play} hovered />
        <NodeCard icon={kindIcon.play} title="Selected" sub="ring · in Inspector" tint={tint.play} selected />
        <NodeCard icon={kindIcon.play} title="Drop target" sub="wire over node" tint={tint.play} dropTarget />
        <NodeCard icon={TriangleAlert} title="Stale node" sub="model missing" tint="var(--warn)" stale />
      </div>
    </DemoCard>

    <DemoCard
      title="Node card — drum-link badge"
      src="lib/app/views/NodeCard"
      note="A trigger node whose MIDI/OSC source is ALSO zone-mapped to a drum fires both paths per hit (by design). The corner badge slot flags it with a link glyph; in the app it carries a naming tooltip (“also drum trigger: kick · center”) and the same hint shows in the trigger + zone inspectors."
      wide
    >
      <div class="face-grid">
        <NodeCard icon={kindIcon.trigger} title="Trigger" sub="MIDI D2" tint={tint.trigger}>
          {#snippet badge()}
            <Link2 size={11} aria-hidden="true" />
          {/snippet}
        </NodeCard>
      </div>
    </DemoCard>

    <DemoCard
      title="Effect thumbnails"
      src="lib/trigger-lab/EffectThumb"
      note="Live — the SAME sampler the 3D kit uses, on a 26×13 grid. One shared rAF ticker for all thumbs; offscreen thumbs pause; reduced-motion renders a single static frame."
      wide
    >
      <div class="thumb-row">
        {#each patternThumbs as eff (eff.id)}
          <figure class="thumb-fig">
            <EffectThumb pattern={eff.pattern} params={defaults(eff)} w={96} h={54} />
            <figcaption>{eff.name}</figcaption>
          </figure>
        {/each}
        {#if genThumb}
          <figure class="thumb-fig">
            <EffectThumb pattern={genThumb.pattern} params={defaults(genThumb)} generatorId={genThumb.generatorId} w={96} h={54} />
            <figcaption>{genThumb.name} · generator</figcaption>
          </figure>
        {/if}
      </div>
    </DemoCard>

    <DemoCard
      title="Output pill"
      src={['lib/app/chrome/OutputPill', 'lib/app/chrome/output-pill', 'lib/ui/StatusPill']}
      note="Truth from the server's OutputStatus (arming/packets/lastError) × link state, not link alone. LIVE (armed + packets, red) · ERR (armed but erroring — red, pulsing, error in tooltip) · DRY (dry-run, amber) · ARMED (armed, no packets yet — pulsing) · OFF (disabled) · SYNC (connecting, pulsing) · LOCAL (offline, sim only). LIVE is impossible while lastError is set or packets aren't flowing."
    >
      <div class="pill-row">
        <OutputPill store={pillStub('open', outStatus({ state: 'armed', packetsSent: 128_400 }))} />
        <OutputPill store={pillStub('open', outStatus({ state: 'armed', packetsSent: 128_400, lastError: 'EHOSTUNREACH 192.168.1.50:6454' }))} />
        <OutputPill store={pillStub('open', outStatus({ state: 'dry-run' }))} />
        <OutputPill store={pillStub('open', outStatus({ state: 'armed', packetsSent: 0 }))} />
        <OutputPill store={pillStub('open', outStatus({ state: 'disabled' }))} />
        <OutputPill store={pillStub('connecting')} />
        <OutputPill store={pillStub('offline')} />
      </div>
    </DemoCard>

    <DemoCard
      title="Output status panel"
      src={['lib/app/docks/inspectors/OutputStatusPanel', 'lib/app/docks/inspectors/output-status']}
      note="The confidence home in the controller inspector — state pill, packets/s (tabular), universes, target, protocol. lastError raises a prominent red alert; offline shows a hint. Extended by the PixLite panel (S48)."
      wide
    >
      <div class="panel-row">
        <OutputStatusPanel output={outArmed} packetsPerSec={44_318} port={6454} />
        <OutputStatusPanel output={outDryRun} packetsPerSec={null} />
        <OutputStatusPanel output={outErroring} packetsPerSec={0} port={6454} />
        <OutputStatusPanel output={null} packetsPerSec={null} />
      </div>
    </DemoCard>

    <DemoCard
      title="Inspector control rows"
      src={['lib/app/docks/inspectors/ReadRow', 'lib/app/docks/inspectors/RenameField']}
      note="The per-node editor vocabulary: RenameField (label override), Field-wrapped controls, ReadRow read-outs (mono, right-aligned, tabular)."
    >
      <div class="insp-demo">
        <RenameField store={renameStub} nodeId="demo:hoop-3" fallback="Hoop 3" />
        <Field label="Gain">
          <Slider bind:value={inspectorGain} min={0} max={1} step={0.01} ariaLabel="Gain" format={(v) => v.toFixed(2)} />
        </Field>
        <div class="readrows">
          <ReadRow label="First pixel" value="1,177" />
          <ReadRow label="Last pixel" value="1,284" />
          <ReadRow label="Transmit order" value="3 of 8" />
        </div>
      </div>
    </DemoCard>

    <DemoCard
      title="Monitor"
      src={['lib/app/docks/Monitor', 'lib/app/monitor']}
      note="The routing/debug log — entries colour-code by type on the left border. The filters here are live (this demo runs the real filter code)."
      wide
    >
      <div class="monitor-demo">
        <Monitor store={monitorStub} variant="dock" />
      </div>
    </DemoCard>
  </div>
</section>

<style>
  .comp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--space-5) var(--space-6);
  }
  .face-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .thumb-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  .thumb-fig {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
  }
  .thumb-fig figcaption {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .pill-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .panel-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--space-4) var(--space-5);
    align-items: start;
  }
  .insp-demo {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 300px;
  }
  .readrows {
    display: flex;
    flex-direction: column;
  }
  .monitor-demo {
    height: 260px;
  }
</style>
