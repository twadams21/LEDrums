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
  import GeneratorCard from '../../app/views/effects/strip/cards/GeneratorCard.svelte';
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

  /* A sequenced cell: three Effects that play one per hit, reset by a MIDI note. */
  const snareHead: EffectCell = { row: 'snare', column: { kind: 'zone', slot: 0 } };
  const sequenced = createStandaloneEffectsApi(
    {
      effects: [
        fx({ id: 'fx-s1', name: 'Ripple red', cell: snareHead, generator: { kind: 'wave', style: '' } }),
        fx({ id: 'fx-s2', name: 'Ripple green', cell: snareHead, generator: { kind: 'wave', style: '' } }),
        fx({ id: 'fx-s3', name: 'Ripple blue', cell: snareHead, generator: { kind: 'wave', style: '' } }),
      ],
      master: [],
      cellPlay: [{ cell: snareHead, mode: 'sequence', reset: { kind: 'midiNote', note: 48 } }],
    },
    DEFAULT_KIT,
  );

  /* The Splice card (its own sectioned face) and a long generic one (Slice) — both landscape. */
  const spliceApi = createStandaloneEffectsApi(
    {
      effects: [
        fx({
          id: 'fx-splice',
          name: 'Splice',
          cell: kickHead,
          target: { kind: 'kit' },
          generator: { kind: 'splice', slots: [{ color: '#ff3b30' }, { color: '#0a84ff' }], params: { chase: 'step', waitMode: 'dark', drumOffsetDivision: '1/8' } },
        }),
        fx({ id: 'fx-slice', name: 'Slice', cell: kickHead, generator: { kind: 'slice' } }),
        fx({ id: 'fx-dot-kit', name: 'Dots round the kit', cell: kickHead, generator: { kind: 'dot', style: 'dot', params: { startDrum: 'snare', startHoop: 2, startAngle: 90, randAngle: 0.25, through: 'kit', kitOrder: 'kit', colorMode: 'per-pixel', length: 5 } }, amp: { length: 'auto' } }),
        fx({ id: 'fx-dot', name: 'Dots', cell: kickHead, target: { kind: 'kit' }, generator: { kind: 'dot', style: 'dot', params: { count: 3, trail: 4, colorMode: 'per-hit', through: 'space', spaceX: 0.3, spaceY: 0.6, spaceZ: 0.7 } }, amp: { length: 'auto' } }),
        fx({ id: 'fx-dot-order', name: 'Dots in order', cell: kickHead, target: { kind: 'kit' }, generator: { kind: 'dot', style: 'dot', params: { through: 'kit', kitOrder: 'custom', kitList: 'tom1,snare,tom2,kick' } }, amp: { length: 'auto' } }),
      ],
      master: [],
    },
    DEFAULT_KIT,
  );
  const spliceFx = $derived(spliceApi.effectById('fx-splice')!);
  const sliceFx = $derived(spliceApi.effectById('fx-slice')!);
  const dotFx = $derived(spliceApi.effectById('fx-dot')!);
  const dotKitFx = $derived(spliceApi.effectById('fx-dot-kit')!);
  const dotOrderFx = $derived(spliceApi.effectById('fx-dot-order')!);
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

    <DemoCard
      title="Device strip — Sequence / Random cell"
      src={['lib/app/views/effects/strip/CellPlayBar', 'lib/app/views/effects/strip/EffectHeader']}
      note="The Play bar above the stack: Layer (every Effect per hit, the default) · Sequence (one per hit, top to bottom) · Random (one per hit, no immediate repeat). Steps are the un-bypassed rows, numbered in their headers; ▶ marks the one played last. A step's Retrigger Cut stops the previous step the instant it plays, with no release fade. Reset rewinds to step 1 on section start, and optionally on a drum zone, MIDI note or CC (typed or learned) or an OSC address. Hidden on Always cells and empty cells."
      wide
    >
      <div class="frame tall"><DeviceStrip api={sequenced} cell={snareHead} /></div>
    </DemoCard>

    <DemoCard title="Device strip — Master" src="lib/app/views/effects/strip/DeviceStrip" note="The section's master modifier chain: modifiers only." wide>
      <div class="frame short"><DeviceStrip {api} cell={MASTER_CELL} /></div>
    </DemoCard>

    <DemoCard
      title="Generator card — Splice"
      src={['lib/app/views/effects/strip/cards/SpliceFace', 'lib/app/views/effects/strip/cards/splice-face', 'lib/app/views/effects/strip/cards/SlotsEditor']}
      note="The graph-era Splice inspector's sections and words, one column each: SPLICE · MOVE AROUND · MOVE THROUGH (the brightness envelope is the Effect's own, on the Trigger card — a part that pulses or fades runs it), the Splices rows (one per band — Count) beside the kind picker. Timings are one dropdown (divisions, None, Free (ms)); an active cascade shows its Order — drag the chips or pick a pattern. Rows a mode makes meaningless stay hidden."
      wide
    >
      <div class="cards"><GeneratorCard api={spliceApi} effect={spliceFx} /></div>
    </DemoCard>

    <DemoCard
      title="Generator card — Slice"
      src={['lib/app/views/effects/strip/cards/SpliceFace', 'lib/app/views/effects/strip/cards/splice-face', 'lib/app/views/effects/strip/cards/ParamRows']}
      note="The graph-era Slice inspector on the same face: SLICE — On (Kit · Drum · Space; it writes the Effect's Target, Space adds a box of the room, seeded from the kit's bounds), Axis, Tilt X/Y/Z, Slices, Random lengths, Smudge, Seed, Velocity (ⓘ) — then MOVE AROUND (Sweep, not Spin), MOVE THROUGH (THROUGH KIT · THROUGH SLICES · COLOUR CHASE); the envelope is the Trigger card's. A new Slice cuts the whole kit. Past 12 rows any card's param list goes landscape in balanced columns (PARAM_ROWS_MAX)."
      wide
    >
      <div class="cards"><GeneratorCard api={spliceApi} effect={sliceFx} /></div>
    </DemoCard>

    <DemoCard
      title="Generator card — sectioned params (Dot)"
      src={['lib/app/views/effects/strip/cards/ParamRows', 'lib/app/views/effects/strip/cards/card-model']}
      note="Params that name a section (core ParamSpec.section) sit under capitalised headers — DOTS · RANDOM · LIFE · SHAPE · MOVEMENT · COLOUR · BACKGROUND · VELOCITY — packed into columns left to right: a section joins the column above while it stays within 14 lines (a header counts as one), so short sections share a column and the card stays compact. A hairline separates the columns, as on the Splice face. Explanations sit behind ⓘ (ParamSpec.info). A param with showIf appears only in the mode it acts in (Travel angle for Through a drum / kit / space; Heading, Size and the Start X · Y · Z point through space; Swing for Ping-pong; Start drum · Start hoop · Start angle for a Set point on the hoops; showIf conditions can be combined, each with is or not); an optionsFrom: 'drums' enum lists the kit's drums, after Drum you hit. Through space, the Start point is a space-point widget: the kit as the visualiser's Top camera (width × depth, x to the right, the drummer's side at the top) and Front camera (width × height), each drum drawn as its hoops — click, drag, or arrow keys; the depth and height params it also edits (partOf) have no rows."
      wide
    >
      <div class="cards"><GeneratorCard api={spliceApi} effect={dotFx} /></div>
    </DemoCard>

    <DemoCard title="Trigger card — zone" src={['lib/app/views/effects/strip/TriggerCard', 'lib/app/views/effects/strip/AmpEnvelopeField']}
      note="Kind switch moves the Effect's column. Zone is read-only (the cell's). Below, the Effect's brightness envelope: Attack · Curve · Sustain (time, beats, While held, Loop) · Decay — the one envelope the Effect has; the old ADSR drop (Drop / Drop to) shows only on an Effect that still uses one.">
      <div class="cards"><TriggerCard {api} effect={pulse} /></div>
    </DemoCard>

    <DemoCard
      title="Generator card — widgets (Dot through the kit)"
      src={['lib/app/views/effects/strip/cards/HoopAngleRing', 'lib/ui/SegmentedControl', 'lib/app/views/effects/strip/cards/ParamRows']}
      note="Params can ask for a richer control (core ParamSpec.widget). hoop-pick: a button per hoop of the start drum (rangeFrom start-hoops). hoop-angle: the Start angle as the hoop itself, seen from the throne — one dot per pixel of the start hoop (rangeFrom start-pixels), FRONT at the bottom (the point nearest the drummer), the drum's right side on the right as the visualiser shows it; no number — click or drag a pixel, or focus it and step with the arrows. Below it, RANDOM: how far a dot may stray from the set point, one amount each for drum, hoop and angle. Colours Per pixel: each pixel of the dot its own hue."
      wide
    >
      <div class="cards"><GeneratorCard api={spliceApi} effect={dotKitFx} /></div>
    </DemoCard>

    <DemoCard
      title="Generator card — drum order (Dot)"
      src={['lib/ui/OrderList', 'lib/app/views/effects/strip/cards/ParamRows']}
      note="drum-order: the kit's drums as OrderList chips to drag (or ←/→), stored as comma-separated ids. With Kit order Custom the dots begin on the first drum, so Start drum hides (a showIf any-condition). Sections keep the columns they had while they still fit, so rows appearing or disappearing don't move them."
      wide
    >
      <div class="cards"><GeneratorCard api={spliceApi} effect={dotOrderFx} /></div>
    </DemoCard>

    <DemoCard title="Trigger card — Dot" src={['lib/app/views/effects/strip/AmpEnvelopeField', 'lib/app/views/effects/strip/strip-model']}
      note="Sustain gains Until dots end (amp length auto) where the Generator can say when its content ends — offered first, and a new Dot starts on it: the hit stays up until its last dot finishes, so the Dot's Lifespan is the one length control. Dots that never end on their own (a Stream, Lifespan 0) loop. Switching to a Generator that can't say puts Sustain back on a time.">
      <div class="cards"><TriggerCard api={spliceApi} effect={dotFx} /></div>
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
