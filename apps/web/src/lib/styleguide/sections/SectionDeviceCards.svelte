<script lang="ts">
  /* Device cards (effect chains, S06b): the Generator, Modifier and Control panels the device
     strip lays out left to right. Every card here is the real component over a real authoring
     api — `createStandaloneEffectsApi`, an in-memory section — so the edits work, fold into
     undo steps, and the modulated badges follow the mappings exactly as in the app. */
  import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
  import DemoCard from '../DemoCard.svelte';
  import { MASTER_CELL } from '../../trigger-lab/effects-api';
  import { createStandaloneEffectsApi } from '../../trigger-lab/effects-controller.svelte';
  import GeneratorCard from '../../app/views/effects/strip/cards/GeneratorCard.svelte';
  import ModifierCard from '../../app/views/effects/strip/cards/ModifierCard.svelte';
  import ControlCard from '../../app/views/effects/strip/cards/ControlCard.svelte';

  const kit: KitConfig = {
    ...DEFAULT_KIT,
    drums: DEFAULT_KIT.drums.slice(0, 2).map((d, i) => ({ ...d, id: i === 0 ? 'kick' : 'snare', label: i === 0 ? 'Kick' : 'Snare' })),
  };
  const head = { row: 'kick', column: { kind: 'zone' as const, slot: 0 } };
  const snareHead = { row: 'snare', column: { kind: 'zone' as const, slot: 0 } };

  const parse = effectChain.parseEffect;
  const radialSpeed = effectChain.generatorParamSpec('wave', 'radial').find((s) => s.type === 'number')?.key ?? 'speed';

  const pulse = parse({
    id: 'fx-pulse',
    name: 'Pulse',
    cell: head,
    generator: { kind: 'wave', style: 'radial' },
    modifiers: [
      { uid: 'mod-strobe', modifierId: 'strobe', mix: 0.8, envelope: { attackMs: 0, decayMs: 120, sustainLevel: 0.6, releaseMs: 300 } },
      { uid: 'mod-trail', modifierId: 'trail', bypass: true },
    ],
    controls: [
      {
        uid: 'ctl-lfo',
        kind: 'lfo',
        settings: { rateMode: 'beats', division: '1/4' },
        mappings: [
          { device: 'generator', param: radialSpeed, amount: 0.6 },
          { device: 'mod-strobe', param: 'rate', amount: 0.4, invert: true },
        ],
      },
      { uid: 'ctl-cc', kind: 'cc', settings: { controller: 74, channel: 10 }, mappings: [] },
      { uid: 'ctl-env', kind: 'envelope', settings: { points: undefined }, mappings: [{ device: 'mod-strobe', param: 'rate' }] },
    ],
  });
  const cut = parse({
    id: 'fx-cut',
    name: 'Cut',
    cell: snareHead,
    generator: {
      kind: 'splice',
      params: { count: 3, chase: 'step', rateMode: 'beats', division: '1/8' },
      slots: [{ color: '#ff3b30' }, { color: '#0a84ff', generator: { kind: 'noise', style: '', params: {} } }, { muted: true, color: '#ffcc00' }],
    },
  });

  const api = createStandaloneEffectsApi(
    {
      effects: [pulse, cut],
      master: [effectChain.modifierDeviceSchema.parse({ uid: 'master-hue', modifierId: 'hue-shift' })],
    },
    kit,
  );
  const viewer = createStandaloneEffectsApi({ effects: [pulse], master: [] }, kit, { canEdit: false });

  const fxPulse = $derived(api.effectById('fx-pulse'));
  const fxCut = $derived(api.effectById('fx-cut'));
  const viewerPulse = $derived(viewer.effectById('fx-pulse'));
</script>

<section class="block" id="device-cards">
  <div class="block-head">
    <h2>Device cards</h2>
    <p>
      The panels of an Effect's chain, after Ableton's Device View: fixed width, fixed height, every
      parameter on the face, a power toggle and a fold on the title bar. Role colour marks the family
      on the top rule only. Generator is <code>--role-content</code>, Modifier is <code>--role-effect</code> and
      Control is <code>--role-mod</code>. A param a Control drives carries the modulation badge on its own card.
    </p>
  </div>

  <div class="stack">
    <DemoCard
      title="Chain row · Generator · Modifiers · Controls"
      src={['lib/app/views/effects/strip/cards/GeneratorCard', 'lib/app/views/effects/strip/cards/ModifierCard', 'lib/app/views/effects/strip/cards/ControlCard', 'lib/app/views/effects/strip/cards/DeviceCard']}
      note="Live against an in-memory section: edits apply and undo. The strobe is enveloped and modulated by the LFO (inverted) and the Envelope control. Trail is bypassed (power off), so its face dims but stays editable."
      wide
    >
      <div class="chain" data-testid="device-cards-chain" aria-label="Device cards chain demo">
        {#if fxPulse}
          <GeneratorCard {api} effect={fxPulse} />
          {#each fxPulse.modifiers as m (m.uid)}
            <ModifierCard {api} effectId={fxPulse.id} modifier={m} />
          {/each}
          {#each fxPulse.controls as c (c.uid)}
            <ControlCard {api} effect={fxPulse} control={c} />
          {/each}
        {/if}
      </div>
    </DemoCard>

    <DemoCard
      title="Splice Generator · slots · Master chain modifier"
      src={['lib/app/views/effects/strip/cards/SlotsEditor', 'lib/app/views/effects/strip/cards/ModifierCard']}
      note="Splice and Slice have no Styles: the card shows the slots (colour, a nested Generator, or both; a muted slot stays listed) and the settings its motion needs. Master-chain modifiers take effectId = MASTER_CELL and have no per-device file save."
      wide
    >
      <div class="chain" data-testid="device-cards-splice" aria-label="Device cards splice demo">
        {#if fxCut}<GeneratorCard {api} effect={fxCut} />{/if}
        {#each api.masterChain as m (m.uid)}
          <ModifierCard {api} effectId={MASTER_CELL} modifier={m} />
        {/each}
      </div>
    </DemoCard>

    <DemoCard
      title="Viewer · read-only"
      src="lib/app/views/effects/strip/cards/GeneratorCard"
      note="A viewer or a canonical-library song: every control is disabled; folding is view state and still works."
      wide
    >
      <div class="chain short">
        {#if viewerPulse}
          <GeneratorCard api={viewer} effect={viewerPulse} />
          <ModifierCard api={viewer} effectId={viewerPulse.id} modifier={viewerPulse.modifiers[0]!} />
        {/if}
      </div>
    </DemoCard>
  </div>
</section>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  /* A chain row as the strip lays it out: fixed height, horizontal scroll, cards never squeeze. */
  .chain {
    display: flex;
    gap: var(--space-1);
    height: 440px;
    padding: var(--space-1);
    overflow-x: auto;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border-faint);
  }
  .chain.short {
    height: 320px;
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
</style>
