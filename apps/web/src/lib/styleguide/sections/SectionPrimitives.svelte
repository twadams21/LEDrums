<script lang="ts">
  /* Every lib/ui primitive, rendered live with variants + interaction states.
     Each card's chip copies the component's repo-relative source path (resolved
     through the build-time manifest — see ../source-pointer). */
  import TextField from '../../ui/TextField.svelte';
  import SearchField from '../../ui/SearchField.svelte';
  import Select from '../../ui/Select.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import EasePicker, { type EaseSpec } from '../../ui/EasePicker.svelte';
  import Tabs from '../../ui/Tabs.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import Switch from '../../ui/Switch.svelte';
  import Slider from '../../ui/Slider.svelte';
  import ColorSwatch from '../../ui/ColorSwatch.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import Field from '../../ui/Field.svelte';
  import Separator from '../../ui/Separator.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import StatusDot from '../../ui/StatusDot.svelte';
  import InputActivityBadge from '../../ui/InputActivityBadge.svelte';
  import ListItem from '../../ui/ListItem.svelte';
  import EditableRow from '../../ui/EditableRow.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';
  import Drawer from '../../ui/Drawer.svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import Logo from '../../ui/Logo.svelte';
  import ToastHost from '../../ui/ToastHost.svelte';
  import { pushToast } from '../../ui/toast.svelte';
  import Splitter from '../../ui/Splitter.svelte';
  import MasterDetail from '../../ui/MasterDetail.svelte';
  import DemoCard from '../DemoCard.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Copy from '@lucide/svelte/icons/copy';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import Layers from '@lucide/svelte/icons/layers';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Cable from '@lucide/svelte/icons/cable';
  import Radio from '@lucide/svelte/icons/radio';
  import Disc3 from '@lucide/svelte/icons/disc-3';
  import Activity from '@lucide/svelte/icons/activity';
  import Wand2 from '@lucide/svelte/icons/wand-2';

  let textVal = $state('Opening set');
  let searchVal = $state('');
  let renameVal = $state('Kick base');
  let bpm = $state('120');
  let protocol = $state('artnet');
  let mode = $state('arrange');
  let layerBus = $state('trigger');
  let inspectorTab = $state('layers');
  let armed = $state(true);
  let broadcast = $state(false);
  let opacity = $state(48);
  // Colour swatch demo — the swatch and the three sliders write through to the same hsv.
  let swHue = $state(30);
  let swSat = $state(1);
  let swBri = $state(1);
  let layerName = $state('Kick layer');
  let rowEditing = $state(false);
  let dialogOpen = $state(false);
  let confirmOpen = $state(false);
  let drawerOpen = $state(false);
  let railW = $state(160);
  let mdSelected = $state('songs');
  let demoEase = $state<EaseSpec>({ fn: 'cubic', dir: 'inOut' });

  const protocolOptions = [
    { value: 'artnet', label: 'Art-Net', icon: Cable },
    { value: 'sacn', label: 'sACN', icon: Radio },
  ];
  const modeOptions = [
    { value: 'perform', label: 'Perform' },
    { value: 'arrange', label: 'Arrange' },
    { value: 'settings', label: 'Settings' },
  ];
  const busOptions = [
    { value: 'base', label: 'Base', icon: Disc3 },
    { value: 'trigger', label: 'Trigger', icon: Activity },
    { value: 'effect', label: 'Effect', icon: Wand2 },
  ];
  const inspectorTabs = [
    { value: 'layers', label: 'Layers', icon: Layers },
    { value: 'effects', label: 'Effects', icon: Sparkles },
    { value: 'output', label: 'Output', icon: Cable },
  ];
  const rowActions: ContextMenuAction[] = [
    { label: 'Duplicate', icon: Copy, onSelect: () => {} },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => {} },
  ];
  const mdTypes = [
    { id: 'songs', label: 'Songs', icon: ListMusic },
    { id: 'effects', label: 'Effects', icon: Sparkles },
    { id: 'graphs', label: 'Graphs', icon: Activity },
  ];
