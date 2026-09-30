<script lang="ts">
  /* Effects grid (effect chains, S06a): the GridCell face in every state, and the live grid over the
     in-memory standalone authoring api (the same EffectsAuthoringApi the store implements), so the
     demo exercises the real selection, roving focus, Generator picker and cell menu. */
  import { DEFAULT_KIT, effectChain, inputMapSchema, type KitConfig } from '@ledrums/core';
  import { MASTER_CELL } from '../../trigger-lab/effects-api';
  import { createStandaloneEffectsApi } from '../../trigger-lab/effects-controller.svelte';
  import GridCell from '../../app/views/effects/grid/GridCell.svelte';
  import EffectsGrid from '../../app/views/effects/grid/EffectsGrid.svelte';
  import EffectsView from '../../app/views/effects/EffectsView.svelte';
  import DemoCard from '../DemoCard.svelte';

  type EffectCell = effectChain.EffectCell;

  const base = DEFAULT_KIT.drums[0]!;
  const kit: KitConfig = {
    ...DEFAULT_KIT,
    drums: [
      { ...base, id: 'kick', label: 'Kick', color: '#ff5f4a' },
      { ...base, id: 'snare', label: 'Snare', color: '#4ab8ff' },
      { ...base, id: 'tom1', label: 'Tom 1', color: '#9b7bff' },
      { ...base, id: 'tom2', label: 'Tom 2', color: '#3fd18b' },
    ],
  };
  // Uneven zones on purpose: Kick has three, the toms one — the grid shows the union, the rest disabled.
  const inputMap = inputMapSchema.parse({
    zones: [
      { drumId: 'kick', slot: 0 },
      { drumId: 'kick', slot: 1 },
      { drumId: 'kick', slot: 2, label: 'Rim' },
      { drumId: 'snare', slot: 0 },
      { drumId: 'snare', slot: 1 },
      { drumId: 'tom1', slot: 0 },
      { drumId: 'tom2', slot: 0 },
    ],
  });
  const zone = (row: string, slot: number): EffectCell => ({ row, column: { kind: 'zone', slot } });
  const fx = (id: string, name: string, cell: EffectCell, kind: effectChain.GeneratorKind, extra: Record<string, unknown> = {}) =>
    effectChain.parseEffect({ id, name, cell, generator: { kind }, ...extra });

  const api = createStandaloneEffectsApi(
    {
      effects: [
        fx('e1', 'Kick bloom', zone('kick', 0), 'wave'),
        fx('e2', 'Sparks', zone('kick', 0), 'particles'),
        fx('e3', 'Floor', zone('kick', 0), 'solid'),
        fx('e4', 'Crack', zone('snare', 0), 'lightning'),
        fx('e5', 'Ghost', zone('snare', 1), 'noise', { bypass: true }),
        fx('e6', 'Tom wash', zone('tom1', 0), 'gradient'),
        fx('e7', 'Bed', { row: 'kit', column: { kind: 'always' } }, 'noise'),
        fx('e8', 'Bar pulse', { row: 'kit', column: { kind: 'clock' } }, 'pattern'),
      ],
      master: [],
    },
    kit,
    { inputMap },
  );
  api.addModifier(MASTER_CELL, 'strobe');
  api.selectCell(zone('kick', 0));

  // The dense end of the range: six drums, eight zones each (and one drum with just one).
  const denseKit: KitConfig = {
    ...DEFAULT_KIT,
    drums: ['Kick', 'Snare', 'Tom 1', 'Tom 2', 'Floor', 'Ride'].map((label, i) => ({
      ...base,
      id: `d${i}`,
      label,
      color: ['#ff5f4a', '#4ab8ff', '#9b7bff', '#3fd18b', '#ffb84a', '#ff6fd0'][i]!,
    })),
  };
  const denseApi = createStandaloneEffectsApi(
    { effects: [fx('x1', 'Downbeat', zone('d0', 0), 'wave'), fx('x2', 'Rim shot', zone('d1', 7), 'lightning')], master: [] },
    denseKit,
    {
      inputMap: inputMapSchema.parse({
        zones: denseKit.drums.flatMap((d, i) => (i === 5 ? [0] : [0, 1, 2, 3, 4, 5, 6, 7]).map((slot) => ({ drumId: d.id, slot }))),
      }),
    },
  );

  let fireAt = $state(0);
  // The view persists its strip height here, as the store does in paneSizes.
  const panes = $state({ paneSizes: {} as Record<string, number> });
</script>

