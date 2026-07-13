<script lang="ts">
  /* Trigger-node source editor (U2 → C6). Two ORTHOGONAL concerns live here, kept visibly
     distinct:

     1. Trigger binding (`node.source`) — what fires THIS graph: a drum zone, a raw MIDI
        note/CC, or an OSC address (U1's TriggerSource). Writes via store.setTriggerSource.
        The graph key is store.selectedPadKey.

     2. Zones (the drum's zone→input wiring) — the (drumId, slot) MIDI-note / OSC entries in
        the authoritative `project.inputMap`, shared by EVERY graph on that drum. Edited via
        the pure setZoneMidiNote / setZoneOscAddress helpers through store.setInputMap. This
        mirrors PatchZoneInspector's per-zone editor, listed for the whole drum with add/remove.

     The zones list anchors to the drum this trigger fires from (its `drum` source, else the
     selected pad's drum); a MIDI/OSC-bound trigger with no pad shows no drum to wire. Per-zone
     CC is intentionally absent — the inputMap has no CC dimension (only midiNotes/oscMap), and
     CC binding already lives on `node.source` above. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, TriggerSource } from '../../../trigger-lab/sim';
  import { describeTriggerSource, drumLinkHint, zoneLabel } from '../../trigger-source-label';
  import { isReservedCc, RESERVED_CC } from '../../recall';
  import Link2 from '@lucide/svelte/icons/link-2';
  import Radio from '@lucide/svelte/icons/radio';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { ZONE_LABELS } from '../../../trigger-lab/fixtures';
  import { SOURCE_OPTS, MIDI_OPTS } from '../../views/node-options';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import InputActivityBadge from '../../../ui/InputActivityBadge.svelte';
  import ReadRow from './ReadRow.svelte';
  import { onNum } from './forms';
  import { formatMidiNote, parseMidiNote } from '../../../midi/midi-note';
  import { bindingFromSource } from '../../../trigger-lab/input-activity';
  import { SLOT_LABELS } from '@ledrums/core';
  import { availableSlots, setZoneMidiNote, setZoneOscAddress, zoneMidiNote, zoneOscAddress } from '../patch-inspector';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  // Widened view of the canonical slot labels for label→index lookups (indexOf on the
  // `as const` tuple rejects a plain string).
  const SLOTS: readonly string[] = SLOT_LABELS;

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

  // --- Zones (the drum's zone→MIDI/OSC input wiring) ---------------------------------------
  // Anchored to the drum this trigger fires from — its `drum` source, else the selected pad's
  // drum. A MIDI/OSC trigger with no pad has no drum context and hides the list.
  const project = $derived(store.project);
  const zonesDrumId = $derived<string | null>(src?.kind === 'drum' ? src.drumId : store.selectedPad?.drumId ?? null);
  const zonesDrumLabel = $derived(
    zonesDrumId ? store.drums.find((d) => d.id === zonesDrumId)?.label ?? zonesDrumId : null,
  );

  // "Add" mints a zone with no note/OSC yet — the inputMap can't represent an empty zone, so a
  // freshly-added slot lives here (tagged by drum) until the first note/address commits it. A
  // realized draft is pruned; a switched drum's drafts simply fall out of the filter.
  let drafts = $state<Array<{ drumId: string; slot: number }>>([]);
  const draftSlots = $derived(zonesDrumId ? drafts.filter((d) => d.drumId === zonesDrumId).map((d) => d.slot) : []);

  // The slots this drum wires: every slot carrying a note or OSC address, plus pending drafts.
  const zoneSlots = $derived.by<number[]>(() => {
    if (!project || !zonesDrumId) return [];
    const set = new Set<number>(draftSlots);
    for (const n of project.inputMap.midiNotes) if (n.drumId === zonesDrumId) set.add(n.slot);
    for (const o of project.inputMap.oscMap) if (o.drumId === zonesDrumId) set.add(o.slot);
    return [...set].sort((a, b) => a - b);
  });

  // Slots with no MIDI/OSC on this drum AND not already drafted — what a new/renamed zone may take.
  const freeSlots = $derived(project && zonesDrumId ? availableSlots(project.inputMap, zonesDrumId, draftSlots) : []);
  const canAdd = $derived(freeSlots.length > 0);

  /** Slot dropdown options for a zone at `slot`: its own label plus every still-free slot,
      in canonical slot order. Value is the slot index (stringified). */
  function slotOptionsFor(slot: number): Array<{ value: string; label: string }> {
    const labels = [SLOT_LABELS[slot]!, ...freeSlots.filter((l) => l !== SLOT_LABELS[slot])];
    return labels
      .map((l) => ({ value: String(SLOTS.indexOf(l)), label: l }))
      .sort((a, b) => Number(a.value) - Number(b.value));
  }

  function pruneDraft(slot: number): void {
    drafts = drafts.filter((d) => !(d.drumId === zonesDrumId && d.slot === slot));
  }

  function addZone(): void {
    if (!project || !zonesDrumId || freeSlots.length === 0) return;
    drafts = [...drafts, { drumId: zonesDrumId, slot: SLOTS.indexOf(freeSlots[0]!) }];
  }

  function removeZone(slot: number): void {
    if (project && zonesDrumId) {
      let m = project.inputMap;
      m = setZoneMidiNote(m, zonesDrumId, slot, null);
      m = setZoneOscAddress(m, zonesDrumId, slot, null);
      store.setInputMap(m);
    }
    pruneDraft(slot);
  }

  /** Move a zone's note + address from `oldSlot` to the chosen slot (a re-label). */
  function changeSlot(oldSlot: number, v: string): void {
    const newSlot = Number(v);
    if (!project || !zonesDrumId || newSlot === oldSlot) return;
    const note = zoneMidiNote(project.inputMap, zonesDrumId, oldSlot);
    const addr = zoneOscAddress(project.inputMap, zonesDrumId, oldSlot);
    let m = project.inputMap;
    m = setZoneMidiNote(m, zonesDrumId, oldSlot, null);
    m = setZoneOscAddress(m, zonesDrumId, oldSlot, null);
    m = setZoneMidiNote(m, zonesDrumId, newSlot, note);
    m = setZoneOscAddress(m, zonesDrumId, newSlot, addr);
    store.setInputMap(m);
    drafts = drafts.map((d) => (d.drumId === zonesDrumId && d.slot === oldSlot ? { ...d, slot: newSlot } : d));
  }

  function commitZoneNote(slot: number, v: string): void {
    if (!project || !zonesDrumId) return;
    if (v === '') {
      store.setInputMap(setZoneMidiNote(project.inputMap, zonesDrumId, slot, null));
      return;
    }
    const parsed = parseMidiNote(v);
    if (parsed !== null) {
      store.setInputMap(setZoneMidiNote(project.inputMap, zonesDrumId, slot, parsed));
      pruneDraft(slot);
    }
  }

  function commitZoneOsc(slot: number, v: string): void {
    if (!project || !zonesDrumId) return;
    const trimmed = v.trim();
    store.setInputMap(setZoneOscAddress(project.inputMap, zonesDrumId, slot, trimmed ? v : null));
    if (trimmed) pruneDraft(slot);
  }

  function zoneLearning(slot: number): boolean {
    const t = store.midiLearnTarget;
    return t?.kind === 'zone' && t.drumId === zonesDrumId && t.slot === slot;
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
  <Field layout="row" label="Trigger source">
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
    <Field layout="row" label="Drum">
      <Select
        value={drumId}
        options={DRUM_OPTS}
        onChange={(v) => gkey && store.setTriggerSource(gkey, { kind: 'drum', drumId: v, zone })}
        ariaLabel="Drum"
      />
    </Field>
    <Field layout="row" label="Zone">
      <Select
        value={zone}
        options={zoneOptsFor(drumId, zone)}
        onChange={(v) => gkey && store.setTriggerSource(gkey, { kind: 'drum', drumId, zone: v })}
        ariaLabel="Zone"
      />
    </Field>
  {:else if src?.kind === 'midi'}
    {@const isCc = src.cc !== undefined}
    <Field layout="row" label="Type">
      <SegmentedControl
        value={isCc ? 'cc' : 'note'}
        options={MIDI_OPTS}
        onChange={(v) => gkey && setMidiMode(gkey, src, v as 'note' | 'cc')}
        ariaLabel="MIDI note or CC"
      />
    </Field>
    {#if isCc}
      <Field layout="row" label="CC number" hint="1-127">
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
      <Field layout="row" label="Note" hint={src.note === undefined ? 'C-1 - G9' : String(src.note)}>
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
    <Field layout="row" label="Address" hint="e.g. /kick">
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
    <Field layout="row" label="Name" hint="display label">
      <CommitInput
        value={store.graphLabel(gkey)}
        autofocus={false}
        placeholder="New graph"
        ariaLabel="Graph name"
        onCommit={(v) => store.renameGraph(gkey, v)}
      />
    </Field>
  {/if}

  <!-- Zones: the drum's zone→MIDI/OSC input wiring (project.inputMap), distinct from the
       graph binding above. Shared by every graph on this drum. -->
  <div class="zones">
    <div class="sectionhead">
      <span class="seclabel">Zones{#if zonesDrumLabel}<span class="secdrum"> · {zonesDrumLabel}</span>{/if}</span>
      {#if zonesDrumId}
        <IconButton icon={Plus} label="Add zone" variant="soft" size={14} disabled={!canAdd} onclick={addZone} />
      {/if}
    </div>

    {#if !zonesDrumId}
      <p class="hint">Bind this trigger to a drum to wire its zones to MIDI / OSC input.</p>
    {:else if zoneSlots.length === 0}
      <p class="hint">No zones wired yet — <b>Add</b> one to map a slot to a MIDI note or OSC address.</p>
    {:else}
      <div class="zonelist">
        {#each zoneSlots as slot (slot)}
          {@const note = project ? zoneMidiNote(project.inputMap, zonesDrumId, slot) : null}
          {@const addr = project ? zoneOscAddress(project.inputMap, zonesDrumId, slot) : null}
          {@const heardNote = store.inputBadge(note !== null ? { kind: 'midi', note } : null)}
          {@const heardOsc = store.inputBadge(addr ? { kind: 'osc', address: addr } : null)}
          {@const armed = zoneLearning(slot)}
          <div class="zone">
            <div class="zhead">
              <Select
                value={String(slot)}
                options={slotOptionsFor(slot)}
                onChange={(v) => changeSlot(slot, v)}
                ariaLabel="Zone slot"
              />
              <IconButton icon={Trash2} label="Remove zone" variant="soft" size={13} onclick={() => removeZone(slot)} />
            </div>
            <Field layout="row" label="Note" hint={note === null ? 'C-1 - G9' : String(note)}>
              <div class="note-row">
                <CommitInput
                  value={note === null ? '' : formatMidiNote(note)}
                  placeholder="none"
                  autofocus={false}
                  mono
                  allowEmpty
                  ariaLabel="Zone MIDI note"
                  onCommit={(v) => commitZoneNote(slot, v)}
                />
                <button
                  type="button"
                  class="learn"
                  class:active={armed}
                  onclick={(e) => {
                    e.preventDefault();
                    armed ? store.cancelMidiLearn() : store.startMidiLearn({ kind: 'zone', drumId: zonesDrumId, slot });
                  }}
                >
                  <Radio size={13} aria-hidden="true" />
                  {armed ? 'Listening' : 'Learn'}
                </button>
              </div>
            </Field>
            {#if heardNote}
              <div class="heard"><InputActivityBadge {...heardNote} /></div>
            {/if}
            <Field layout="row" label="OSC" hint="Sensory Percussion / Ableton">
              <CommitInput
                value={addr ?? ''}
                mono
                autofocus={false}
                allowEmpty
                placeholder="/drum/zone"
                ariaLabel="Zone OSC address"
                onCommit={(v) => commitZoneOsc(slot, v)}
              />
            </Field>
            {#if heardOsc}
              <div class="heard"><InputActivityBadge {...heardOsc} /></div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
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
    text-wrap: pretty;
  }
  .hint b {
    color: var(--text);
    font-weight: 600;
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
  /* --- Zones section (drum input wiring) — divided from the graph binding above --- */
  .zones {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-faint);
  }
  .sectionhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 24px;
  }
  .seclabel {
    font-size: var(--text-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .secdrum {
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-muted);
  }
  .zonelist {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .zone {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
  }
  .zhead {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
  }
</style>
