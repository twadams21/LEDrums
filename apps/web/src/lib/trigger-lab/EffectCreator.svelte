<script lang="ts">
  /* Effect creator: a modal FORM to author a new lighting effect, with a live
     preview. Opens on store.creatorOpen. On submit it registers the effect via
     store.createEffect(...) then closes. Throwaway prototype. */
  import EffectThumb from './EffectThumb.svelte';
  import Dialog from '../ui/Dialog.svelte';
  import Field from '../ui/Field.svelte';
  import TextField from '../ui/TextField.svelte';
  import Select from '../ui/Select.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Slider from '../ui/Slider.svelte';
  import Switch from '../ui/Switch.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import Separator from '../ui/Separator.svelte';
  import X from '@lucide/svelte/icons/x';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Plus from '@lucide/svelte/icons/plus';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { PATTERNS, type ParamValues, type Pattern, type Scope } from './sim';
  import { PARAM_LIBRARY } from './fixtures';
  import type { TriggerLab } from './store.svelte';

  let { store }: { store: TriggerLab } = $props();

  const SCOPE_OPTS = [
    { value: 'drum', label: 'Drum' },
    { value: 'kit', label: 'Whole kit' },
  ];

  // ---- form state ----------------------------------------------------------
  let name = $state('');
  let pattern = $state<Pattern>('swirl');
  let scope = $state<Scope>('kit');
  let busId = $state('');
  let attackMs = $state(600);
  let sustainMs = $state(0);
  let releaseMs = $state(800);
  /** keys of PARAM_LIBRARY specs included on the new effect. */
  const included = new SvelteSet<string>(['hue', 'brightness']);

  function reset(): void {
    name = '';
    pattern = 'swirl';
    scope = 'kit';
    busId = store.buses[0]?.id ?? '';
    attackMs = 600;
    sustainMs = 0;
    releaseMs = 800;
    included.clear();
    included.add('hue');
    included.add('brightness');
  }

  // Reset every time the dialog opens (read open inside, mutate untracked).
  $effect(() => {
    if (store.creatorOpen) untrack(reset);
  });

  const busOptions = $derived(store.buses.map((b) => ({ value: b.id, label: b.name })));

  function isIncluded(key: string): boolean {
    return included.has(key);
  }
  function toggleParam(key: string, on: boolean): void {
    if (on) included.add(key);
    else included.delete(key);
  }

  // Live preview param values: the defaults of every included library spec.
  const previewParams = $derived.by<ParamValues>(() => {
    const out: ParamValues = {};
    for (const spec of PARAM_LIBRARY) {
      if (included.has(spec.key)) out[spec.key] = spec.default;
    }
    return out;
  });

  // Neutral default params for the small per-pattern picker tiles.
  const neutralParams = $derived.by<ParamValues>(() => {
    const out: ParamValues = {};
    for (const spec of PARAM_LIBRARY) out[spec.key] = spec.default;
    return out;
  });

  const canCreate = $derived(name.trim().length > 0);

  const ms = (v: number): string => `${Math.round(v)}ms`;

  function submit(): void {
    if (!canCreate) return;
    const params = PARAM_LIBRARY.filter((p) => included.has(p.key)).map((p) => ({ ...p }));
    store.createEffect({ name, pattern, scope, busId, attackMs, sustainMs, releaseMs, params });
    store.closeCreator();
  }
</script>

