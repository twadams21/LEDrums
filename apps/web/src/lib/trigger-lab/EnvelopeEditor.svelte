<script lang="ts">
  /* ADSR envelope editor (throwaway). A modal that opens when store.envTarget is set — it
     edits a play/modifier node's per-param envelope. The draggable curve + per-segment easing
     now live in the reusable EnvelopeEditorView (S34); this file is the store-bound modal chrome
     around it (header, amount, remove). The store turns the shape into the persisted render curve
     (adsrToPoints) so it stays the single source of truth. */
  import Dialog from '../ui/Dialog.svelte';
  import Slider from '../ui/Slider.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import EnvelopeEditorView from './EnvelopeEditorView.svelte';
  import X from '@lucide/svelte/icons/x';
  import Spline from '@lucide/svelte/icons/spline';
  import { type AdsrShape, defaultAdsr } from './sim';
  import type { TriggerLab } from './store.svelte';

  let { store }: { store: TriggerLab } = $props();

  // --- target + spec -------------------------------------------------------
  const target = $derived(store.envTarget);
  const spec = $derived.by(() => {
    const t = store.envTarget;
    if (!t) return undefined;
    const eff = store.effectOf(t.block);
    return eff?.params.find((s) => s.key === t.key);
  });
  const env = $derived(target ? store.getEnvelope(target.block, target.key) : null);

  const paramLabel = $derived(spec?.label ?? 'Parameter');
  const min = $derived(spec?.min ?? 0);
  const max = $derived(spec?.max ?? 1);
  const unit = $derived(spec?.unit ?? '');

  // The live ADSR — store is the source of truth. We never mirror it.
  const adsr = $derived(target ? store.getEnvelope(target.block, target.key)?.adsr ?? defaultAdsr() : defaultAdsr());

  /** Persist a fresh shape (creates the envelope if missing). */
  function commitShape(next: AdsrShape): void {
    if (target) store.setEnvAdsr(target.block, target.key, next);
  }

  // --- amount --------------------------------------------------------------
  const amount = $derived(env?.amount ?? 1);
  function setAmount(v: number): void {
    if (target) store.setEnvAmount(target.block, target.key, v);
  }
  function removeEnvelope(): void {
    if (target) store.setEnvKind(target.block, target.key, 'none');
  }

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
</script>

<Dialog open={!!store.envTarget} onClose={() => store.closeEnv()} title="Envelope" layer={2} class="dlg-envedit">
  {#if target && spec}
    <header class="ehead">
      <Eyebrow icon={Spline}>Envelope · {paramLabel}</Eyebrow>
      <span class="grow"></span>
      <IconButton icon={X} label="Close" onclick={() => store.closeEnv()} variant="ghost" />
    </header>

    <div class="body">
      <EnvelopeEditorView {adsr} onShape={commitShape} label={paramLabel} />

      <div class="row">
        <Eyebrow>Amount</Eyebrow>
        <Slider value={amount} min={0} max={1} step={0.01} onChange={setAmount} format={pct} ariaLabel="Sweep amount" />
      </div>
    </div>

    <footer class="foot">
      <p class="hint">
        {paramLabel} sweeps across {min}–{max}{unit} as the hit plays. Drag the Attack node up for its
        peak level; pick each segment's easing above. Amount scales the depth.
      </p>
      <button class="remove" type="button" onclick={removeEnvelope}>Remove envelope</button>
    </footer>
  {/if}
</Dialog>

<style>
  :global(.dlg-envedit) {
    width: min(520px, 94vw);
  }

  .ehead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .grow {
    flex: 1;
  }

  .body {
    padding: var(--space-3) var(--space-4);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .row :global(.eyebrow) {
    min-width: 56px;
  }

  .foot {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-faint);
  }
  .hint {
    flex: 1;
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    line-height: 1.5;
    text-wrap: pretty;
  }
  .remove {
    flex: none;
    background: transparent;
    border: none;
    padding: 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    transition: color var(--dur-120) ease;
    white-space: nowrap;
  }
  .remove:hover {
    color: var(--accent-bright);
  }

  @media (prefers-reduced-motion: reduce) {
    .remove {
      transition: none;
    }
  }
</style>
