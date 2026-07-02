<script lang="ts">
  /* Trigger-node source editor (U2). The trigger node (graph root) declares what input
     fires its graph — a drum zone, a raw MIDI note/CC, or an OSC address (U1's
     TriggerSource). Writes go through store.setTriggerSource(<graph key>, source); the
     readout + node sub-line resolve via the pure describeTriggerSource helper. The graph
     key is store.selectedPadKey. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, TriggerSource } from '../../../trigger-lab/sim';
  import { describeTriggerSource, drumLinkHint, zoneLabel } from '../../trigger-source-label';
  import { isReservedCc, RESERVED_CC } from '../../recall';
  import Link2 from '@lucide/svelte/icons/link-2';
  import { ZONE_LABELS } from '../../../trigger-lab/fixtures';
  import { SOURCE_OPTS, MIDI_OPTS } from '../../views/node-options';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import InputActivityBadge from '../../../ui/InputActivityBadge.svelte';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Radio from '@lucide/svelte/icons/radio';
  import ReadRow from './ReadRow.svelte';
  import { onNum } from './forms';
  import { formatMidiNote, parseMidiNote } from '../../../midi/midi-note';
  import { bindingFromSource } from '../../../trigger-lab/input-activity';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const src = $derived(node.source);
  // Last-heard confirmation for the active MIDI-note / OSC field (null for drum/CC/empty).
  const heard = $derived(store.inputBadge(bindingFromSource(src)));
  const gkey = $derived(store.selectedPadKey);
  // Cross-reference: this MIDI/OSC source is ALSO a mapped drum zone → both fire per hit
  // (by design). Same phrasing as the trigger node's drum-link badge. Null offline.
  const drumHint = $derived(store.project ? drumLinkHint(store.project.inputMap, src, store.drums) : null);
  const kindNow = $derived(src?.kind ?? 'drum');
  const learning = $derived(
    !!gkey && store.midiLearnTarget?.kind === 'trigger' && store.midiLearnTarget.graphKey === gkey,
  );

  const DRUM_OPTS = $derived(store.drums.map((d) => ({ value: d.id, label: d.label })));

  /** Zone <Select> options for a drum: the zones it exposes as pads (its hoops in use),
      always including the current binding, falling back to all four hoop labels. */
  function zoneOptsFor(drumId: string, current: string): Array<{ value: string; label: string }> {
    const ids: string[] = []; // ≤4 zones — a plain unique-push is plenty (no reactive Set)
    const add = (z: string): void => {
      if (z && !ids.includes(z)) ids.push(z);
    };
    for (const p of store.pads) if (p.drumId === drumId) add(String(p.zone));
    add(current);
    ids.sort((a, b) => Number(a) - Number(b));
    const list = ids.length ? ids : ZONE_LABELS.map((_, i) => String(i));
    return list.map((z) => ({ value: z, label: zoneLabel(z) }));
  }

  /** Switch the trigger source to a new kind, carrying compatible fields and filling
      least-surprising defaults (first drum + centre · middle MIDI note · empty address). */
  function setSourceKind(g: string, cur: TriggerSource | undefined, kind: TriggerSource['kind']): void {
    let next: TriggerSource;
    if (kind === 'drum') next = cur?.kind === 'drum' ? cur : { kind: 'drum', drumId: store.drums[0]?.id ?? '', zone: '0' };
    else if (kind === 'midi') next = cur?.kind === 'midi' ? cur : { kind: 'midi', note: 60 };
    else next = cur?.kind === 'osc' ? cur : { kind: 'osc', address: '' };
    store.setTriggerSource(g, next);
  }

  /** Flip a MIDI source between note and CC, carrying the current number across. CC 0 is
      reserved for global section recall, so switching to CC nudges off it (→ 1). */
  function setMidiMode(g: string, cur: Extract<TriggerSource, { kind: 'midi' }>, mode: 'note' | 'cc'): void {
    const n = cur.cc ?? cur.note ?? 0;
    if (mode === 'cc') store.setTriggerSource(g, { kind: 'midi', cc: isReservedCc(n) ? RESERVED_CC + 1 : n });
    else store.setTriggerSource(g, { kind: 'midi', note: n });
  }

  /** Commit a CC number for a trigger source, rejecting the reserved controller (no write —
      CC 0 stays bound to global section recall). Note numbers pass straight through. */
  function commitMidiNumber(g: string, isCc: boolean, n: number): void {
    if (isCc && isReservedCc(n)) return; // CC 0 reserved — ignore
    store.setTriggerSource(g, isCc ? { kind: 'midi', cc: n } : { kind: 'midi', note: n });
  }

  function commitMidiNote(g: string, v: string): void {
    const parsed = parseMidiNote(v);
    if (parsed !== null) store.setTriggerSource(g, { kind: 'midi', note: parsed });
  }
</script>

