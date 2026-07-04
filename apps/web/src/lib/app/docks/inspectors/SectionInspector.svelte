<script lang="ts">
  /* Setlist-section panel — an inline rename plus the read-only transport recall strings
     (OSC + MIDI CC#0 for the section, Program Change for its parent song). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { SectionRecall } from '../../recall';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Select from '../../../ui/Select.svelte';
  import { busIcon } from '../../views/trigger-node-meta';

  let { store, sectionId, sectionName, songName, sectionIdx, recall, looks }: {
    store: TriggerLab;
    sectionId: string;
    sectionName: string;
    songName: string;
    sectionIdx: number;
    recall: SectionRecall;
    /** The section's authored per-bus looks (bus id → effect id, or null/absent = None). */
    looks: Record<string, string | null>;
  } = $props();

  /** Look options for a bus: "None" plus every effect whose HOME bus is this one — a look
      spawns on the effect's own bus (S15), so listing only home-bus effects keeps the pick and
      the result on the same bus (no cross-bus surprise). */
  const lookOptions = (busId: string) => [
    { value: '', label: 'None' },
    ...store.effects.filter((e) => e.busId === busId).map((e) => ({ value: e.id, label: e.name })),
  ];
</script>

<header class="ihead">
  <div class="titles">
    <Eyebrow>Section</Eyebrow>
    <h3>{sectionName}</h3>
    <span class="sub">{songName} · #{sectionIdx + 1}</span>
  </div>
</header>
<div class="sectionbody">
  <Field layout="row" label="Name" hint="display label">
    <CommitInput
      value={sectionName}
      placeholder="Section"
      ariaLabel="Section name"
      onCommit={(v) => store.renameSection(sectionId, v)}
    />
  </Field>

  <div class="looks">
    <Eyebrow>Looks</Eyebrow>
    <p class="grouphint">The effect each bus loops while this section plays. Recall the section to preview it live.</p>
    <div class="look-rows">
      {#each store.buses as bus (bus.id)}
        {@const Icon = busIcon[bus.id]}
        <div class="look-row">
          <span class="look-bus">
            {#if Icon}<Icon size={14} aria-hidden="true" />{/if}
            <span class="look-busname">{bus.name}</span>
          </span>
          <Select
            value={looks[bus.id] ?? ''}
            options={lookOptions(bus.id)}
            onChange={(v) => store.setLook(sectionId, bus.id, v === '' ? null : v)}
            placeholder="None"
            ariaLabel={`${bus.name} look`}
          />
        </div>
      {/each}
    </div>
  </div>

  <div class="recall">
    <Eyebrow>Recall via</Eyebrow>
    <p class="grouphint">Global transport messages — read-only. Send these from a DAW or controller to recall this section.</p>
    <div class="recall-row">
      <span class="k">OSC</span>
      <code class="rcode">{recall.osc}</code>
    </div>
    <div class="recall-row">
      <span class="k">MIDI CC</span>
      <code class="rcode">{recall.midiSection}</code>
    </div>
    <div class="recall-row">
      <span class="k">Program Change</span>
      <code class="rcode">{recall.midiSong}</code>
    </div>
    <p class="hint">Program Change selects this section's song; CC #0 and the OSC argument pick the section by its index.</p>
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
  .k {
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-size: var(--text-2xs);
  }
  .sectionbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .looks {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .look-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .look-row {
    display: grid;
    grid-template-columns: var(--field-label-col, 6.5rem) 1fr;
    align-items: center;
    gap: var(--space-2);
  }
  .look-bus {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .look-bus :global(svg) {
    flex: none;
    color: var(--text-faint);
  }
  .look-busname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* stretch the Select (an inline-flex primitive) to fill the row's control column */
  .look-row :global(.sel) {
    width: 100%;
  }
  .recall {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .recall-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .rcode {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink);
    padding: var(--space-1) var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    overflow-wrap: anywhere;
    user-select: all;
  }
  .grouphint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
</style>
