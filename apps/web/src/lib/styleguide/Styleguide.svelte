<script lang="ts">
  /* Living styleguide for the LEDrums design system. Pure presentational — no
     store, no WS. Open at `/?style`. Used as the accent-decision checkpoint.
     The Components block below demos the REAL lib/ui primitives. */
  import TextField from '../ui/TextField.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import Select from '../ui/Select.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import Switch from '../ui/Switch.svelte';
  import Slider from '../ui/Slider.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import CommitInput from '../ui/CommitInput.svelte';
  import Field from '../ui/Field.svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import Separator from '../ui/Separator.svelte';
  import Tooltip from '../ui/Tooltip.svelte';
  import StatusPill from '../ui/StatusPill.svelte';
  import StatusDot from '../ui/StatusDot.svelte';
  import ListItem from '../ui/ListItem.svelte';
  import EditableRow from '../ui/EditableRow.svelte';
  import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu.svelte';
  import Dialog from '../ui/Dialog.svelte';
  import Drawer from '../ui/Drawer.svelte';
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

  const accents = [
    { id: 'violet', name: 'Electric violet', note: 'synth heritage · off the RGB triad' },
    { id: 'amber', name: 'Warm amber', note: 'console / VU heritage · warmest' },
    { id: 'lime', name: 'Phosphor lime', note: 'scope heritage · most alive' },
  ] as const;

  const elevations = [
    ['--bg-perform', 'Perform stage'],
    ['--bg', 'App canvas'],
    ['--surface', 'Panel'],
    ['--surface-2', 'Raised'],
    ['--surface-3', 'Overlay'],
    ['--surface-inset', 'Inset well'],
  ];

  const inkRamp = [
    ['--ink', 'Ink — headings', '16.2:1'],
    ['--text', 'Text — body', '13.4:1'],
    ['--text-muted', 'Muted — secondary', '8.6:1'],
    ['--text-faint', 'Faint — meta / labels', '5.9:1'],
    ['--text-disabled', 'Disabled', '3.8:1'],
  ];

  const roles = [
    { v: '--role-input', label: 'Input', glyph: 'input' },
    { v: '--role-content', label: 'Content', glyph: 'content' },
    { v: '--role-effect', label: 'Effect', glyph: 'effect' },
    { v: '--role-layer', label: 'Layer', glyph: 'layer' },
    { v: '--role-output', label: 'Output', glyph: 'output' },
    { v: '--role-mod', label: 'Modulation', glyph: 'mod' },
  ] as const;

  const type = [
    ['--text-3xl', 'View header', 28],
    ['--text-2xl', 'Section', 23],
    ['--text-xl', 'Subsection', 19],
    ['--text-lg', 'Panel title', 16],
    ['--text-base', 'Body', 13],
    ['--text-sm', 'Control', 12],
    ['--text-xs', 'Label', 11],
  ];

  let fader = $state(65);

  /* ---- Interactive state for the Components block ------------------------- */
  let textVal = $state('Opening set');
  let searchVal = $state('');
  let renameVal = $state('Kick base');
  let bpm = $state('120');
  let protocol = $state('artnet');
  let mode = $state('arrange');
  let inspectorTab = $state('layers');
  let armed = $state(true);
  let broadcast = $state(false);
  let opacity = $state(48);
  let layerName = $state('Kick layer');
  let rowEditing = $state(false);
  let dialogOpen = $state(false);
  let drawerOpen = $state(false);

  const protocolOptions = [
    { value: 'artnet', label: 'Art-Net', icon: Cable },
    { value: 'sacn', label: 'sACN', icon: Radio },
  ];
  const modeOptions = [
    { value: 'perform', label: 'Perform' },
    { value: 'arrange', label: 'Arrange' },
    { value: 'settings', label: 'Settings' },
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
</script>

{#snippet glyph(name: string)}
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if name === 'input'}
      <path d="M2 8h8" /><path d="M7 5l3 3-3 3" /><path d="M13 3v10" />
    {:else if name === 'content'}
      <circle cx="8" cy="8" r="4.5" /><circle cx="8" cy="8" r="1.2" fill="currentColor" />
    {:else if name === 'effect'}
      <path d="M8 2.5l1.4 3.1L12.5 7 9.4 8.4 8 11.5 6.6 8.4 3.5 7l3.1-1.4z" />
    {:else if name === 'layer'}
      <path d="M8 2.5l5 2.6-5 2.6-5-2.6z" /><path d="M3 8.5l5 2.6 5-2.6" />
    {:else if name === 'output'}
      <path d="M4 11a5 5 0 0 1 8 0" /><path d="M6 11a2.6 2.6 0 0 1 4 0" /><circle cx="8" cy="12" r="0.8" fill="currentColor" />
    {:else if name === 'mod'}
      <path d="M2 8c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 3 0" />
    {/if}
  </svg>
{/snippet}

<div class="sg">
  <header class="sg-top">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <div>
        <h1>LEDrums — design system</h1>
        <p>Graphite instrument body · the rig is the colour · Geist + Geist&nbsp;Mono</p>
      </div>
    </div>
    <span class="tag">foundation · token preview</span>
  </header>

  <!-- ACCENT DECISION ------------------------------------------------------ -->
  <section class="block">
    <div class="block-head">
      <h2>Signature accent — pick one</h2>
      <p>The single interactive colour over the graphite. Identical mini-instruments, three candidates.</p>
    </div>
    <div class="accent-grid">
      {#each accents as a (a.id)}
        <article class="accent-card" data-accent={a.id}>
          <div class="ac-head">
            <span class="swatch" style="background: var(--accent)"></span>
            <div>
              <h3>{a.name}</h3>
              <span class="ac-note">{a.note}</span>
            </div>
          </div>

          <div class="ac-demo">
            <nav class="pills" aria-label="demo">
              <button class="active">Perform</button>
              <button>Arrange</button>
              <button>Settings</button>
            </nav>

            <div class="ac-row">
              <button class="primary">Arm output</button>
              <button>Cancel</button>
            </div>

            <label class="fader">
              <span class="fl">Opacity</span>
              <input
                type="range"
                min="0"
                max="100"
                bind:value={fader}
                style="--range-fill: {fader}%"
                aria-label="Opacity"
              />
              <span class="fv tabular">{fader}</span>
            </label>

            <div class="ac-chips">
              <span class="chip sel">Layer 2 · selected</span>
              <span class="chip live">● LIVE</span>
            </div>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <div class="cols">
    <!-- ELEVATIONS -------------------------------------------------------- -->
    <section class="block">
      <div class="block-head"><h2>Canvas</h2><p>Cool graphite, six elevations.</p></div>
      <div class="elev-row">
        {#each elevations as [v, label] (v)}
          <div class="elev">
            <span class="elev-chip" style="background: var({v})"></span>
            <span class="elev-label">{label}</span>
            <code>{v}</code>
          </div>
        {/each}
      </div>
    </section>

    <!-- INK --------------------------------------------------------------- -->
    <section class="block">
      <div class="block-head"><h2>Ink</h2><p>AA-verified on every surface.</p></div>
      <div class="ink-list">
        {#each inkRamp as [v, label, ratio] (v)}
          <div class="ink-row">
            <span class="ink-sample" style="color: var({v})">{label}</span>
            <span class="ink-meta"><code>{v}</code><span class="ratio">{ratio}</span></span>
          </div>
        {/each}
      </div>
    </section>
  </div>

  <div class="cols">
    <!-- TYPE -------------------------------------------------------------- -->
    <section class="block">
      <div class="block-head"><h2>Type — Geist</h2><p>Fixed scale, ~1.2 ratio.</p></div>
      <div class="type-list">
        {#each type as [v, label, px] (v)}
          <div class="type-row">
            <span class="type-sample" style="font-size: var({v})">Composition</span>
            <span class="type-meta">{label} · {px}px</span>
          </div>
        {/each}
        <div class="mono-sample">
          <span class="ml">Geist Mono — readouts</span>
          <code>128.0 BPM · bar 09.3 · 192.168.1.50 · #FF3B3B · 304px</code>
        </div>
      </div>
    </section>

    <!-- ROLES + STATES ---------------------------------------------------- -->
    <section class="block">
      <div class="block-head"><h2>Signal-flow roles</h2><p>Functional colour, icon + label always.</p></div>
      <div class="role-grid">
        {#each roles as r (r.v)}
          <span class="role" style="--rc: var({r.v})">
            <span class="role-ic">{@render glyph(r.glyph)}</span>
            {r.label}
          </span>
        {/each}
      </div>
      <div class="flow" aria-hidden="true">
        <span class="fn" style="--rc: var(--role-input)">Input</span><i></i>
        <span class="fn" style="--rc: var(--role-content)">Content</span><i></i>
        <span class="fn" style="--rc: var(--role-effect)">Effect</span><i></i>
        <span class="fn" style="--rc: var(--role-layer)">Layer</span><i></i>
        <span class="fn" style="--rc: var(--role-output)">Output</span>
      </div>

      <div class="block-head" style="margin-top: var(--space-4)"><h2>States</h2></div>
      <div class="state-grid">
        <span class="st live">● LIVE / armed</span>
        <span class="st warn">◐ Dry-run</span>
        <span class="st ok">● Connected</span>
        <span class="st off">○ Output off</span>
        <span class="st err">▲ Error</span>
      </div>
    </section>
  </div>

  <!-- COMPONENTS — real lib/ui primitives -------------------------------- -->
  <section class="block">
    <div class="block-head">
      <h2>Components — lib/ui</h2>
      <p>The real primitives every panel composes from. Interactive — try them.</p>
    </div>

    <div class="comp-grid">
      <div class="comp">
        <Eyebrow>Buttons</Eyebrow>
        <div class="comp-row">
          <button class="primary">Primary</button>
          <button>Default</button>
          <button class="ghost">Ghost</button>
          <button class="danger">Disarm</button>
          <button class="active">Toggled</button>
          <button disabled>Disabled</button>
        </div>
      </div>

      <div class="comp">
        <Eyebrow>Icon buttons · Tooltip</Eyebrow>
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
      </div>

      <div class="comp">
        <Eyebrow>Text fields</Eyebrow>
        <div class="comp-stack">
          <Field label="Show name" hint="Plain bindable input">
            <TextField bind:value={textVal} placeholder="Untitled show…" ariaLabel="Show name" />
          </Field>
          <SearchField bind:value={searchVal} placeholder="Search shows…" />
        </div>
      </div>

      <div class="comp">
        <Eyebrow>Commit input</Eyebrow>
        <div class="comp-stack">
          <Field label="Inline rename" hint="Commits on Enter / blur">
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
      </div>

      <div class="comp">
        <Eyebrow>Selection</Eyebrow>
        <div class="comp-stack">
          <Field label="Protocol">
            <Select bind:value={protocol} options={protocolOptions} ariaLabel="Protocol" />
          </Field>
          <SegmentedControl value={mode} options={modeOptions} onChange={(v) => (mode = v)} ariaLabel="Mode" />
          <Tabs bind:value={inspectorTab} tabs={inspectorTabs} ariaLabel="Inspector" />
        </div>
      </div>

      <div class="comp">
        <Eyebrow>Toggles</Eyebrow>
        <div class="comp-row">
          <Toggle bind:pressed={armed} onLabel="armed" offLabel="safe" ariaLabel="Arm output" />
          <Switch bind:checked={broadcast} ariaLabel="Broadcast" />
        </div>
      </div>

      <div class="comp">
        <Eyebrow>Slider</Eyebrow>
        <Slider bind:value={opacity} min={0} max={100} ariaLabel="Opacity" format={(v) => `${v}%`} />
      </div>

      <div class="comp">
        <Eyebrow>Status</Eyebrow>
        <div class="comp-row">
          <StatusPill tone="ok" label="Connected" />
          <StatusPill tone="live" label="LIVE" pulse />
          <StatusPill tone="warn" label="Dry-run" />
          <StatusPill tone="accent" label="Saving" pulse />
          <StatusPill tone="muted" label="Idle" />
        </div>
        <div class="comp-row" style="margin-top: var(--space-2)">
          <span class="dot-demo"><StatusDot tone="ok" /> ok</span>
          <span class="dot-demo"><StatusDot tone="live" pulse /> live</span>
          <span class="dot-demo"><StatusDot tone="warn" /> warn</span>
        </div>
      </div>

      <div class="comp comp-wide">
        <Eyebrow>List rows</Eyebrow>
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
        <p class="comp-note">Right-click a row for its context menu · double-click the last row to rename.</p>
      </div>

      <div class="comp comp-wide">
        <Eyebrow>Overlays</Eyebrow>
        <div class="comp-row">
          <ContextMenu actions={rowActions}>
            <button class="ghost">Right-click target</button>
          </ContextMenu>
          <button onclick={() => (dialogOpen = true)}>Open dialog…</button>
          <button onclick={() => (drawerOpen = true)}>Open drawer…</button>
        </div>
      </div>
    </div>
  </section>
</div>

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

<Drawer open={drawerOpen} onClose={() => (drawerOpen = false)} title="Example drawer" side="right" width="320px">
  <p class="ov-text">A slide-in <code>Drawer</code> — same <code>--overlay</code> scrim, <code>--z-overlay</code> tier.</p>
</Drawer>

<style>
  /* styleguide owns the whole page; let the document scroll naturally */
  :global(html),
  :global(body) {
    overflow: auto;
    height: auto;
  }
  .sg {
    min-height: 100vh;
    padding: var(--space-6) clamp(var(--space-5), 5vw, var(--space-8)) var(--space-8);
    background:
      radial-gradient(120% 80% at 100% 0%, oklch(0.2 0.03 300 / 0.18), transparent 60%),
      var(--bg);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .sg-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border-faint);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .mark {
    width: 30px;
    height: 30px;
    border-radius: var(--radius-2);
    background:
      conic-gradient(from 210deg, var(--role-input), var(--role-content), var(--role-effect), var(--role-layer), var(--role-output), var(--role-input));
    box-shadow: var(--shadow-1);
  }
  .sg-top h1 {
    font-size: var(--text-xl);
    color: var(--ink);
  }
  .sg-top p {
    margin: 2px 0 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .tag {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-pill);
  }

  .block {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-4);
    padding: var(--space-5);
  }
  .block-head h2 {
    font-size: var(--text-md);
    color: var(--ink);
  }
  .block-head p {
    margin: var(--space-1) 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
    gap: var(--space-6);
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }

  /* accent cards */
  .accent-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-4);
  }
  .accent-card {
    background: var(--bg-perform);
    border: 1px solid var(--border);
    border-radius: var(--radius-3);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .ac-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .swatch {
    width: 34px;
    height: 34px;
    border-radius: var(--radius-2);
    box-shadow: var(--accent-glow);
  }
  .ac-head h3 {
    font-size: var(--text-md);
    color: var(--ink);
  }
  .ac-note {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .ac-demo {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .pills {
    display: inline-flex;
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    padding: 3px;
    gap: 2px;
    width: fit-content;
  }
  .pills button {
    border: none;
    background: transparent;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
  }
  .pills button.active {
    background: var(--accent);
    color: var(--on-accent);
  }
  .ac-row {
    display: flex;
    gap: var(--space-2);
  }
  .fader {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-2);
  }
  .fl {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .fv {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text);
    min-width: 2ch;
    text-align: right;
  }
  .ac-chips {
    display: flex;
    gap: var(--space-2);
  }
  .chip {
    font-size: var(--text-2xs);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-pill);
  }
  .chip.sel {
    color: var(--ink);
    background: var(--accent-soft);
    border: 1px solid var(--accent);
  }
  .chip.live {
    color: var(--live-bright);
    background: var(--live-soft);
    border: 1px solid color-mix(in oklch, var(--live) 50%, transparent);
  }

  /* elevations */
  .elev-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: var(--space-2);
  }
  .elev {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .elev-chip {
    height: 52px;
    border-radius: var(--radius-2);
    border: 1px solid var(--border-faint);
  }
  .elev-label {
    font-size: var(--text-xs);
    color: var(--text);
  }

  /* ink */
  .ink-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .ink-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .ink-sample {
    font-size: var(--text-md);
  }
  .ink-meta {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .ratio {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ok);
  }

  /* type */
  .type-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .type-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .type-sample {
    color: var(--ink);
    letter-spacing: var(--tracking-tight);
    line-height: 1;
  }
  .type-meta {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    white-space: nowrap;
  }
  .mono-sample {
    margin-top: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-faint);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .ml {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .mono-sample code {
    font-size: var(--text-sm);
    color: var(--text);
  }

  /* roles */
  .role-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .role {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--rc);
    padding: var(--space-1) var(--space-3) var(--space-1) var(--space-2);
    background: color-mix(in oklch, var(--rc) 14%, transparent);
    border: 1px solid color-mix(in oklch, var(--rc) 40%, transparent);
    border-radius: var(--radius-pill);
  }
  .role-ic {
    display: inline-flex;
  }
  .flow {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-3);
    flex-wrap: wrap;
  }
  .fn {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--rc);
  }
  .flow i {
    flex: 0 0 18px;
    height: 1px;
    background: linear-gradient(90deg, var(--border-strong), var(--border-faint));
  }

  /* states */
  .state-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .st {
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    border: 1px solid var(--border-faint);
    color: var(--text-muted);
  }
  .st.live {
    color: var(--live-bright);
    background: var(--live-soft);
    border-color: color-mix(in oklch, var(--live) 50%, transparent);
    font-weight: 600;
  }
  .st.warn {
    color: var(--warn);
    border-color: color-mix(in oklch, var(--warn) 40%, transparent);
  }
  .st.ok {
    color: var(--ok);
    border-color: color-mix(in oklch, var(--ok) 40%, transparent);
  }
  .st.err {
    color: var(--live-bright);
  }

  /* components — real lib/ui primitives */
  .comp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: var(--space-5);
  }
  .comp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .comp-wide {
    grid-column: 1 / -1;
  }
  .comp-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
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
  .comp-note {
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .dot-demo {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /* overlay demo bodies (Dialog/Drawer provide no inner padding) */
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