<header class="ihead">
  <div class="titles">
    <h3>
      {store.selectedPad
        ? `${store.selectedPad.drumLabel} · ${store.selectedPad.zoneLabel}`
        : gkey
          ? store.graphLabel(gkey)
          : 'Trigger'}
    </h3>
    <span class="sub">graph input</span>
  </div>
  {#if gkey}
    <IconButton icon={CopyPlus} label="Duplicate graph" variant="soft" size={14} onclick={() => store.duplicateGraph(gkey)} />
  {/if}
</header>
<div class="trigbody">
  <p class="hint">Every hit enters here — declare what fires this graph, then wire it to a block on the canvas.</p>
  <Field label="Trigger source">
    <SegmentedControl
      value={kindNow}
      options={SOURCE_OPTS}
      onChange={(v) => gkey && setSourceKind(gkey, src, v as TriggerSource['kind'])}
      ariaLabel="Trigger source"
    />
  </Field>

  {#if kindNow === 'drum'}
    {@const drumId = src?.kind === 'drum' ? src.drumId : store.drums[0]?.id ?? ''}
    {@const zone = src?.kind === 'drum' ? src.zone : '0'}
    <Field label="Drum">
      <Select
        value={drumId}
        options={DRUM_OPTS}
        onChange={(v) => gkey && store.setTriggerSource(gkey, { kind: 'drum', drumId: v, zone })}
        ariaLabel="Drum"
      />
    </Field>
    <Field label="Zone">
      <Select
        value={zone}
        options={zoneOptsFor(drumId, zone)}
        onChange={(v) => gkey && store.setTriggerSource(gkey, { kind: 'drum', drumId, zone: v })}
        ariaLabel="Zone"
      />
    </Field>
  {:else if src?.kind === 'midi'}
    {@const isCc = src.cc !== undefined}
    <Field label="Type">
      <SegmentedControl
        value={isCc ? 'cc' : 'note'}
        options={MIDI_OPTS}
        onChange={(v) => gkey && setMidiMode(gkey, src, v as 'note' | 'cc')}
        ariaLabel="MIDI note or CC"
      />
    </Field>
    {#if isCc}
      <Field label="CC number" hint="1-127">
        <CommitInput
          type="number"
          min={RESERVED_CC + 1}
          max={127}
          value={src.cc ?? ''}
          placeholder="1-127"
          ariaLabel="CC number"
          onCommit={(v) => onNum(v, (n) => gkey && commitMidiNumber(gkey, true, n))}
        />
      </Field>
      <p class="hint">CC 0 reserved for section recall.</p>
    {:else}
      <Field label="Note" hint={src.note === undefined ? 'C-1 - G9' : String(src.note)}>
        <div class="note-row">
          <CommitInput
            value={src.note === undefined ? '' : formatMidiNote(src.note)}
            placeholder="C4"
            autofocus={false}
            mono
            ariaLabel="MIDI note"
            onCommit={(v) => gkey && commitMidiNote(gkey, v)}
          />
          <button
            type="button"
            class="learn"
            class:active={learning}
            disabled={!gkey}
            onclick={(e) => {
              e.preventDefault();
              if (!gkey) return;
              learning ? store.cancelMidiLearn() : store.startMidiLearn({ kind: 'trigger', graphKey: gkey });
            }}
          >
            <Radio size={13} aria-hidden="true" />
            {learning ? 'Listening' : 'Learn'}
          </button>
        </div>
      </Field>
      {#if heard}
        <div class="heard"><InputActivityBadge {...heard} /></div>
      {/if}
    {/if}
    <p class="hint">Channel filter is in Settings.</p>
  {:else if src?.kind === 'osc'}
    <Field label="Address" hint="e.g. /kick">
      <CommitInput
        value={src.address}
        mono
        autofocus={false}
        placeholder="/kick"
        ariaLabel="OSC address"
        onCommit={(v) => gkey && store.setTriggerSource(gkey, { kind: 'osc', address: v.trim() })}
      />
    </Field>
    {#if heard}
      <div class="heard"><InputActivityBadge {...heard} /></div>
    {/if}
    <p class="hint">Namespace / host comes from the patch device, not here.</p>
  {/if}

  <ReadRow label="Resolves to" value={describeTriggerSource(src, store.drums).sub} />

  {#if drumHint}
    <p class="hint linkhint"><Link2 size={12} aria-hidden="true" />{drumHint}</p>
  {/if}

  {#if gkey && gkey in store.graphs}
    <Field label="Name" hint="display label">
      <CommitInput
        value={store.graphLabel(gkey)}
        autofocus={false}
        placeholder="New graph"
        ariaLabel="Graph name"
        onCommit={(v) => store.renameGraph(gkey, v)}
      />
    </Field>
  {/if}
</div>

<style>
  .ihead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
  }
  .sub {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .trigbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .trigbody :global(.sel) {
    width: 100%;
  }
  .note-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
  }
  .learn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 29px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 600;
    white-space: nowrap;
  }
  .learn:hover:not(:disabled),
  .learn.active {
    border-color: var(--accent);
    color: var(--ink);
  }
  .learn:disabled {
    opacity: 0.45;
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  /* Last-heard confirmation, tucked just under its field. */
  .heard {
    margin-top: calc(-1 * var(--space-1));
    padding-left: var(--space-1);
    min-width: 0;
  }
  /* the drum-link cross-reference — accent glyph + hint, matches the node's badge tooltip */
  .linkhint {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text);
  }
  .linkhint :global(svg) {
    color: var(--accent);
    flex: none;
  }
</style>
