<script lang="ts">
  /* Setlist-section panel — an inline rename plus the read-only transport recall strings
     (OSC + MIDI CC#0 for the section, Program Change for its parent song). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { SectionRecall } from '../../recall';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';

  let { store, sectionId, sectionName, songName, sectionIdx, recall }: {
    store: TriggerLab;
    sectionId: string;
    sectionName: string;
    songName: string;
    sectionIdx: number;
    recall: SectionRecall;
  } = $props();
</script>

<header class="ihead">
  <div class="titles">
    <Eyebrow>Section</Eyebrow>
    <h3>{sectionName}</h3>
    <span class="sub">{songName} · #{sectionIdx + 1}</span>
  </div>
</header>
<div class="sectionbody">
  <Field label="Name" hint="display label">
    <CommitInput
      value={sectionName}
      placeholder="Section"
      ariaLabel="Section name"
      onCommit={(v) => store.renameSection(sectionId, v)}
    />
  </Field>

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
    padding: var(--space-2);
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