</script>

<section class="block" id="primitives">
  <div class="block-head">
    <h2>Primitives — lib/ui</h2>
    <p>
      The real components every panel composes from — interactive, try them. Hover, focus
      (Tab) and disabled states are the shipped ones, not mockups.
    </p>
  </div>

  <div class="comp-grid">
    <DemoCard title="Buttons" src="app" note="Base &lt;button&gt; vocabulary from app.css: primary / default / ghost / danger / .active toggle / disabled.">
      <div class="comp-row">
        <button class="primary">Primary</button>
        <button>Default</button>
        <button class="ghost">Ghost</button>
        <button class="danger">Disarm</button>
        <button class="active">Toggled</button>
        <button disabled>Disabled</button>
      </div>
    </DemoCard>

    <DemoCard title="Icon buttons · Tooltip" src={['lib/ui/IconButton', 'lib/ui/Tooltip']}>
      <div class="comp-row">
        <IconButton icon={Play} label="Play" variant="solid" />
        <IconButton icon={Plus} label="Add" variant="soft" />
        <IconButton icon={Pencil} label="Rename" />
        <IconButton icon={Trash2} label="Delete" />
        <Separator orientation="vertical" />
        <Tooltip text="A custom tooltip">
          <button class="ghost">Hover me</button>
        </Tooltip>
      </div>
    </DemoCard>

    <DemoCard title="Text fields" src={['lib/ui/TextField', 'lib/ui/SearchField', 'lib/ui/Field']}>
      <div class="comp-stack">
        <Field label="Show name" hint="Plain bindable input">
          <TextField bind:value={textVal} placeholder="Untitled show…" ariaLabel="Show name" />
        </Field>
        <SearchField bind:value={searchVal} placeholder="Search shows…" />
      </div>
    </DemoCard>

    <DemoCard
      title="Field · row layout"
      src="lib/ui/Field"
      note="The inspector rhythm: label column left (--field-label-col), control right, one --control-h height across TextField / CommitInput / Select. Hint renders under the control. Use layout=&quot;row&quot; in every inspector/editor panel; the stacked default is for dialogs and wide forms."
    >
      <div class="comp-stack">
        <Field layout="row" label="Name" hint="display label">
          <TextField bind:value={textVal} placeholder="Untitled" ariaLabel="Row name" />
        </Field>
        <Field layout="row" label="Protocol">
          <Select bind:value={protocol} options={protocolOptions} ariaLabel="Row protocol" />
        </Field>
        <Field layout="row" label="BPM" hint="Clamped number 20–300">
          <CommitInput type="number" min={20} max={300} value={bpm} suffix="bpm" ariaLabel="Row BPM" autofocus={false} onCommit={(v) => (bpm = v)} />
        </Field>
      </div>
    </DemoCard>

    <DemoCard title="Commit input" src="lib/ui/CommitInput" note="Inline rename / numeric entry: commits on Enter or blur, reverts on Esc.">
      <div class="comp-stack">
        <Field label="Inline rename">
          <CommitInput
            value={renameVal}
            ariaLabel="Layer name"
            autofocus={false}
            onCommit={(v) => (renameVal = v)}
          />
        </Field>
        <Field label="BPM" hint="Clamped number 20–300">
          <CommitInput
            type="number"
            min={20}
            max={300}
            value={bpm}
            suffix="bpm"
            ariaLabel="BPM"
            onCommit={(v) => (bpm = v)}
          />
        </Field>
      </div>
    </DemoCard>

    <DemoCard title="Selection" src={['lib/ui/Select', 'lib/ui/SegmentedControl', 'lib/ui/Tabs']}>
      <div class="comp-stack">
        <Field label="Protocol">
          <Select bind:value={protocol} options={protocolOptions} ariaLabel="Protocol" />
        </Field>
        <SegmentedControl value={mode} options={modeOptions} onChange={(v) => (mode = v)} ariaLabel="Mode" />
        <SegmentedControl value={layerBus} options={busOptions} onChange={(v) => (layerBus = v)} ariaLabel="Layer bus" />
        <Tabs bind:value={inspectorTab} tabs={inspectorTabs} ariaLabel="Inspector" />
      </div>
    </DemoCard>

    <DemoCard
      title="Ease picker"
      src="lib/ui/EasePicker"
      note="Compact per-segment easing selector — a family Select (the Resolume-familiar set, grouped) paired with an In/Out/In·Out direction control. Direction disables for Linear (identical in every direction). Composed from Select + SegmentedControl; reused by the envelope editor and the Envelope node inspector."
    >
      <div class="comp-stack">
        <EasePicker value={demoEase} onChange={(e) => (demoEase = e)} ariaLabel="Demo easing" />
        <p class="ease-readout">{demoEase.fn} · {demoEase.dir}</p>
      </div>
    </DemoCard>

    <DemoCard title="Toggles · Slider" src={['lib/ui/Toggle', 'lib/ui/Switch', 'lib/ui/Slider']}>
      <div class="comp-row">
        <Toggle bind:pressed={armed} onLabel="armed" offLabel="safe" ariaLabel="Arm output" />
        <Switch bind:checked={broadcast} ariaLabel="Broadcast" />
      </div>
      <Slider bind:value={opacity} min={0} max={100} ariaLabel="Opacity" format={(v) => `${v}%`} />
    </DemoCard>

    <DemoCard title="Colour swatch" src="lib/ui/ColorSwatch" note="Write-through colour well over hue/saturation/brightness. The swatch and the three sliders drive the same values — move either. Saturation 0 → white. A modulated param shows an env badge on the base colour instead of animating.">
      <ColorSwatch
        hue={swHue}
        saturation={swSat}
        brightness={swBri}
        ariaLabel="Demo colour"
        onChange={(hsv) => {
          swHue = hsv.h;
          swSat = hsv.s;
          swBri = hsv.v;
        }}
      />
      <div class="sw-sliders">
        <Slider bind:value={swHue} min={0} max={360} step={1} ariaLabel="Hue" format={(v) => `${Math.round(v)}°`} />
        <Slider bind:value={swSat} min={0} max={1} step={0.01} ariaLabel="Saturation" format={(v) => v.toFixed(2)} />
        <Slider bind:value={swBri} min={0} max={1} step={0.01} ariaLabel="Brightness" format={(v) => v.toFixed(2)} />
      </div>
      <ColorSwatch hue={swHue} saturation={swSat} brightness={swBri} modulated ariaLabel="Demo colour (modulated)" />
    </DemoCard>

    <DemoCard title="Status" src={['lib/ui/StatusPill', 'lib/ui/StatusDot']}>
      <div class="comp-row">
        <StatusPill tone="ok" label="Connected" />
        <StatusPill tone="live" label="LIVE" pulse />
        <StatusPill tone="warn" label="Dry-run" />
        <StatusPill tone="accent" label="Saving" pulse />
        <StatusPill tone="muted" label="Idle" />
      </div>
      <div class="comp-row">
        <span class="dot-demo"><StatusDot tone="ok" /> ok</span>
        <span class="dot-demo"><StatusDot tone="live" pulse /> live</span>
        <span class="dot-demo"><StatusDot tone="warn" /> warn</span>
      </div>
    </DemoCard>

    <DemoCard
      title="Input activity badge"
      src="lib/ui/InputActivityBadge"
      note="Last-heard confirmation beside a MIDI/OSC binding: identity · value · age. Fresh hit pulses (live); fades to muted as it ages out. Fed by a pure matcher; the store owns the age clock."
    >
      <div class="comp-row">
        <InputActivityBadge label="C4" value="92" age="now" tone="live" fresh title="Last heard C4 · velocity 92 · now ago" />
        <InputActivityBadge label="/kick" value="0.75" age="3s" tone="live" title="Last heard /kick · 0.75 · 3s ago" />
        <InputActivityBadge label="D2" value="41" age="2m" tone="muted" title="Last heard D2 · velocity 41 · 2m ago" />
      </div>
    </DemoCard>

    <DemoCard title="Splitter" src="lib/ui/Splitter" note="Drag the divider, or focus it and use arrow keys / Home / End. Hover thickens + tints it so it stays discoverable even where modules sit flush (no gutter). Controlled: the caller owns + persists the px size.">
      <div class="split-demo">
        <div class="split-pane" style="width: {railW}px">rail · {railW}px</div>
        <div class="split-pane grow">content</div>
        <Splitter
          orientation="vertical"
          size={railW}
          onResize={(n) => (railW = n)}
          min={100}
          max={260}
          label="Demo rail width"
          style="left: {railW}px; top: 0; bottom: 0;"
        />
      </div>
    </DemoCard>

    <DemoCard title="Master–detail" src="lib/ui/MasterDetail" note="The Sections/Objects scaffold: left selector rail + detail pane; selection is bindable.">
      <div class="md-demo">
        <MasterDetail bind:selected={mdSelected} railLabel="Object types" railWidth="132px">
          {#snippet master({ selected, select })}
            {#each mdTypes as t (t.id)}
              <ListItem icon={t.icon} label={t.label} active={selected === t.id} onclick={() => select(t.id)} />
            {/each}
          {/snippet}
          {#snippet detail({ selected })}
            <div class="md-detail-body">
              <span class="md-current">{selected}</span>
              <p>Detail pane tracks the rail selection.</p>
            </div>
          {/snippet}
        </MasterDetail>
      </div>
    </DemoCard>

    <DemoCard
      title="List rows"
      src={['lib/ui/ListItem', 'lib/ui/EditableRow']}
      note="Right-click a row for its context menu · double-click the last row to rename."
      wide
    >
      <div class="comp-rows">
        <ListItem icon={ListMusic} label="Opening set" secondary="6 sections" active onclick={() => {}}>
          {#snippet actions()}
            <IconButton icon={Copy} label="Duplicate" onclick={() => {}} />
            <IconButton icon={Trash2} label="Delete" onclick={() => {}} />
          {/snippet}
        </ListItem>
        <ListItem icon={ListMusic} label="Encore" secondary="2 sections" onclick={() => {}} />
        <EditableRow
          icon={Layers}
          label={layerName}
          bind:editing={rowEditing}
          onCommit={(v) => (layerName = v)}
          actions={rowActions}
          renameLabel="Layer name"
          onclick={() => {}}
        />
      </div>
    </DemoCard>

    <DemoCard
      title="Panel header"
      src="lib/ui/PanelHeader"
      wide
      note="THE panel-title treatment (accent icon + tracked uppercase label, trailing controls). Used on every docked panel, rail, and drawer — retired Eyebrow as a panel title (Eyebrow stays for small in-content labels)."
    >
      <div class="ph-demo">
        <PanelHeader icon={Layers} title="Buses / Layers" />
      </div>
      <div class="ph-demo">
        <PanelHeader icon={ListMusic} title="Setlist">
          <IconButton icon={Plus} label="Add song" size={14} />
        </PanelHeader>
      </div>
    </DemoCard>

    <DemoCard title="Logo / mark" src="lib/ui/Logo" note="Neon-rainbow drum kit (kick, snare, two rack toms, floor tom, hi-hat, ride) on a dark rounded tile — a vector trace of the desktop app icon, re-coloured with a fixed brand gradient + soft glow so the mark matches the dock icon in any theme. Detailed by design; richest from ~32px up.">
      <div class="comp-row" style="align-items:center; gap:var(--space-4)">
        <Logo size={20} />
        <Logo size={32} />
        <Logo size={48} />
        <Logo size={96} />
      </div>
    </DemoCard>

    <DemoCard title="Overlays" src={['lib/ui/ContextMenu', 'lib/ui/Dialog', 'lib/ui/ConfirmDialog', 'lib/ui/Drawer']} wide>
      <div class="comp-row">
        <ContextMenu actions={rowActions}>
          <button class="ghost">Right-click target</button>
        </ContextMenu>
        <button onclick={() => (dialogOpen = true)}>Open dialog…</button>
        <button class="danger" onclick={() => (confirmOpen = true)}>Confirm…</button>
        <button onclick={() => (drawerOpen = true)}>Open drawer…</button>
      </div>
    </DemoCard>

    <DemoCard
      title="Toast"
      src="lib/ui/ToastHost"
      note="Transient notifications: a singleton store (pushToast) + one ToastHost near the app root. Role colour always rides an icon + text; each is dismissible; enter rises + fades, exit is subtler; reduced motion collapses both. Used for clipboard paste feedback (S44)."
    >
      <div class="comp-row">
        <button onclick={() => pushToast('Section copied.', { tone: 'success' })}>Success toast</button>
        <button onclick={() => pushToast('Pasted 3 layers.')}>Info toast</button>
        <button class="danger" onclick={() => pushToast('That clipboard content isn’t from LEDrums.', { tone: 'error' })}>Error toast</button>
      </div>
    </DemoCard>
  </div>
</section>

<Dialog open={dialogOpen} onClose={() => (dialogOpen = false)} title="Example dialog">
  <div class="ov-body">
    <p>A modal <code>Dialog</code> — portaled, focus-trapped, scrim driven by <code>--overlay</code>.</p>
    <Field label="Output bus" hint="A Select inside a Dialog — its dropdown rides above the modal.">
      <Select bind:value={protocol} options={protocolOptions} ariaLabel="Output bus" />
    </Field>
    <div class="comp-row">
      <button class="primary" onclick={() => (dialogOpen = false)}>Done</button>
      <button class="ghost" onclick={() => (dialogOpen = false)}>Cancel</button>
    </div>
  </div>
</Dialog>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Delete node?"
  message="A confirmation modal for destructive verbs — Cancel + a danger confirm, on the shared Dialog."
  confirmLabel="Delete"
  danger
  onConfirm={() => pushToast('Confirmed.', { tone: 'success' })}
/>

<Drawer open={drawerOpen} onClose={() => (drawerOpen = false)} title="Example drawer" side="right" width="320px">
  <p class="ov-text">A slide-in <code>Drawer</code> — same <code>--overlay</code> scrim, <code>--z-overlay</code> tier.</p>
</Drawer>

<!-- One host renders the shared toast store; the demo buttons above push into it. -->
<ToastHost />

<style>
  .comp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-5) var(--space-6);
  }
  .comp-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  /* PanelHeader sits atop a panel — show it in a bordered surface so its border-bottom reads. */
  .ph-demo {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .ph-demo + .ph-demo {
    margin-top: var(--space-3);
  }
  .comp-stack {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .comp-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .ease-readout {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sw-sliders {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-3) 0;
  }
  .dot-demo {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /* Splitter demo — relative box the absolute splitter positions inside */
  .split-demo {
    position: relative;
    display: flex;
    height: 96px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  .split-pane {
    display: grid;
    place-items: center;
    flex: none;
    background: var(--surface-inset);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .split-pane.grow {
    flex: 1;
    background: var(--surface);
  }

  /* MasterDetail demo — the primitive expects a bounded height */
  .md-demo {
    height: 170px;
  }
  .md-detail-body {
    padding: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .md-current {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .ov-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    width: min(360px, 82vw);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .ov-text {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
</style>