<section class="block" id="effects-grid">
  <div class="block-head">
    <h2>Effects grid</h2>
    <p>
      Each section as a grid: the Kit and each drum (rows) by the drums' zones, then Always · Clock ·
      Cue (columns). A cell is a stack of Effects; the Kit row starts with the Master cell (the
      section's master modifier chain). The device strip below it edits the selection.
    </p>
  </div>

  <div class="eg-grid">
    <DemoCard
      title="Grid cell — states"
      src="lib/app/views/effects/grid/GridCell"
      note="Face: the first Effect's generator icon (--role-content) + name, stack pips (a number past four), the generator on the second line. Empty cells show a + on hover / focus. All-bypassed strikes the name and greys the pips. Selected is an accent ring; keyboard focus adds --accent-ring. Disabled (a zone the drum doesn't have, zones on the Kit row) is sunken, hatched and inert. Fire is an overlay flash — instant on, --dur-220 decay, no layout shift. Hover is instant."
      wide
    >
      <div class="states">
        <figure><GridCell label="Empty" count={0} /><figcaption>empty</figcaption></figure>
        <figure><GridCell label="One" count={1} firstName="Kick bloom" firstGenerator="wave" /><figcaption>1 Effect</figcaption></figure>
        <figure><GridCell label="Stack" count={3} firstName="Sparks" firstGenerator="particles" /><figcaption>stack of 3</figcaption></figure>
        <figure><GridCell label="Deep stack" count={7} firstName="Floor" firstGenerator="solid" /><figcaption>stack of 7</figcaption></figure>
        <figure><GridCell label="Bypassed" count={2} firstName="Ghost" firstGenerator="noise" allBypassed /><figcaption>all bypassed</figcaption></figure>
        <figure><GridCell label="Selected" count={1} firstName="Crack" firstGenerator="lightning" selected /><figcaption>selected</figcaption></figure>
        <figure><GridCell label="Disabled" count={0} enabled={false} /><figcaption>disabled</figcaption></figure>
        <figure><GridCell label="Master" variant="master" count={2} /><figcaption>Master</figcaption></figure>
        <figure>
          <GridCell label="Fire" count={1} firstName="Hit me" firstGenerator="lightning" {fireAt} onselect={() => (fireAt = performance.now())} />
          <figcaption>click → fire flash</figcaption>
        </figure>
      </div>
    </DemoCard>

    <DemoCard
      title="Effects grid"
      src={['lib/app/views/effects/grid/EffectsGrid', 'lib/app/views/effects/grid/GeneratorPicker', 'lib/app/views/effects/grid/grid-nav']}
      note="Live over createStandaloneEffectsApi. Click selects · double-click an empty cell opens the Generator picker · right-click: add, copy, paste, save / load file, clear. One roving tab stop: arrows / Home / End move (skipping disabled cells; ArrowLeft off the Kit row reaches the Master), Enter or Space selects. Digits 1–9 / 0 stay the app's audition keys (fireEffectAt, grid order) while a cell has focus. Zone headers use the zone's name when every drum agrees, else Zone N; the trigger columns sit after a divider."
      wide
    >
      <div class="grid-demo">
        <EffectsGrid {api} />
      </div>
    </DemoCard>

    <DemoCard
      title="Effects grid — dense"
      src="lib/app/views/effects/grid/EffectsGrid"
      note="Six drums × eight zones: columns shrink to a 96px floor, then the grid scrolls inside the view with its headers pinned (sticky column headers and row labels). Zone headers fall back to Zone N where drums disagree on a slot's name."
      wide
    >
      <div class="grid-demo dense"><EffectsGrid api={denseApi} /></div>
    </DemoCard>

    <DemoCard
      title="Effects view"
      src="lib/app/views/effects/EffectsView"
      note="The shell's Effects tab (the trigger view): the Grid on top, a resizable splitter (height persisted in paneSizes as effectsStripH), the device strip below showing the selected cell — Ableton's Device View. The visualiser and docks stay in the shell's right column. Shares the api above, so a selection here drives both."
      wide
    >
      <div class="view-demo"><EffectsView {api} {panes} /></div>
    </DemoCard>
  </div>
</section>

<style>
  .eg-grid {
    display: grid;
    gap: var(--space-4);
  }
  .states {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    gap: var(--space-3);
  }
  figure {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    min-width: 0;
  }
  figcaption {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .grid-demo.dense {
    max-width: 1100px;
    max-height: 360px;
  }
  .view-demo {
    height: 620px;
  }
  .grid-demo {
    overflow: auto;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    background: var(--surface);
  }
</style>