<Dialog open={store.creatorOpen} onClose={() => store.closeCreator()} title="New effect" layer={1} class="dlg-creator">
  <header class="chead">
    <Eyebrow icon={Sparkles}>New effect</Eyebrow>
    <span class="spacer"></span>
    <IconButton icon={X} label="Close" onclick={() => store.closeCreator()} />
  </header>

  <div class="cbody">
    <div class="form">
      <Field label="Name">
        <TextField bind:value={name} placeholder="e.g. Comet" ariaLabel="Effect name" />
      </Field>

      <Field label="Pattern">
        <div class="patterns">
          {#each PATTERNS as pat, i (pat)}
            <button
              type="button"
              class="tile"
              class:sel={pat === pattern}
              style="--i:{i}"
              onclick={() => (pattern = pat)}
              aria-pressed={pat === pattern}
            >
              <EffectThumb pattern={pat} params={neutralParams} w={54} h={30} />
              <span class="tname">{pat}</span>
            </button>
          {/each}
        </div>
      </Field>

      <div class="row two">
        <Field label="Scope">
          <SegmentedControl
            value={scope}
            options={SCOPE_OPTS}
            onChange={(v) => (scope = v as Scope)}
            ariaLabel="Effect scope"
          />
        </Field>
        <Field label="Bus">
          <Select value={busId} options={busOptions} onChange={(v) => (busId = v)} ariaLabel="Output bus" />
        </Field>
      </div>

      <Separator />

      <div class="timing">
        <Eyebrow>Timing</Eyebrow>
        <Field label="Attack">
          <Slider value={attackMs} min={0} max={2000} step={10} format={ms} onChange={(v) => (attackMs = v)} ariaLabel="Attack" />
        </Field>
        <Field label="Sustain">
          <Slider value={sustainMs} min={0} max={1000} step={10} format={ms} onChange={(v) => (sustainMs = v)} ariaLabel="Sustain" />
        </Field>
        <Field label="Release">
          <Slider value={releaseMs} min={50} max={2000} step={10} format={ms} onChange={(v) => (releaseMs = v)} ariaLabel="Release" />
        </Field>
      </div>

      <Separator />

      <div class="params">
        <Eyebrow icon={Plus}>Parameters</Eyebrow>
        <ul class="plist">
          {#each PARAM_LIBRARY as spec (spec.key)}
            <li class="prow">
              <span class="plabel">{spec.label}</span>
              <Switch
                checked={isIncluded(spec.key)}
                onChange={(on) => toggleParam(spec.key, on)}
                ariaLabel={`Include ${spec.label}`}
              />
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <aside class="preview">
      <Eyebrow>Preview</Eyebrow>
      <div class="pframe">
        <EffectThumb {pattern} params={previewParams} w={240} h={120} />
      </div>
      <span class="pmeta">{pattern} · {scope === 'kit' ? 'whole kit' : 'drum'}</span>
    </aside>
  </div>

  <footer class="cfoot">
    <button type="button" onclick={() => store.closeCreator()}>Cancel</button>
    <button type="button" class="primary" disabled={!canCreate} onclick={submit}>
      <Sparkles size={14} aria-hidden="true" />
      Create effect
    </button>
  </footer>
</Dialog>

<style>
  :global(.dlg-creator) {
    width: min(720px, 94vw);
  }

  .chead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .spacer {
    flex: 1;
  }

  .cbody {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 264px;
    gap: var(--space-4);
    padding: var(--space-4);
    overflow: auto;
    min-height: 0;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .row.two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  /* ---- pattern picker ---- */
  .patterns {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: var(--space-2);
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: var(--space-1);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    cursor: pointer;
    transition:
      border-color var(--dur-1) var(--ease-out-quart),
      background-color var(--dur-1) var(--ease-out-quart),
      translate var(--dur-1) var(--ease-out-quart),
      scale var(--dur-1) var(--ease-out-quart);
  }
  .tile:hover {
    border-color: var(--border-strong);
    translate: 0 -2px;
  }
  .tile:active {
    scale: 0.97;
  }
  .tile.sel {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 45%, transparent);
  }
  .tname {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    text-transform: capitalize;
  }
  .tile.sel .tname {
    color: var(--ink);
  }
  /* the EffectThumb canvas lands on the child root (no scope attr) */
  .tile :global(canvas) {
    border-radius: var(--radius-1);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  }

  /* ---- timing / params ---- */
  .timing,
  .params {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .plist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .prow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
    border: 1px dashed var(--border-faint);
    border-radius: var(--radius-2);
    transition: border-color var(--dur-1) var(--ease-out-quart);
  }
  .prow:hover {
    border-color: var(--border);
  }
  .plabel {
    font-size: var(--text-xs);
    color: var(--text);
  }

  /* ---- preview ---- */
  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-self: start;
    position: sticky;
    top: 0;
  }
  .pframe {
    line-height: 0;
    padding: var(--space-1);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
  }
  .preview :global(canvas) {
    border-radius: var(--radius-1);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  }
  .pmeta {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    text-transform: capitalize;
  }

  /* ---- footer ---- */
  .cfoot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-top: 1px solid var(--border-faint);
  }
  .cfoot button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  @media (max-width: 560px) {
    .cbody {
      grid-template-columns: minmax(0, 1fr);
    }
    .preview {
      position: static;
      order: -1;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .tile {
      animation: tile-in 240ms var(--ease-out-quart) backwards;
      animation-delay: calc(var(--i) * 18ms);
    }
    @keyframes tile-in {
      from {
        opacity: 0;
        translate: 0 6px;
      }
      to {
        opacity: 1;
        translate: 0 0;
      }
    }
  }
</style>
