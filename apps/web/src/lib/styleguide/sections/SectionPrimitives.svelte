<script lang="ts">
  /* Every lib/ui primitive, rendered live with variants + interaction states.
     Each card's chip copies the component's repo-relative source path (resolved
     through the build-time manifest — see ../source-pointer). */
  import TextField from '../../ui/TextField.svelte';
  import SearchField from '../../ui/SearchField.svelte';
  import Select from '../../ui/Select.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import EasePicker, { type EaseSpec } from '../../ui/EasePicker.svelte';
  import CurveField, { type CurveHit, type CurveValue } from '../../ui/CurveField.svelte';
  import CurveFieldMini from '../../ui/CurveFieldMini.svelte';
  import Tabs from '../../ui/Tabs.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import Switch from '../../ui/Switch.svelte';
  import Slider from '../../ui/Slider.svelte';
  import ColorSwatch from '../../ui/ColorSwatch.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import Field from '../../ui/Field.svelte';
  import Separator from '../../ui/Separator.svelte';
  import Disclosure from '../../ui/Disclosure.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import Pill from '../../ui/Pill.svelte';
  import StatusDot from '../../ui/StatusDot.svelte';
  import InputActivityBadge from '../../ui/InputActivityBadge.svelte';
  import LearnButton from '../../ui/LearnButton.svelte';
  import CopyableValue from '../../ui/CopyableValue.svelte';
  import ListItem from '../../ui/ListItem.svelte';
  import EditableRow from '../../ui/EditableRow.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';
  import Drawer from '../../ui/Drawer.svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import AnchorHeader from '../../ui/AnchorHeader.svelte';
  import LintCallout from '../../ui/LintCallout.svelte';
  import Logo from '../../ui/Logo.svelte';
  import ToastHost from '../../ui/ToastHost.svelte';
  import { pushToast } from '../../ui/toast.svelte';
  import Splitter from '../../ui/Splitter.svelte';
  import MasterDetail from '../../ui/MasterDetail.svelte';
  import DemoCard from '../DemoCard.svelte';
  import TypeChip from '../../ui/TypeChip.svelte';
  import ListHead from '../../ui/ListHead.svelte';
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
  import CircleDot from '@lucide/svelte/icons/circle-dot';
  import Zap from '@lucide/svelte/icons/zap';

  let textVal = $state('Opening set');
  let pillTags = $state<string[]>(['hit']);
  let searchVal = $state('');
  let renameVal = $state('Kick base');
  let bpm = $state('120');
  let learnArmed = $state(false);
  let delayMs = $state('250');
  let phase = $state(0.25);
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
  let discOpen = $state(true);
  let discComets = $state(40);
  let discTail = $state(70);

  /* Curve field demos — one per domain the primitive has to serve, and between
     them all three states of the notched strength fader: above centre, below it,
     and greyed. The envelope is time → level; the transfer curves are input
     velocity → output velocity. */
  let decayCurve = $state<CurveValue>({
    h0: { x: 0, y: 1 },
    h1: { x: 0.72, y: 0 },
    profile: 'bend',
    strength: 0.55,
  });
  /* Opens BELOW the notch so the fader's lower half — the log/inverted side, the
     half a unipolar strength control could not reach — is visible at rest. */
  let velocityCurve = $state<CurveValue>({
    h0: { x: 0.12, y: 0 },
    h1: { x: 1, y: 1 },
    profile: 'sCurve',
    strength: -0.5,
  });
  /* A hard gate: snap is the one profile with nothing to bend, so it is what
     shows the strength fader in its disabled (greyed, never hidden) state. */
  let gateCurve = $state<CurveValue>({
    h0: { x: 0.2, y: 0 },
    h1: { x: 0.55, y: 1 },
    profile: 'snap',
    strength: 0,
  });
  /* The live-input overlay wants a drummer. The styleguide fakes one on an
     interval so the markers are visible without a kit plugged in — in the app
     the hits come from the real input feed. */
  let demoHits = $state<CurveHit[]>([]);
  $effect(() => {
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      // A rough four-on-the-floor spread rather than pure noise, so the markers
      // read as playing rather than as static.
      const x = [0.86, 0.42, 0.71, 0.55, 0.94][n % 5]!;
      demoHits = [...demoHits.slice(-11), { x, at: performance.now() }];
    }, 420);
    return () => clearInterval(id);
  });
  /** Today's `exp(−t/τ)` decay — the shape the curve control exists to beat. */
  const todayDecay = (x: number): number => Math.exp(-x * 3.9);

  const protocolOptions = [
    { value: 'artnet', label: 'Art-Net', icon: Cable },
    { value: 'sacn', label: 'sACN', icon: Radio },
  ];
  // ≥5 entries, so this one stays a dropdown — the same component, the other branch of the rule
  const collectionOptions = [
    { value: 'hits', label: 'Hits' },
    { value: 'waves', label: 'Waves & Ripples' },
    { value: 'particles', label: 'Particles & Air' },
    { value: 'textures', label: 'Textures' },
    { value: 'ambient', label: 'Ambient & Base' },
    { value: 'meters', label: 'Meters & Utility' },
  ];
  let collection = $state('hits');
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
    <DemoCard
      title="Type chip · List head"
      src={['lib/ui/TypeChip', 'lib/ui/ListHead']}
      note="The dense-list vocabulary. A TypeChip carries an item's KIND in its role colour — colour identity lives in the chip, never in a whole-row tint, so a long list stays readable and the eye can still group by kind. ListHead is the line above such a list: uppercase mono label, right-aligned count (the count answers 'is this complete?' before you read a row), and room for one control."
      wide
    >
      <div class="listdemo">
        <ListHead label="Zones" count="3 of 8" />
        <div class="listdemo-row"><TypeChip label="trigger" tint="var(--role-input)" /><span>Next song</span></div>
        <div class="listdemo-row"><TypeChip label="continuous" tint="var(--role-modulation)" /><span>Master brightness</span></div>
        <div class="listdemo-row"><TypeChip label="kick" tint="var(--role-layer)" /><span>Hoop 2</span></div>
        <div class="listdemo-row"><TypeChip label="untinted" /><span>Neutral label</span></div>
      </div>
    </DemoCard>

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

    <DemoCard
      title="Field — the Settings form rhythm"
      src={['lib/ui/Field', 'lib/app/settings/forms.css']}
      note="Label ABOVE the control, fields in columns, and NO help text under a field (2026-08-14, Trent). A rule you only need while filling the field rides an ⓘ on the label instead, and a default that changes behaviour goes in the placeholder — 'dense / auto' says more than a grey line under the box ever did. `.set-grid` is the shared 2-up wrapper; a wide field opts out with `.set-wide`."
      wide
    >
      <div class="set-grid">
        <Field label="Start universe" info="Leave blank for dense / automatic packing.">
          <CommitInput type="number" value="" placeholder="dense / auto" ariaLabel="Start universe demo" onCommit={() => {}} />
        </Field>
        <Field label="Channels / pixel" info="3 = RGB · 4 = RGBW">
          <CommitInput type="number" value={3} ariaLabel="Channels per pixel demo" onCommit={() => {}} />
        </Field>
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
      note="The inspector rhythm: label column left (--field-label-col), control right, one --control-h height across TextField / CommitInput / Select. Hint renders under the control; a short unit (ms / Hz / a live %) renders in its own column OUTSIDE the control via the unit prop — for a slider or numeric field whose readout lives beside the box, not inside it (CommitInput's inner suffix). Use layout=&quot;row&quot; in every inspector/editor panel; the stacked default is for dialogs and wide forms."
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
        <Field layout="row" label="Time" unit="ms">
          <CommitInput type="number" min={0} value={delayMs} ariaLabel="Row time" autofocus={false} onCommit={(v) => (delayMs = v)} />
        </Field>
        <Field layout="row" label="Phase" unit={`${Math.round(phase * 100)}%`}>
          <Slider bind:value={phase} min={0} max={1} step={0.01} ariaLabel="Row phase" />
        </Field>
      </div>
    </DemoCard>

    <DemoCard title="Commit input" src="lib/ui/CommitInput" note="Inline rename / numeric entry / masked credential: commits on Enter or blur, reverts on Esc.">
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
        <Field label="Password" hint="Masked credential — never trimmed, never round-tripped; clears after a set">
          <CommitInput
            type="password"
            value=""
            placeholder="••••••••"
            ariaLabel="Admin password"
            onCommit={(v) => (renameVal = v)}
          />
        </Field>
      </div>
    </DemoCard>

    <DemoCard
      title="Learn button"
      src="lib/ui/LearnButton"
      note="Arm a field to bind the next input it hears (MIDI note, OSC address). A TOGGLE, not a one-shot — pressing it while armed disarms, so a mis-armed field is escapable without binding the wrong thing. Stateless: the caller owns the arm, because independent fields can be armed at once (a global control's MIDI and OSC buttons are separate arms). Armed pulses its glyph so a listening row is findable among identical ones; aria-pressed carries the state, and the pulse respects reduced-motion."
    >
      <div class="comp-row">
        <LearnButton armed={false} onclick={() => (learnArmed = !learnArmed)} ariaLabel="Learn demo, idle" />
        <LearnButton armed={true} onclick={() => {}} ariaLabel="Learn demo, listening" />
        <LearnButton armed={false} disabled onclick={() => {}} ariaLabel="Learn demo, disabled" />
      </div>
      <div class="comp-row">
        <Field layout="row" label="MIDI note">
          <span class="learn-demo-row">
            <CommitInput value="C4" mono autofocus={false} ariaLabel="Demo note" onCommit={() => {}} />
            <LearnButton armed={learnArmed} onclick={() => (learnArmed = !learnArmed)} ariaLabel="Learn demo note" />
          </span>
        </Field>
      </div>
    </DemoCard>

    <DemoCard
      title="Selection"
      src={['lib/ui/Select', 'lib/ui/SegmentedControl', 'lib/ui/Tabs']}
      note="Select decides its OWN shape: four options or fewer render as a segmented control (every choice visible, one click to switch), five or more stay a dropdown — so a registry that grows past four reverts by itself and no call site has to choose. Two exclusions: an ACTION picker sitting on a placeholder (&quot;Add parameter…&quot;) has no state to segment, and a list of names the app did not author — user presets, effect and scene names, network interfaces — opts out with segment=&#123;false&#125;, because a segment clips where a trigger ellipsises. An open dropdown may use 80% of the viewport before it scrolls."
    >
      <div class="comp-stack">
        <Field label="Protocol">
          <Select bind:value={protocol} options={protocolOptions} ariaLabel="Protocol" />
        </Field>
        <Field label="Collection">
          <Select bind:value={collection} options={collectionOptions} ariaLabel="Collection" />
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

    <DemoCard
      title="Curve field"
      src={['lib/ui/CurveField', 'lib/ui/CurveFieldMini', 'lib/ui/curve-field']}
      wide
      note="Two free handles, one profile for the whole curve, and a BIPOLAR strength fader with a magnetic notch at centre. The notch is linear; above it Bend goes exponential and below it logarithmic — the inverse shape — so lin/exp/log are one continuum with one neutral position rather than three buttons, and the mode word under the fader is read back off the fader rather than picked. S-curve rides the same fader and goes over centre to invert its shoulders (in-out ↔ out-in); Snap has nothing to bend, so the fader greys out (never hidden). Flat outside the handles, so a hold or a threshold needs no third handle. Domain-agnostic: the value is normalised 0..1 in both axes (strength −1..+1) and the consumer owns the units. Drag a handle, or click it and use the arrow keys (shift = coarse); wheel over the plot steps the selected handle's level. The mini renders the same value read-only at node-face size."
    >
      <div class="curve-demo">
        <div class="curve-col">
          <span class="curve-cap">envelope · time → level · exp, decay ghosted</span>
          <CurveField
            value={decayCurve}
            onChange={(v) => (decayCurve = v)}
            xAxis={{ label: 'life', format: (u) => `${Math.round(u * 1200)} ms` }}
            yAxis={{ label: 'level' }}
            ghost={todayDecay}
            ariaLabel="Decay envelope"
          />
        </div>
        <div class="curve-col">
          <span class="curve-cap">transfer · velocity in → out · s-curve, inverted</span>
          <CurveField
            value={velocityCurve}
            onChange={(v) => (velocityCurve = v)}
            xAxis={{ label: 'in', format: (u) => String(Math.round(u * 127)) }}
            yAxis={{ label: 'out', format: (u) => String(Math.round(u * 127)) }}
            hits={demoHits}
            hitFadeMs={2400}
            showPreview={false}
            ariaLabel="Velocity sensitivity"
          />
        </div>
        <div class="curve-col">
          <span class="curve-cap">gate · velocity in → out · snap, fader greyed</span>
          <CurveField
            value={gateCurve}
            onChange={(v) => (gateCurve = v)}
            xAxis={{ label: 'in', format: (u) => String(Math.round(u * 127)) }}
            yAxis={{ label: 'out', format: (u) => String(Math.round(u * 127)) }}
            showPreview={false}
            ariaLabel="Velocity gate"
          />
        </div>
      </div>
      <div class="curve-minis">
        <span class="curve-cap">node faces (56×32, read-only)</span>
        <CurveFieldMini value={decayCurve} ariaLabel="Decay envelope thumbnail" />
        <CurveFieldMini value={velocityCurve} ariaLabel="Velocity curve thumbnail" />
        <CurveFieldMini
          value={{ h0: { x: 0, y: 1 }, h1: { x: 0.85, y: 0 }, profile: 'bend', strength: -0.7 }}
          ariaLabel="Log envelope thumbnail"
        />
        <CurveFieldMini value={gateCurve} ariaLabel="Snap gate thumbnail" />
      </div>
    </DemoCard>

    <DemoCard
      title="Toggles · Slider"
      src={['lib/ui/Toggle', 'lib/ui/Switch', 'lib/ui/Slider', 'lib/ui/format-unit']}
      note="The Slider's box shows the FORMATTER's own rendering of the number (a 0.01-step param reads 0.60, trailing zero included) and splitValueUnit peels the unit off the end — it used to slice the formatted text at the length of its own rendering, which left a stray 0 sitting outside the box. A format that RESCALES the value (0…1 shown as a percentage) keeps the real value in the box, because the box commits what it shows. Pass showUnit=&#123;false&#125; where the caller carries the unit elsewhere — inspector rows put it on the param label, so every number input in a section shares one column."
    >
      <div class="comp-row">
        <Toggle bind:pressed={armed} onLabel="armed" offLabel="safe" ariaLabel="Arm output" />
        <Switch bind:checked={broadcast} ariaLabel="Broadcast" />
      </div>
      <Slider bind:value={opacity} min={0} max={100} ariaLabel="Opacity" format={(v) => `${v}%`} />
      <Slider value={0.6} min={0} max={1} step={0.01} ariaLabel="Depth" format={(v) => `${v.toFixed(2)}×`} />
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
      title="Pill"
      src="lib/ui/Pill"
      note="Small tag/label pill. Static (span) for read-only tags + count badges; interactive (button + selected) for filter chips. Used across the effect gallery cards + filter row."
    >
      <div class="comp-row">
        <Pill label="hit" />
        <Pill label="3d" />
        <Pill tone="accent" label="6 params" />
      </div>
      <div class="comp-row">
        {#each ['hit', 'wave', 'particle', 'texture'] as t (t)}
          <Pill
            label={t}
            selected={pillTags.includes(t)}
            onclick={() => (pillTags = pillTags.includes(t) ? pillTags.filter((x) => x !== t) : [...pillTags, t])}
          />
        {/each}
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

    <DemoCard
      title="Copyable value"
      src="lib/ui/CopyableValue"
      note="A value the user must retype into ANOTHER app — a share URL, a room PIN, an OSC host:port for Sensory Percussion. Mono + tabular + select-all, with a copy button that cross-fades to a check for a beat. If the Clipboard API is missing it does not flash success; the value stays selectable."
    >
      <div class="comp-stack">
        <CopyableValue value="192.168.1.20:9000" copyLabel="Copy OSC address 192.168.1.20:9000" />
        <CopyableValue label="PIN" value="481920" />
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
      title="Disclosure"
      src="lib/ui/Disclosure"
      wide
      note="Progressive disclosure for a secondary group of rows — eyebrow-styled summary, rotating chevron, optional count, over a native <details> (so keyboard + find-in-page work for free). `open` is bindable: the CALLER owns whether the state is remembered and where, so the primitive never invents a persistence surface. Used by the effect inspector to fold an effect's own params under its always-visible common section."
    >
      <div class="disc-demo">
        <Disclosure label="Comet Trails" count={4} open={discOpen} onToggle={(v) => (discOpen = v)}>
          <div class="disc-rows">
            <Slider value={discComets} min={0} max={100} onChange={(v) => (discComets = v)} ariaLabel="Comets" />
            <Slider value={discTail} min={0} max={100} onChange={(v) => (discTail = v)} ariaLabel="Tail" />
          </div>
        </Disclosure>
        <Disclosure label="Empty group" count={0} open={false}>
          <div class="disc-rows"><span class="disc-none">This effect has no parameters of its own.</span></div>
        </Disclosure>
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

    <DemoCard
      title="Anchor header"
      src="lib/ui/AnchorHeader"
      wide
      note="Inspector title block for a PROTECTED graph anchor (the trigger root / output terminal). Those nodes aren't conversion targets, so they can't carry the shared kind selector — this is its stand-in: tinted icon + h3 title, mono sub-line, optional trailing action. Same scale as the patch / trigger headers."
    >
      <div class="ph-demo">
        <AnchorHeader icon={CircleDot} tint="var(--role-output)" title="Output" sub="graph output — every layer lands here" />
      </div>
      <div class="ph-demo">
        <AnchorHeader icon={Zap} tint="var(--accent)" title="Kick · Centre" sub="graph input">
          {#snippet action()}
            <IconButton icon={Copy} label="Duplicate graph" variant="soft" size={14} />
          {/snippet}
        </AnchorHeader>
      </div>
    </DemoCard>

    <DemoCard
      title="Lint callout"
      src="lib/ui/LintCallout"
      note="Warn-toned inspector row for a node's render-plan lint finding (empty scope, not reaching Output, dead branch). Glyph + plain problem + one next step, copy shared with the lint strip and node badge so a finding reads identically everywhere. Warn, never the red fault alarm — it guides authoring."
    >
      <div class="ph-demo">
        <LintCallout problem="Not reaching Output" action="Wire this into the Output node so what it renders can light." />
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
      note="Transient notifications: a singleton store (pushToast) + one ToastHost near the app root. A top-centre stack; role rides an icon + text + a slight tone-tinted background wash (never colour alone); each is dismissible; enter descends + fades, exit is subtler; reduced motion collapses both. Used for clipboard paste feedback (S44)."
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
  .listdemo {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .listdemo-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 30px;
    padding: 3px var(--space-2);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    color: var(--text);
  }
  .listdemo-row + .listdemo-row {
    box-shadow: inset 0 1px 0 color-mix(in oklch, var(--border-faint) 60%, transparent);
  }
  .listdemo-row:hover {
    background: var(--surface-2);
  }
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
  /* The real shape a Learn button ships in: an input plus its arm, on one row. */
  .learn-demo-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
    width: 100%;
    min-width: 0;
  }
  /* Disclosure draws its own top border — show it inside a panel surface so it reads as a
     section divider, the way it does in the inspector. */
  .disc-demo {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .disc-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-3);
  }
  .disc-none {
    font-size: var(--text-2xs);
    color: var(--text-faint);
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

  /* Curve field demo — two domains side by side, each capped near the inspector
     width the control actually has to survive at. */
  .curve-demo {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
  }
  .curve-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1 1 300px;
    min-width: 0;
    max-width: 340px;
  }
  .curve-cap {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-label);
  }
  .curve-minis {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
</style>
