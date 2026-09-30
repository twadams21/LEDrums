<script lang="ts">
  /* Effect-chain setlist composites (effect chains S06c): the Sections-view column's per-cell
     Effect summary (SectionColumn + SectionCellRow) and the legacy-show notice + confirm
     dialog. Rendered from the REAL components over a standalone authoring api
     and a minimal store stub (section arrangement only). Not registered in Styleguide.svelte by
     this piece — the orchestrator registers it at merge. */
  import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
  import { createStandaloneEffectsApi } from '../../trigger-lab/effects-controller.svelte';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../../app/shell-store.svelte';
  import type { SetlistSection, Song } from '../../app/setlist';
  import SectionColumn from '../../app/views/SectionColumn.svelte';
  import SectionCellRow from '../../app/views/SectionCellRow.svelte';
  import LegacyImportNotice from '../../app/import/LegacyImportNotice.svelte';
  import LegacyImportDialog from '../../app/import/LegacyImportDialog.svelte';
  import DemoCard from '../DemoCard.svelte';

  type EffectCell = effectChain.EffectCell;

  const kit: KitConfig = {
    ...DEFAULT_KIT,
    drums: [
      { ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick', color: '#ff5a36' },
      { ...DEFAULT_KIT.drums[0]!, id: 'snare', label: 'Snare', color: '#3aa7ff' },
      { ...DEFAULT_KIT.drums[0]!, id: 'tom1', label: 'Tom 1', color: '#b36bff' },
    ],
  };
  const cell = (row: string, column: EffectCell['column']): EffectCell => ({ row, column });
  const fx = (id: string, name: string, at: EffectCell, bypass = false) =>
    effectChain.parseEffect({ id, name, cell: at, bypass, generator: { kind: 'solid' } });

  const busy = {
    id: 'sg-chorus',
    name: 'Chorus',
    graphs: [],
    looks: {},
    effects: [
      fx('e1', 'Wash', cell('kit', { kind: 'always' })),
      fx('e2', 'Pulse', cell('kick', { kind: 'zone', slot: 0 })),
      fx('e3', 'Sparkle tail', cell('kick', { kind: 'zone', slot: 0 })),
      fx('e4', 'Rim flash', cell('snare', { kind: 'zone', slot: 1 })),
      fx('e5', 'Ghost', cell('tom1', { kind: 'clock' }), true),
    ],
    master: [{ uid: 'm1', modifierId: 'strobe', params: {}, mix: 1, bypass: false }],
  } as unknown as SetlistSection;
  const empty = { id: 'sg-intro', name: 'Intro', graphs: [], looks: {}, effects: [], master: [] } as unknown as SetlistSection;
  const song = { id: 'sg-song', name: 'Demo song', sections: [empty, busy] } as Song;

  const api = createStandaloneEffectsApi({ effects: [], master: [] }, kit);
  const noop = (): void => {};
  const storeStub = {
    activeSectionId: 'sg-chorus',
    canEditActiveSong: true,
    canEdit: true,
    isViewer: false,
    isLocalSong: () => true,
    activeSongById: song,
    setActiveSection: noop,
    renameSection: noop,
  } as unknown as TriggerLab;
  const shellStub = { select: noop, setView: noop } as unknown as ShellStore;

  const showNames = ['Spring tour 2026', 'Festival set', 'Rehearsal'];
  let dialogOpen = $state(false);
  let noticeShown = $state(true);
</script>

<section class="block" id="setlist-effects">
  <div class="block-head">
    <h2>Setlist — Effect summaries &amp; import</h2>
    <p>
      How the Sections view reads an Effect grid without opening it, and how shows from the
      graph-era format come across. Rendered from the shipped components.
    </p>
  </div>

  <div class="comp-grid">
    <DemoCard
      title="Section column — per-cell Effect summary"
      src={['lib/app/views/SectionColumn', 'lib/app/views/SectionCellRow', 'lib/app/views/section-effects']}
      note="One row per occupied grid cell, in grid order (rows, then columns): the row chip carries the drum colour, the column label follows, the Effect names read in stack order, and a stacked cell shows its count in tabular numerals. The Master chain sits first in the modifier role colour. A fully bypassed cell dims, strikes through and wears a power-off glyph. Click opens the cell in the Effects view; hover is instant border colour, no lift."
      wide
    >
      <div class="cols">
        <SectionColumn store={storeStub} {api} shell={shellStub} {song} section={empty} onSectionDragStart={noop} onDragEnd={noop} />
        <SectionColumn store={storeStub} {api} shell={shellStub} {song} section={busy} onSectionDragStart={noop} onDragEnd={noop} />
      </div>
    </DemoCard>

    <DemoCard
      title="Cell row states"
      src="lib/app/views/SectionCellRow"
      note="Rest · open in the Effects view (accent wash) · bypassed · the Master chain."
    >
      <div class="rows">
        <SectionCellRow row="Kick" column="Center" names={['Pulse', 'Sparkle tail']} color="#ff5a36" onOpen={noop} />
        <SectionCellRow row="Snare" column="Edge" names={['Rim flash']} color="#3aa7ff" active onOpen={noop} />
        <SectionCellRow row="Tom 1" column="Clock" names={['Ghost']} color="#b36bff" bypassed onOpen={noop} />
        <SectionCellRow row="Master" column="1 modifier" names={['Strobe']} master onOpen={noop} />
      </div>
    </DemoCard>

    <DemoCard
      title="Import notice + confirm dialog"
      src={['lib/app/import/LegacyImportNotice', 'lib/app/import/LegacyImportDialog', 'lib/app/import/legacy-import-view']}
      note="Offered once while old-format shows exist (the setlist ⋯ menu keeps it on demand). It says what is kept and dropped before anything happens; the dialog lists the shows and confirms. In the app the notice floats above the bottom bar at the workspace's lower-left; here it renders inline."
    >
      <div class="notice-demo" data-import-demo>
        {#if noticeShown}
          <LegacyImportNotice names={showNames} placement="inline" onReview={() => (dialogOpen = true)} onDismiss={() => (noticeShown = false)} />
        {:else}
          <button type="button" onclick={() => (noticeShown = true)}>Show the notice again</button>
        {/if}
      </div>
      <LegacyImportDialog
        open={dialogOpen}
        names={showNames}
        canImport
        onImport={() => ({ ok: true })}
        onClose={() => (dialogOpen = false)}
      />
    </DemoCard>
  </div>
</section>

<style>
  .comp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--space-5) var(--space-6);
  }
  .cols {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    overflow-x: auto;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 232px;
  }
  .notice-demo {
    display: flex;
    align-items: flex-start;
    min-height: 140px;
  }
</style>
