<script lang="ts">
  /* MIDI-map mode overlay (effect chains S07b). Mounted once by the shell; renders nothing
     until `shell.mapMode` is on. Then:
       - every registered `mappable` control gets a `--map` outline, plus a badge with its
         binding ("Note 60", "CC 21", "/osc/x", "Key Q");
       - everything else is dimmed by a scrim with a hole per control;
       - a window capture layer turns a primary press on a control into "arm", and swallows
         every other press, so nothing fires by accident (wheel scrolling still works);
       - the armed control pulses; the hint bar names it, says what to press, shows a refused
         binding's reason, and edits a continuous mapping's range.
     Keys (learn / Delete clears / Escape exits) arrive through the app keyboard dispatcher via
     the controller this component publishes on the shell (`setMapSession`).

     `scope` confines the overlay to one element (the styleguide demos); the app mounts it
     unscoped over the viewport. */
  import { untrack } from 'svelte';
  import { effectChain } from '@ledrums/core';
  import type { MapModeApi } from '../../trigger-lab/map-api';
  import CommitInput from '../../ui/CommitInput.svelte';
  import { MapModeController, type MapModeShell } from './map-mode.svelte';
  import { mapRegistry, type MapRegistry, type MappableEntry } from './registry.svelte';
  import X from '@lucide/svelte/icons/x';
  import Eraser from '@lucide/svelte/icons/eraser';

  type Props = {
    api: MapModeApi;
    shell: MapModeShell;
    /** Confine the overlay (outlines, scrim, capture) to this element. */
    scope?: HTMLElement | null;
    /** Supply the controller (demos pre-arm a control); default: one of its own. */
    controller?: MapModeController;
    registry?: MapRegistry;
  };

  let { api, shell, scope = null, controller: given, registry = mapRegistry }: Props = $props();

  const controller = untrack(() => given ?? new MapModeController(() => api));

  // Publish the keyboard face for the app dispatcher while mounted.
  $effect(() => {
    const target = shell;
    target.setMapSession?.(controller);
    return () => {
      if (target.mapSession === controller) target.setMapSession?.(null);
    };
  });

  const active = $derived(shell.mapMode);

  interface Box {
    entry: MappableEntry;
    x: number;
    y: number;
    w: number;
    h: number;
  }
  interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  let bounds = $state.raw<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  let boxes = $state.raw<readonly Box[]>([]);
  /** Map-mode chrome (the TopBar toggle) left undimmed by the scrim. */
  let chrome = $state.raw<readonly Rect[]>([]);

  const inScope = (node: Node): boolean => scope === null || scope.contains(node);

  function sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const p = a[i]!;
      const q = b[i]!;
      if (p.x !== q.x || p.y !== q.y || p.w !== q.w || p.h !== q.h) return false;
    }
    return true;
  }

  function measure(): void {
    const outer = scope?.getBoundingClientRect();
    const next: Rect = outer
      ? { x: outer.left, y: outer.top, w: outer.width, h: outer.height }
      : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    if (!sameRects([next], [bounds])) bounds = next;

    const measured: Box[] = [];
    for (const entry of registry.entries) {
      if (!entry.node.isConnected || !inScope(entry.node)) continue;
      const r = entry.node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // hidden (display:none, collapsed)
      measured.push({ entry, x: r.left - next.x, y: r.top - next.y, w: r.width, h: r.height });
    }
    if (measured.length !== boxes.length || measured.some((b, i) => b.entry !== boxes[i]!.entry) || !sameRects(measured, boxes)) {
      boxes = measured;
    }

    const holes: Rect[] = [];
    if (scope === null) {
      for (const el of document.querySelectorAll('[data-map-mode-chrome]')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) holes.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
    if (!sameRects(holes, chrome)) chrome = holes;
  }

  // Layout follows scrolling, resizing and content changes (a cell selection re-fills the
  // strip), so re-measure every frame while mapping. Rects are read with no DOM writes between
  // them, so the layout is already clean; state is only reassigned when a rect moved.
  $effect(() => {
    if (!active) return;
    let frame = 0;
    const tick = (): void => {
      measure();
      frame = requestAnimationFrame(tick);
    };
    // The first measure runs inside this effect: untracked, or its reads of the rects it
    // writes would make the effect depend on (and re-run from) its own output.
    untrack(tick);
    return () => cancelAnimationFrame(frame);
  });

  // The capture layer: a press on a mappable control arms it; any other press is swallowed.
  // Map-mode chrome and modal dialogs keep their own pointer handling.
  const CAPTURED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart'] as const;
  const PASS_THROUGH = '[data-map-mode-chrome], [role="dialog"], [role="alertdialog"], [data-keyboard-owner="modal"]';

  $effect(() => {
    if (!active) return;
    const onPress = (event: Event): void => {
      const path = event.composedPath();
      if (scope !== null && !path.includes(scope)) return;
      if (path.some((t) => t instanceof Element && t.matches(PASS_THROUGH))) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type !== 'pointerdown' || (event as PointerEvent).button !== 0) return;
      const entry = registry.entryOnPath(path);
      if (entry && inScope(entry.node)) controller.arm(entry.spec);
      else controller.disarm();
    };
    for (const type of CAPTURED) window.addEventListener(type, onPress, { capture: true, passive: false });
    return () => {
      for (const type of CAPTURED) window.removeEventListener(type, onPress, { capture: true });
    };
  });

  /** The scrim: the bounds rectangle with an even-odd hole per control and chrome element. */
  const scrimPath = $derived.by(() => {
    const rect = (r: Rect, pad: number): string =>
      `M${r.x - pad} ${r.y - pad}h${r.w + pad * 2}v${r.h + pad * 2}h${-(r.w + pad * 2)}Z`;
    const offset = (r: Rect): Rect => ({ x: r.x - bounds.x, y: r.y - bounds.y, w: r.w, h: r.h });
    return [rect({ x: 0, y: 0, w: bounds.w, h: bounds.h }, 0), ...boxes.map((b) => rect(b, 3)), ...chrome.map((c) => rect(offset(c), 0))].join('');
  });

  const armed = $derived(controller.armed);
  const armedBinding = $derived(armed ? controller.bindingLabel(armed.spec.target) : null);
  const refusal = $derived(controller.refusal);
  const armedMapping = $derived.by(() => {
    if (!armed || armed.spec.kind !== 'continuous' || armed.spec.target.kind === 'globalControl') return null;
    const id = armed.id;
    return api.inputMappings.find((m) => effectChain.inputMappingTargetId(m.target) === id) ?? null;
  });

  function commitRange(which: 'min' | 'max', raw: string): void {
    const mapping = armedMapping;
    if (!mapping) return;
    const value = raw.trim() === '' ? undefined : Number(raw);
    if (value !== undefined && !Number.isFinite(value)) return;
    api.setMappingRange(
      mapping.target,
      which === 'min' ? value : mapping.rangeMin,
      which === 'max' ? value : mapping.rangeMax,
    );
  }

  const LEARN_HINT: Record<string, string> = {
    button: 'Press a note or key, or send OSC',
    toggle: 'Press a note or key, or send OSC',
    continuous: 'Move a CC or send OSC',
  };
