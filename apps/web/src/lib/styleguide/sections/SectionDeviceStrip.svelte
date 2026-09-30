<script lang="ts">
  /* Device strip (effect chains, S06b) — the Ableton-style bottom strip, rendered from the REAL
     components over an in-memory `createStandaloneEffectsApi` (the same authoring contract the
     store implements), so every demo is live: edits, drags and undo steps behave as in the app. */
  import { DEFAULT_KIT, effectChain } from '@ledrums/core';
  import { MASTER_CELL } from '../../trigger-lab/effects-api';
  import { createStandaloneEffectsApi } from '../../trigger-lab/effects-controller.svelte';
  import type { EffectsSection } from '../../trigger-lab/effects-doc';
  import DeviceStrip from '../../app/views/effects/strip/DeviceStrip.svelte';
  import TriggerCard from '../../app/views/effects/strip/TriggerCard.svelte';
  import TargetCard from '../../app/views/effects/strip/TargetCard.svelte';
  import AddDeviceSlot from '../../app/views/effects/strip/AddDeviceSlot.svelte';
  import DeviceCard from '../../app/views/effects/strip/DeviceCard.svelte';
  import type { StripKitInfo } from '../../app/views/effects/strip/strip-model';
  import DemoCard from '../DemoCard.svelte';

  type EffectCell = effectChain.EffectCell;

  const kickHead: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
  const kickEdge: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 1 } };
  const snareClock: EffectCell = { row: 'snare', column: { kind: 'clock' } };
  const kitCue: EffectCell = { row: 'kit', column: { kind: 'cue' } };

  const fx = (input: effectChain.EffectInput) => effectChain.parseEffect(input);

  const section: EffectsSection = {
    effects: [
      fx({
        id: 'fx-pulse',
        name: 'Kick pulse',
        cell: kickHead,
        generator: { kind: 'wave', style: '' },
        modifiers: [
          { uid: 'mod-strobe', modifierId: 'strobe', mix: 0.6 },
          { uid: 'mod-trail', modifierId: 'trail' },
        ],
        controls: [{ uid: 'ctl-lfo', kind: 'lfo', mappings: [{ device: 'mod-strobe', param: 'rate', amount: 0.5 }] }],
        amp: { attackMs: 4, decayMs: 120, sustainLevel: 0.6, length: { ms: 400 }, releaseMs: 260 },
        blend: 'add',
        opacity: 0.85,
      }),
      fx({
        id: 'fx-wash',
        name: 'Base wash',
        cell: kickHead,
        bypass: true,
        generator: { kind: 'solid' },
        target: { kind: 'select', drums: [{ drumId: 'kick', hoops: [1, 2] }, { drumId: 'snare' }] },
        blend: 'screen',
        opacity: 0.4,
        retrigger: 'restart',
      }),
      fx({
        id: 'fx-tick',
        name: 'Bar tick',
        cell: snareClock,
        generator: { kind: 'particles' },
        trigger: { kind: 'clock', every: { bars: 1 }, offsetBeats: 0.5 },
        amp: { length: { beats: 1 } },
      }),
      fx({
        id: 'fx-cue',
        name: 'Drop cue',
        cell: kitCue,
        generator: { kind: 'lightning' },
        trigger: { kind: 'cue', source: { midiNote: 36, oscAddress: '/live/drop' } },
        target: { kind: 'hitDrum' },
      }),
    ],
    master: [
      effectChain.modifierDeviceSchema.parse({ uid: 'mod-m-levels', modifierId: 'levels' }),
      effectChain.modifierDeviceSchema.parse({ uid: 'mod-m-hue', modifierId: 'hue-shift', mix: 0.5 }),
    ],
  };

  /* The Target card's per-hoop picking reads the optional `drumHoopCount` extension. */
  const api = Object.assign(createStandaloneEffectsApi(section, DEFAULT_KIT), {
    drumHoopCount: (drumId: string) => DEFAULT_KIT.drums.find((d) => d.id === drumId)?.hoops?.length ?? 0,
  } satisfies StripKitInfo);
  api.selectEffect('fx-pulse');

  const pulse = $derived(api.effectById('fx-pulse')!);
  const wash = $derived(api.effectById('fx-wash')!);
  const tick = $derived(api.effectById('fx-tick')!);
  const cue = $derived(api.effectById('fx-cue')!);

  const viewer = createStandaloneEffectsApi(section, DEFAULT_KIT, { canEdit: false });
</script>

