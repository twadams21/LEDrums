<script lang="ts">
  /* Key app composites, rendered from the REAL components: the shared NodeCard face
     (both graphs), live EffectThumbs (same sampler as the 3D kit), the OutputPill,
     the Monitor log, and the inspector control rows. Store-bound components
     (OutputPill, SaveIndicator, Monitor, RenameField) run on minimal reactive stubs — they read a
     tiny store surface, so the stub drives the real component, not a copy of it. */
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Link2 from '@lucide/svelte/icons/link-2';
  import NodeCard from '../../app/views/NodeCard.svelte';
  import NodeIconChip from '../../app/views/NodeIconChip.svelte';
  import GraphLintStrip from '../../app/views/GraphLintStrip.svelte';
  import { voice } from '@ledrums/core';
  import { makeNode } from '../../trigger-lab/sim';
  import EffectThumb from '../../trigger-lab/EffectThumb.svelte';
  import OutputPill from '../../app/chrome/OutputPill.svelte';
  import SaveIndicator from '../../app/chrome/SaveIndicator.svelte';
  import OscInputPanel from '../../app/chrome/OscInputPanel.svelte';
  import BootOverlay from '../../app/chrome/BootOverlay.svelte';
  import RecoveryBanner from '../../app/chrome/RecoveryBanner.svelte';
  import { initialBootStatus, type BootStatus } from '../../app/boot-reducer';
  import OutputStatusPanel from '../../app/docks/inspectors/OutputStatusPanel.svelte';
  import ControllerStatusPanel from '../../app/docks/inspectors/ControllerStatusPanel.svelte';
  // The six children ControllerStatusPanel composes (INIT-09 S7) — each pure props in,
  // callbacks out, so they demo on plain values with no stub store at all.
  import ControllerBanners from '../../app/docks/inspectors/ControllerBanners.svelte';
  import ControllerDiscovery from '../../app/docks/inspectors/ControllerDiscovery.svelte';
  import ControllerReadout from '../../app/docks/inspectors/ControllerReadout.svelte';
  import ControllerAuthField from '../../app/docks/inspectors/ControllerAuthField.svelte';
  import ControllerTestPatterns from '../../app/docks/inspectors/ControllerTestPatterns.svelte';
  import ControllerCandidates from '../../app/docks/inspectors/ControllerCandidates.svelte';
  import AdoptByIpRow from '../../app/docks/inspectors/AdoptByIpRow.svelte';
  import UniverseRxTable from '../../app/docks/inspectors/UniverseRxTable.svelte';
  import Monitor from '../../app/docks/Monitor.svelte';
  import ReadRow from '../../app/docks/inspectors/ReadRow.svelte';
  import RenameField from '../../app/docks/inspectors/RenameField.svelte';
  import Field from '../../ui/Field.svelte';
  import Slider from '../../ui/Slider.svelte';
  import DemoCard from '../DemoCard.svelte';
  import { kindIcon, tint, kindLabel } from '../../app/views/trigger-node-meta';
  import { GENERATOR_EFFECTS } from '../../trigger-lab/fixtures';
  import type { EffectDef, NodeKind, ParamValues } from '../../trigger-lab/sim';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ControllerStatus, ControllerTestPattern, DiscoveredController, MonitorEvent, NetworkAdapter, OscListenInfo, OutputStatus } from '../../ws/protocol-types';
  import type { InputBadgeView } from '../../trigger-lab/input-activity';
  import { filterMonitorEvents, DEFAULT_MONITOR_FILTERS, type MonitorFilterType } from '../../app/monitor';

  /* ---- OutputStatusPanel (pure props — no store) ------------------------------- */
  const outArmed: OutputStatus = { state: 'armed', protocol: 'artnet', host: '192.168.1.50', packetsSent: 0, lastError: null, universeCount: 8 };
  const outDryRun: OutputStatus = { state: 'dry-run', protocol: 'sacn', host: '239.255.0.1', packetsSent: 0, lastError: null, universeCount: 4 };
  const outErroring: OutputStatus = { state: 'armed', protocol: 'artnet', host: '192.168.1.50', packetsSent: 0, lastError: 'EHOSTUNREACH 192.168.1.50:6454', universeCount: 8 };

  /* ---- ControllerStatusPanel (S48 — pure props + action callbacks) ------------- */
  // A fixed `nowMs` keeps the LOST "last seen" age deterministic in the generated artifact.
  const CTRL_NOW = 1_000_000;
  const ctrlIdentity = { host: '192.168.1.50', prodName: 'PixLite A16-S Mk3', nickname: 'Roof Left 1', fwVer: '1.4.2', authReqd: false };
  const ctrlHealth = { tempC: 41, bankVoltsMv: [12_100, 12_000], portStatus: ['ok', 'ok'], ethLinkUp: [true, true, false] };
  const ctrlReceiving: ControllerStatus = {
    host: '192.168.1.50', reachable: true, identity: ctrlIdentity,
    universes: [
      { uniNum: 1, protocol: 'sACN', receiving: true, inGood: 44_318, inBadSeq: 0, priority: 100, sourceName: 'LEDrums' },
      { uniNum: 2, protocol: 'sACN', receiving: true, inGood: 44_301, inBadSeq: 2, priority: 100 },
    ],
    rates: { inFrmRate: 40, outFrmRate: 40 }, health: ctrlHealth, lastSeen: CTRL_NOW - 400,
  };
  const ctrlNotReceiving: ControllerStatus = {
    ...ctrlReceiving,
    universes: [
      { uniNum: 1, protocol: 'sACN', receiving: true, inGood: 44_318, inBadSeq: 0, priority: 100 },
      { uniNum: 2, protocol: 'sACN', receiving: false, inGood: 12_004, inBadSeq: 88 },
    ],
    rates: { inFrmRate: 40, outFrmRate: 40 }, lastSeen: CTRL_NOW - 900,
  };
  const ctrlLost: ControllerStatus = {
    ...ctrlReceiving, reachable: false, rates: {}, health: {}, lastSeen: CTRL_NOW - 12_000,
  };
  // S49 takeover: a running test pattern — the LOUD amber banner + lit control, the box IGNORING
  // the live show. Distinct from the red LOST/not-receiving family (that's a fault; this is chosen).
  const ctrlTakeover: ControllerStatus = {
    ...ctrlReceiving,
    testPattern: { op: 'setColor', color: [255, 0, 0, 0], colorRes: '8Bit', pixPortNum: 0, pixNum: 0 },
  };
  // R29 auth: a box that DEMANDS an admin password and isn't answering — the only state in which
  // `.auth.needs` lights (authReqd && !reachable), so it is the one that gives the admin-password
  // field capture coverage. Without it the field renders only in its calm variant.
  const ctrlNeedsAuth: ControllerStatus = {
    ...ctrlLost,
    identity: { ...ctrlIdentity, authReqd: true },
  };
  const ctrlCandidates: DiscoveredController[] = [
    { host: '192.168.1.50', prodName: 'PixLite A16-S Mk3', nickname: 'Roof Left 1', fwVer: '1.4.2', authReqd: false, score: 100 },
    { host: '192.168.1.51', prodName: 'PixLite T8-S Mk3', nickname: 'Stage Right', fwVer: '1.4.0', authReqd: true, score: 80 },
  ];
  // The subnet-guidance card + Adopt-by-IP shown when nothing is adopted or the box is lost — a
  // featured NIC with its subnet and a recommended controller IP (the "different IP addresses" fix).
  const ctrlRecommendation: NetworkAdapter = {
    name: 'Ethernet', address: '192.168.1.10', netmask: '255.255.255.0', cidr: '192.168.1.10/24', subnet: '192.168.1.0/24', recommendedIp: '192.168.1.50',
  };
  const noop = () => {};

  /* ---- NodeCard faces ------------------------------------------------------- */
  const faceSubs: Record<NodeKind, string> = {
    trigger: 'kick · center',
    play: 'Soft strike',
    effect: 'Soft strike',
    all: 'all at once',
    random: 'no-repeat',
    sequence: 'in order',
    switch: 'on value',
    chance: '45%',
    toggle: 'on · off',
    delay: '1/8 dotted',
    modifier: 'Trail',
    mix: 'normal',
    scope: 'Snare',
    output: 'Hoop',
    envelope: 'modulation source',
    lfo: 'sine · 1Hz',
    cc: 'CC 74 · ch 1',
    note: 'Note 60 · gate',
    osc: 'OSC /fader/1',
    randomMod: 'per trigger',
  };
  const faceKinds = Object.keys(faceSubs) as NodeKind[];

  /* ---- EffectThumb ------------------------------------------------------------ */
  const defaults = (eff: EffectDef): ParamValues =>
    Object.fromEntries(eff.params.map((p) => [p.key, p.default]));
  const thumbIds = ['gen:chase-bands', 'gen:helix', 'gen:pixel-accum', 'gen:ripple-3d', 'gen:radial-wash'];
  const patternThumbs = thumbIds
    .map((id) => GENERATOR_EFFECTS.find((e) => e.id === id))
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
  // `controllerTest` is not optional here: OutputPill reads `store.controllerTest.takeover`
  // (S49 — a running test pattern drops the pill from LIVE to TEST), and the `as unknown as
  // TriggerLab` cast below hides a missing sub-store from svelte-check, so omitting it threw
  // at runtime and took the whole styleguide route down with it.
  const pillStub = (link: TriggerLab['link'], output: OutputStatus | null = null, takeover: ControllerTestPattern | null = null) =>
    ({ link, output, controllerTest: { takeover } }) as unknown as TriggerLab;

  /* ---- SaveIndicator (reads store.saveStatus + store.saveError) ----------------- */
  const saveStub = (saveStatus: TriggerLab['saveStatus'], saveError: string | null = null) =>
    ({ saveStatus, saveError }) as unknown as TriggerLab;

  /* ---- OscInputPanel (reads store.oscListen + store.oscHeardBadge) -------------- */
  const oscHeard: InputBadgeView = {
    label: '/kick',
    value: '0.82',
    age: 'now',
    tone: 'live',
    fresh: true,
    title: 'Last heard /kick · 0.82 · now ago',
  };
  const oscStub = (oscListen: OscListenInfo, oscHeardBadge: InputBadgeView | null = null) =>
    ({ oscListen, oscHeardBadge }) as unknown as TriggerLab;

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

  /* ---- GraphLintStrip — pure props (compileRenderPlan issues) ------------------- */
  // Real compiler output: compile deliberately degenerate graphs so the demo can never drift
  // from what the render-plan linter actually emits.
  const lintDegenerate = voice.compileRenderPlan({
    version: 3,
    nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('all', 'a', 200, 0), makeNode('all', 'b', 200, 120)],
    edges: [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'b', to: 'a' },
    ],
  }).issues;
  const lintMissingTrigger = voice.compileRenderPlan({
    version: 3,
    nodes: [makeNode('output', 'output', 400, 0)],
    edges: [],
  }).issues;

  /* ---- BootOverlay — pure props (status + active) ------------------------------ */
  const boot = (patch: Partial<BootStatus>): BootStatus => ({ ...initialBootStatus, ...patch });
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
      title="Node icon chip"
      src={['lib/app/views/NodeIconChip', 'lib/app/views/trigger-node-meta']}
      note="The tinted glyph chip that carries a node's role/kind colour — the atom of every node face. Reused wherever a node reads as itself: the NodeCard, and the Add pane's category tiles. `size` scales chip + glyph together (30 on cards, 26 on category tiles)."
      wide
    >
      <div class="chip-row">
        {#each faceKinds as k (k)}
          <NodeIconChip icon={kindIcon[k]} tint={tint[k]} />
        {/each}
      </div>
    </DemoCard>

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
              <EffectThumb params={defaults(playFace)} generatorId={playFace.generatorId} w={56} h={32} />
            {/snippet}
          </NodeCard>
        {/if}
      </div>
    </DemoCard>

    <DemoCard
      title="Node card — states"
      src="lib/app/views/NodeCard"
      note="Hover = accent border only, pure CSS + instant (NO lift/motion). Selected adds a crisp ring; wires do not light. Drop target = wider soft ring while a wire hovers the node. Stale = dashed warn card when a node's live model can't be resolved (blank-proof placeholder, incident 09)."
      wide
    >
      <div class="face-grid">
        <NodeCard icon={kindIcon.play} title="Resting" sub="default" tint={tint.play} />
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
            <EffectThumb params={defaults(eff)} generatorId={eff.generatorId} w={96} h={54} />
            <figcaption>{eff.name}</figcaption>
          </figure>
        {/each}
        {#if genThumb}
          <figure class="thumb-fig">
            <EffectThumb params={defaults(genThumb)} generatorId={genThumb.generatorId} w={96} h={54} />
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
      title="Save indicator"
      src={['lib/app/chrome/SaveIndicator', 'lib/trigger-lab/save-status']}
      note="The performer's only evidence their work is persisted, so it must not overclaim. 'Saved' is a green check and means the LOCAL writes landed — every one of them; a server push is fire-and-forget with no ack and counts for nothing. When a write fails it becomes the app's standard fault: TriangleAlert in --live, 'Not saved', and a tooltip naming the cause. That state alone does not fade after a hold — it stands until a later save actually succeeds — and the live region turns assertive for it. Idle · Saving… · Saved · Not saved."
    >
      <div class="pill-row">
        <SaveIndicator store={saveStub('saving')} />
        <SaveIndicator store={saveStub('saved')} />
        <SaveIndicator store={saveStub('error', 'The song library could not be saved (quota: the quota has been exceeded).')} />
      </div>
    </DemoCard>

    <DemoCard
      title="OSC input panel"
      src={['lib/app/chrome/OscInputPanel', 'lib/ui/CopyableValue', 'lib/ui/InputActivityBadge']}
      note="The 'what do I type into Sensory Percussion?' surface (#139). Copyable host:port rows, whether the UDP socket actually bound, and — the part that separates configured from working — live proof that packets are arriving, via the same InputActivityBadge used for per-binding last-heard. A failed bind is a live-toned fault, never silence."
    >
      <div class="osc-demo">
        <OscInputPanel store={oscStub({ status: 'listening', port: 9000, hosts: ['192.168.1.20'] }, oscHeard)} />
        <OscInputPanel store={oscStub({ status: 'listening', port: 9000, hosts: ['192.168.1.20', '10.0.0.5'] })} />
        <OscInputPanel
          store={oscStub({ status: 'error', port: 9000, hosts: ['192.168.1.20'], error: 'bind EADDRINUSE 0.0.0.0:9000' })}
        />
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
      title="Graph lint strip"
      src={['lib/app/views/GraphLintStrip', 'lib/app/views/graph-lint']}
      note="Persistent strip on the trigger-graph surface rendering the render-plan compiler's issues (R05) — each row states the problem plainly and names the next step, with the compiler's specific detail (cycle path) beneath. Warn family (amber), not the red output fault: it guides authoring, it doesn't alarm. Absent entirely when the graph compiles clean. Complementary to R03's transient wire toasts."
    >
      <div class="lint-demo">
        <GraphLintStrip issues={lintMissingTrigger} />
        <GraphLintStrip issues={lintDegenerate} />
      </div>
    </DemoCard>

    <DemoCard
      title="Controller status panel (PixLite)"
      src={['lib/app/docks/inspectors/ControllerStatusPanel', 'lib/app/docks/inspectors/output-status']}
      note="The confidence chain's last link (S48), extending the output panel below the fault row: identity, per-universe rx (good/bad, priority), frame rates + health, and Discover / Adopt-IP / Identify, plus the S49 built-in test patterns (solid-colour swatches / RGBW cycle / colour fade). The LOST and 'not receiving' states borrow the S03 fault tone (live-red) so a controller that isn't hearing us is unmissable. The TAKEOVER state (a test pattern running) is the amber warn family — a loud but deliberate 'the box is showing test data, not your live show', with one-click Back-to-live. The AUTH-NEEDED state (R29 — the device reports authReqd and we aren't reaching it) raises the admin-password field out of its calm default: the label takes the fault tone and the hint stops apologising and states the requirement. Un-adopted shows the Discover affordance + ranked candidates."
      wide
    >
      <div class="panel-row">
        <ControllerStatusPanel controller={ctrlReceiving} candidates={[]} outputHost="192.168.1.50" nowMs={CTRL_NOW} onDiscover={noop} onAdopt={noop} onIdentify={noop} onTestData={noop} onBackToLive={noop} />
        <ControllerStatusPanel controller={ctrlTakeover} takeover={ctrlTakeover.testPattern} candidates={[]} outputHost="192.168.1.50" nowMs={CTRL_NOW} onDiscover={noop} onAdopt={noop} onIdentify={noop} onTestData={noop} onBackToLive={noop} />
        <ControllerStatusPanel controller={ctrlNotReceiving} candidates={[]} outputHost="192.168.1.50" nowMs={CTRL_NOW} onDiscover={noop} onAdopt={noop} onIdentify={noop} onTestData={noop} onBackToLive={noop} />
        <ControllerStatusPanel controller={ctrlLost} candidates={[]} recommendation={ctrlRecommendation} outputHost="192.168.1.99" nowMs={CTRL_NOW} onDiscover={noop} onAdopt={noop} onIdentify={noop} onTestData={noop} onBackToLive={noop} />
        <ControllerStatusPanel controller={ctrlNeedsAuth} candidates={[]} outputHost="192.168.1.50" nowMs={CTRL_NOW} onDiscover={noop} onAdopt={noop} onIdentify={noop} onTestData={noop} onBackToLive={noop} onSetAuth={noop} />
        <ControllerStatusPanel controller={null} candidates={ctrlCandidates} recommendation={ctrlRecommendation} nowMs={CTRL_NOW} onDiscover={noop} onAdopt={noop} onIdentify={noop} onTestData={noop} onBackToLive={noop} />
      </div>
    </DemoCard>

    <!-- The six children the panel above composes (INIT-09 S7). Demoed individually because each is
         reusable on its own terms and, more practically, because the parent can only ever show one
         combination at a time — a banner pair, an auth field mid-warning and an idle test rack are
         three different moments of the same panel. Each takes plain values, so these are the real
         components with no stub store between them and you. -->
    <DemoCard
      title="Controller banners"
      src={['lib/app/docks/inspectors/ControllerBanners', 'lib/app/docks/inspectors/output-status']}
      note="The panel's two LOUD callouts, one grammar in two deliberately different colour families. TAKEOVER (amber warn) is a state you CHOSE — the box is showing test data, not your live show — so it warns rather than errors and carries its own one-click exit. ALERT (live-red) is LOST or not-receiving: it borrows the S03 fault treatment so it reads as the same family as an output fault. Both fade+rise in and collapse to instant under reduced motion; the takeover's left edge breathes the whole time a pattern runs."
    >
      <div class="ctrl-child-demo">
        <ControllerBanners takeover={ctrlTakeover.testPattern} onBackToLive={noop} host="192.168.1.50" />
        <ControllerBanners alert host="192.168.1.50" />
        <ControllerBanners alert lost host="192.168.1.50" quietFor="12s ago" />
      </div>
    </DemoCard>

    <DemoCard
      title="Controller discovery guide"
      src={['lib/app/docks/inspectors/ControllerDiscovery', 'lib/app/docks/inspectors/AdoptByIpRow']}
      note="The 'different IP addresses' guide plus manual adopt — what an operator needs when Discover finds nothing: this PC's adapter subnet, a concrete IP to set the box to (one-tap copy), and a way to adopt a known address anyway. The panel renders it at BOTH moments that call for it: under a LOST alert, and in the un-adopted branch. With no adapter known the card hides and the adopt row stands alone, which still works."
    >
      <div class="ctrl-child-demo">
        <ControllerDiscovery recommendation={ctrlRecommendation} onAdopt={noop} />
      </div>
    </DemoCard>

    <DemoCard
      title="Controller readout"
      src={['lib/app/docks/inspectors/ControllerReadout', 'lib/app/docks/inspectors/UniverseRxTable']}
      note="The adopted box's own numbers and the only part of the panel with no actions at all: identity (name / model / firmware / IP), then live health (frame rates, temperature, bank voltage, ethernet links), then per-universe rx. The em-dashes in the second copy are a LOST controller: an unmeasurable reading renders as a dash, never as a zero or a loading state. NB — the server does not actually clear these on a lost poll; it FREEZES the last-known universes, rates and health while flipping reachable false (controller-monitor.ts pollOnce), so a real LOST readout shows stale-but-real numbers. This stub blanks rates and health to make the dash treatment visible, and is the more legible demo rather than the faithful one."
    >
      <div class="ctrl-child-demo">
        <ControllerReadout controller={ctrlReceiving} />
        <ControllerReadout controller={ctrlLost} />
      </div>
    </DemoCard>

    <DemoCard
      title="Controller admin password (R29)"
      src="lib/app/docks/inspectors/ControllerAuthField"
      note="The one credential field on the panel. It never shows a stored value — only the server-side hash is kept — so it reads empty and clears after each set. The hint is derived from the device's own authReqd plus whether we're reaching it, never from a local 'did we set one?' flag that would lie the moment the box is re-flashed. When the device demands a password we don't have, the label takes the warn tone and the hint stops apologising and states the requirement."
    >
      <div class="ctrl-child-demo">
        <ControllerAuthField onSetAuth={noop} />
        <ControllerAuthField authReqd reachable onSetAuth={noop} />
        <ControllerAuthField authReqd onSetAuth={noop} />
      </div>
    </DemoCard>

    <DemoCard
      title="Controller test patterns (S49)"
      src="lib/app/docks/inspectors/ControllerTestPatterns"
      note="Drives the controller's built-in test-data mode with no input source. The solid swatches double as the 'set colour' affordance — one click sends setColor across all ports and pixels, and White carries the W channel so an RGBW rig's white LEDs light too. Starting any pattern takes the box over, so the running control stays lit in the warn family, tying back to the banner above; the trailing Live button is dead until something IS running."
    >
      <div class="ctrl-child-demo">
        <ControllerTestPatterns onTestData={noop} onBackToLive={noop} />
        <ControllerTestPatterns takeover={{ op: 'setColor', color: [255, 0, 0, 0] }} onTestData={noop} onBackToLive={noop} />
        <ControllerTestPatterns takeover={{ op: 'rgbwCycle' }} onTestData={noop} onBackToLive={noop} />
      </div>
    </DemoCard>

    <DemoCard
      title="Controller candidates"
      src="lib/app/docks/inspectors/ControllerCandidates"
      note="What Discover found — the panel's trailing block, answering one question ('what is out there?') three mutually exclusive ways: a ranked candidate list with Adopt-IP per row, a scanning-in-progress hint with a spinning radar, or the nothing-adopted-yet explainer. It renders whether or not a controller is already adopted, since a re-scan lists the neighbours too; `adopted` only decides whether the empty state explains Discover or says nothing at all."
    >
      <div class="ctrl-child-demo">
        <ControllerCandidates candidates={ctrlCandidates} onAdopt={noop} />
        <ControllerCandidates candidates={[]} scanning />
        <ControllerCandidates candidates={[]} />
      </div>
    </DemoCard>

    <DemoCard
      title="Adopt-by-IP row"
      src="lib/app/docks/inspectors/AdoptByIpRow"
      note="Extracted from the controller panel: a labelled IP input + Adopt, for connecting to a known controller Discover can't see. The placeholder seeds from the recommended IP so the 'set the box, then adopt it' flow reads in one glance; the Adopt button stays disabled until a host is typed. Pure — draft in, host out via onAdopt."
    >
      <div class="adopt-demo">
        <AdoptByIpRow recommendedIp={ctrlRecommendation.recommendedIp} onAdopt={noop} />
      </div>
    </DemoCard>

    <DemoCard
      title="Universe rx table"
      src={['lib/app/docks/inspectors/UniverseRxTable', 'lib/app/docks/inspectors/output-status']}
      note="Extracted from the controller panel: per-universe receive status — number, protocol, and grouped good/bad packet counts (+ priority). A dead universe tints its whole row in the live family so a single bad one is unmissable. Pure — the universe list in, nothing out; renders nothing when empty."
    >
      <div class="uni-demo">
        <UniverseRxTable universes={ctrlReceiving.universes} />
        <UniverseRxTable universes={ctrlNotReceiving.universes} />
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

    <DemoCard
      title="Boot overlay"
      src={['lib/app/chrome/BootOverlay', 'lib/app/chrome/boot-overlay']}
      note="Desktop-only full-screen takeover driven by the desktop bridge's bootStatus: a spinner while starting, a progress bar (streamed %, tabular numbers, indeterminate when unknown) while updating, a danger panel on error. Renders nothing in a plain browser or once running. Framed here; in the app it covers the whole viewport."
      wide
    >
      <div class="boot-row">
        <div class="boot-frame"><BootOverlay active status={boot({ stage: 'starting' })} /></div>
        <div class="boot-frame"><BootOverlay active status={boot({ stage: 'updating', progressPct: 62 })} /></div>
        <div class="boot-frame">
          <BootOverlay active status={boot({ stage: 'error', message: 'The server failed to start. Quit and reopen the app.' })} />
        </div>
      </div>
    </DemoCard>

    <DemoCard
      title="Recovery banner"
      src={['lib/app/chrome/RecoveryBanner', 'lib/app/chrome/recovery-banner']}
      note="Blocking acknowledgement banner shown when the server's boot ladder had to recover the live project (Decision 8). Warn-toned, top-anchored over a scrim; no Esc / outside-click exit — the single Got it action is the only way out and dismisses it for the browser session. Both rungs shown: recovered from a backup snapshot, and started from a fresh default when no snapshot was readable. Framed here; in the app it covers the whole viewport."
      wide
    >
      <div class="boot-row">
        <div class="boot-frame">
          <RecoveryBanner recovery={{ source: 'snapshot', reason: 'SyntaxError: Unexpected end of JSON input' }} ackStore={null} autofocus={false} />
        </div>
        <div class="boot-frame">
          <RecoveryBanner recovery={{ source: 'recovered-seed', reason: 'ZodError: kit.hoops — expected array' }} ackStore={null} autofocus={false} />
        </div>
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
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
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
  /* Three states side by side at the panel's real width (it lives in the Settings dialog). */
  .osc-demo {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-4);
    align-items: start;
  }
  .panel-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--space-4) var(--space-5);
    align-items: start;
  }
  /* The controller children stack their states vertically at the panel's own gap, so each card
     reads as "the same component, three moments" rather than three unrelated things in a row. */
  .ctrl-child-demo {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: stretch;
  }
  .insp-demo {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 300px;
  }
  /* Sit the strip on a canvas-like inset so it reads as it does over the graph surface. */
  .lint-demo {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 440px;
    padding: var(--space-3);
    border-radius: var(--radius-3);
    background: var(--surface-inset);
  }
  .readrows {
    display: flex;
    flex-direction: column;
  }
  .adopt-demo {
    max-width: 300px;
  }
  .uni-demo {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 300px;
  }
  .monitor-demo {
    height: 260px;
  }
  .boot-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-4);
  }
  .boot-frame {
    position: relative;
    height: 260px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-3);
    overflow: hidden;
    /* Establish a containing block so the overlay's position:fixed scopes to this frame, not the
       viewport — lets the REAL component render inside the styleguide (no markup copy). */
    transform: translateZ(0);
  }
</style>