</script>

{#if active}
  <div
    class="map-layer"
    class:scoped={scope !== null}
    style="left:{bounds.x}px; top:{bounds.y}px; width:{bounds.w}px; height:{bounds.h}px;"
    aria-hidden="true"
  >
    <svg class="scrim" width={bounds.w} height={bounds.h}>
      <path d={scrimPath} fill-rule="evenodd" />
    </svg>
    {#each boxes as box (box.entry)}
      {@const state = controller.stateOf(box.entry.spec)}
      {@const label = controller.bindingLabel(box.entry.spec.target)}
      <div class="target" data-state={state} style="left:{box.x}px; top:{box.y}px; width:{box.w}px; height:{box.h}px;">
        {#if label || state === 'armed' || state === 'conflict'}
          <span class="badge">{label ?? 'Learn'}</span>
        {/if}
      </div>
    {/each}
  </div>

  <div class="map-bar" class:scoped={scope !== null} data-map-mode-chrome role="region" aria-label="MIDI map mode">
    <span class="mode"><span class="dot" aria-hidden="true"></span>MIDI map</span>
    <span class="msg" aria-live="polite">
      {#if !api.canEditMappings}
        <span class="quiet">Viewing — another client is editing; mappings are read-only.</span>
      {:else if armed}
        <strong class="armed-label">{armed.spec.label}</strong>
        <span class="binding" class:unbound={!armedBinding}>{armedBinding ?? 'Unmapped'}</span>
        {#if refusal}
          <span class="refusal" role="alert">{refusal}</span>
        {:else}
          <span class="quiet">{LEARN_HINT[armed.spec.kind]}</span>
        {/if}
      {:else}
        <span class="quiet">Click a control to map it, then press a note, move a CC, send OSC or press a key.</span>
      {/if}
    </span>

    {#if armedMapping}
      <span class="range" aria-label="Mapping range">
        <span class="range-label">Range</span>
        <CommitInput type="number" value={armedMapping.rangeMin ?? ''} placeholder="min" ariaLabel="Range minimum" onCommit={(v) => commitRange('min', v)} />
        <span class="range-sep" aria-hidden="true">–</span>
        <CommitInput type="number" value={armedMapping.rangeMax ?? ''} placeholder="max" ariaLabel="Range maximum" onCommit={(v) => commitRange('max', v)} />
      </span>
    {/if}

    <span class="actions">
      {#if armed && armedBinding && api.canEditMappings}
        <button type="button" class="bar-btn" onclick={() => controller.clearArmed()}>
          <Eraser size={14} aria-hidden="true" />Clear<kbd>⌫</kbd>
        </button>
      {/if}
      <button type="button" class="bar-btn" onclick={() => shell.setMapMode(false)}>
        <X size={14} aria-hidden="true" />Done<kbd>Esc</kbd>
      </button>
    </span>
  </div>
{/if}

<style>
  .map-layer {
    position: fixed;
    z-index: var(--z-overlay);
    pointer-events: none;
    overflow: hidden;
  }
  .scrim {
    position: absolute;
    inset: 0;
    display: block;
  }
  .scrim path {
    fill: var(--map-scrim);
  }

  .target {
    position: absolute;
    border-radius: calc(var(--radius-2) + 3px);
    /* the outline sits 3px outside the control (concentric with its 5px corners) */
    translate: -3px -3px;
    padding: 3px;
    box-sizing: content-box;
    box-shadow: inset 0 0 0 1.5px var(--map);
    transition:
      background-color var(--dur-120) ease,
      box-shadow var(--dur-120) ease;
  }
  .target[data-state='mapped'] {
    background: var(--map-soft);
  }
  .target[data-state='armed'] {
    background: var(--map-soft);
    box-shadow:
      inset 0 0 0 2px var(--map-bright),
      0 0 0 0 var(--map-ring);
    animation: map-pulse 1.1s var(--ease-out-quart) infinite;
  }
  .target[data-state='conflict'] {
    background: var(--live-soft);
    box-shadow: inset 0 0 0 2px var(--live-bright);
  }
  @keyframes map-pulse {
    0% {
      box-shadow:
        inset 0 0 0 2px var(--map-bright),
        0 0 0 0 var(--map-ring);
    }
    100% {
      box-shadow:
        inset 0 0 0 2px var(--map-bright),
        0 0 0 7px transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .target[data-state='armed'] {
      animation: none;
    }
  }

  .badge {
    position: absolute;
    top: -8px;
    right: -4px;
    max-width: calc(100% + 8px);
    padding: 1px 5px;
    border-radius: var(--radius-1);
    background: var(--map);
    color: var(--on-map);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    line-height: 14px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: var(--shadow-1);
  }
  .target[data-state='conflict'] .badge {
    background: var(--live-bright);
    color: var(--bg);
  }

  .map-bar {
    position: fixed;
    z-index: var(--z-overlay);
    left: 50%;
    bottom: calc(var(--space-7) + var(--space-3));
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    max-width: min(760px, calc(100vw - var(--space-6)));
    min-height: 40px;
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    border-radius: var(--radius-3);
    background: var(--surface-3);
    box-shadow:
      0 0 0 1px var(--map-border),
      var(--shadow-2);
    color: var(--text);
    font-size: var(--text-xs);
    animation: bar-in var(--dur-220) var(--ease-out-quart);
  }
  .map-bar.scoped {
    position: absolute;
    bottom: var(--space-3);
  }
  @keyframes bar-in {
    from {
      opacity: 0;
      translate: -50% 6px;
    }
  }
  .mode {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1_5);
    flex: none;
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    font-size: var(--text-2xs);
    color: var(--map-bright);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--map);
  }
  .msg {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .armed-label {
    color: var(--ink);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .binding {
    flex: none;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--map-bright);
  }
  .binding.unbound {
    color: var(--text-faint);
  }
  .quiet {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .refusal {
    color: var(--live-bright);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .range {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex: none;
  }
  .range :global(input) {
    width: 64px;
  }
  .range-label {
    color: var(--text-faint);
    font-size: var(--text-2xs);
  }
  .range-sep {
    color: var(--text-faint);
  }
  .actions {
    display: inline-flex;
    gap: var(--space-1);
    flex: none;
    margin-left: auto;
  }
  .bar-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1_5);
    height: 32px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color var(--dur-120) ease,
      border-color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .bar-btn:hover {
    background: var(--surface-inset);
    border-color: var(--border-strong);
  }
  .bar-btn:active {
    scale: 0.96;
  }
  .bar-btn:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: 1px;
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    background: var(--surface-inset);
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
  }
</style>