<section class="block" id="device-strip">
  <div class="block-head">
    <h2>Device strip — effect chains</h2>
    <p>
      The selected cell's Effect stack as Ableton-style device chains: Trigger · Generator ·
      Modifiers · Controls · Target, every param on the card face. Cards are a fixed width and the
      chain scrolls sideways; grips reorder (drag, or arrow keys); "+" slots add devices. Role
      colours: trigger <code>--role-input</code>, generator <code>--role-content</code>, modifier
      <code>--role-effect</code>, control <code>--role-mod</code>, target <code>--role-output</code>.
    </p>
  </div>

  <div class="strip-grid">
    <DemoCard
      title="Device strip — stacked cell"
      src={['lib/app/views/effects/strip/DeviceStrip', 'lib/app/views/effects/strip/EffectChain', 'lib/app/views/effects/strip/EffectHeader']}
      note="Kick · Center with two Effects. Header: grip, power, audition (fire flash), name (double-click to rename), blend, opacity, retrigger, menu (also right-click). The bypassed Effect dims."
      wide
    >
      <div class="frame tall"><DeviceStrip {api} cell={kickHead} /></div>
    </DemoCard>

    <DemoCard title="Device strip — Master" src="lib/app/views/effects/strip/DeviceStrip" note="The section's master modifier chain: modifiers only." wide>
      <div class="frame short"><DeviceStrip {api} cell={MASTER_CELL} /></div>
    </DemoCard>

    <DemoCard title="Trigger card — zone" src={['lib/app/views/effects/strip/TriggerCard', 'lib/app/views/effects/strip/AmpEnvelopeField']}
      note="Kind switch moves the Effect's column. Zone is read-only (the cell's); the amp ADSR sits below.">
      <div class="cards"><TriggerCard {api} effect={pulse} /></div>
    </DemoCard>

    <DemoCard title="Trigger card — clock" src="lib/app/views/effects/strip/TriggerCard" note="Period (beat / bar divisions) and an offset in beats.">
      <div class="cards"><TriggerCard {api} effect={tick} /></div>
    </DemoCard>

    <DemoCard title="Trigger card — cue" src="lib/app/views/effects/strip/TriggerCard" note="MIDI note / CC / OSC, typed or learned (Learn toggles the store's cue learn).">
      <div class="cards"><TriggerCard {api} effect={cue} /></div>
    </DemoCard>

    <DemoCard title="Target card" src="lib/app/views/effects/strip/TargetCard"
      note="Kit / Hit drum / Select. Select toggles drums in kit colour and narrows to hoops when the host reports hoop counts.">
      <div class="cards">
        <TargetCard {api} effect={wash} />
        <TargetCard {api} effect={cue} />
      </div>
    </DemoCard>

    <DemoCard title="Device card shell + add slots" src={['lib/app/views/effects/strip/DeviceCard', 'lib/app/views/effects/strip/AddDeviceSlot']}
      note="The shared panel: power, role-tinted icon, name, fold. Folded, it collapses to a spine. + slots open the modifier palette (by category) or the control kinds.">
      <div class="cards">
        <DeviceCard title="Device" tint="var(--role-effect)" width={180} power={{ on: true, onChange: () => {} }}>
          <span class="face-note">Params sit on the face.</span>
        </DeviceCard>
        <DeviceCard title="Folded" tint="var(--role-mod)" folded>
          <span class="face-note">Hidden while folded.</span>
        </DeviceCard>
        <AddDeviceSlot {api} kind="modifier" owner="fx-pulse" />
        <AddDeviceSlot {api} kind="control" owner="fx-pulse" />
      </div>
    </DemoCard>

    <DemoCard title="Device strip — empty states" src="lib/app/views/effects/strip/DeviceStrip" note="No selection; an empty cell (Add Effect picks a Generator); a viewer's read-only strip.">
      <div class="empties">
        <div class="frame mini"><DeviceStrip {api} cell={null} /></div>
        <div class="frame mini"><DeviceStrip {api} cell={kickEdge} /></div>
      </div>
    </DemoCard>

    <DemoCard title="Device strip — viewer (read-only)" src="lib/app/views/effects/strip/DeviceStrip" note="canEdit false: every control disabled; audition still works." wide>
      <div class="frame tall"><DeviceStrip api={viewer} cell={kickHead} /></div>
    </DemoCard>
  </div>
</section>

<style>
  .strip-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--space-5) var(--space-6);
  }
  .frame {
    overflow: hidden;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
  }
  .frame.tall {
    height: 560px;
  }
  .frame.short {
    height: 300px;
  }
  .frame.mini {
    height: 160px;
  }
  .cards {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-2);
    --device-h: 240px;
  }
  .empties {
    display: grid;
    gap: var(--space-2);
  }
  .face-note {
    color: var(--text-faint);
    font-size: var(--text-2xs);
  }
</style>
