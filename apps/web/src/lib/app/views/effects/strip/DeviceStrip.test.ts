// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { DEFAULT_KIT, effectChain } from '@ledrums/core';
import { MASTER_CELL, type CellSelection } from '../../../../trigger-lab/effects-api';
import { createStandaloneEffectsApi } from '../../../../trigger-lab/effects-controller.svelte';
import DeviceStrip from './DeviceStrip.svelte';

/* The device strip over the in-memory authoring api: every assertion reads the api's section
   (the external behaviour), never component internals. */

type EffectCell = effectChain.EffectCell;
const kickHead: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const kitZone: EffectCell = { row: 'kit', column: { kind: 'zone', slot: 0 } };
const kickCue: EffectCell = { row: 'kick', column: { kind: 'cue' } };

const fx = (id: string, cell: EffectCell, extra: Partial<effectChain.EffectInput> = {}) =>
  effectChain.parseEffect({ id, name: id, cell, generator: { kind: 'solid' }, ...extra });

function setup(cell: CellSelection | null = kickHead, canEdit = true) {
  const api = createStandaloneEffectsApi(
    {
      effects: [
        fx('Pulse', kickHead, {
          modifiers: [
            { uid: 'm1', modifierId: 'strobe' },
            { uid: 'm2', modifierId: 'trail' },
          ],
        }),
        fx('Wash', kickHead),
        fx('Drop', kickCue, { trigger: { kind: 'cue', source: {} } }),
      ],
      master: [effectChain.modifierDeviceSchema.parse({ uid: 'mm', modifierId: 'levels' })],
    },
    DEFAULT_KIT,
    { canEdit },
  );
  const view = render(DeviceStrip, { props: { api, cell } });
  return { api, ...view };
}

const stackIds = (api: ReturnType<typeof setup>['api']) => api.cellEffects(kickHead).map((e) => e.id);
const row = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-effect="${id}"]`)!;

describe('DeviceStrip', () => {
  it('renders one chain row per Effect, in stack order', () => {
    const { container } = setup();
    const rows = [...container.querySelectorAll<HTMLElement>('.effect-row')];
    expect(rows.map((r) => r.dataset.effect)).toEqual(['Pulse', 'Wash']);
    expect(container.textContent).toContain('2 Effects');
    // Each chain reads Trigger → … → Target.
    expect(within(rows[0]!).getByRole('group', { name: 'Device chain' })).toBeTruthy();
    expect(within(rows[0]!).getByRole('region', { name: 'Target' })).toBeTruthy();
  });

  it('explains the empty states instead of rendering an empty panel', () => {
    expect(setup(null).container.textContent).toContain('Select a cell');
    expect(setup(kitZone).container.textContent).toContain('can’t hold Effects');
    expect(setup({ row: 'kick', column: { kind: 'zone', slot: 1 } }).container.textContent).toContain('No Effects in this cell yet');
  });

  it('shows the Master cell as a modifier-only chain', () => {
    const { container } = setup(MASTER_CELL);
    expect(container.textContent).toContain('Master');
    expect(container.querySelectorAll('.effect-row')).toHaveLength(0);
    expect(within(container).getByRole('list', { name: 'Modifiers' }).querySelectorAll('.mod-slot')).toHaveLength(1);
  });

  it('↓ / ↑ on an Effect grip reorders the stack, one undo step each', async () => {
    const { api, container } = setup();
    await fireEvent.keyDown(row(container, 'Pulse').querySelector('.grip')!, { key: 'ArrowDown' });
    expect(stackIds(api)).toEqual(['Wash', 'Pulse']);
    expect(api.undoDepth).toBe(1);
    await tick();
    await fireEvent.keyDown(row(container, 'Wash').querySelector('.grip')!, { key: 'ArrowUp' });
    expect(stackIds(api)).toEqual(['Wash', 'Pulse']); // already first: no-op
    expect(api.undoDepth).toBe(1);
  });

  it('dragging an Effect grip onto the top half of the first row moves it to the top', async () => {
    const { api, container } = setup();
    await fireEvent.dragStart(row(container, 'Wash').querySelector('.grip')!);
    const target = row(container, 'Pulse');
    await fireEvent.dragOver(target);
    await fireEvent.drop(target);
    expect(stackIds(api)).toEqual(['Wash', 'Pulse']);
    expect(api.undoDepth).toBe(1);
  });

  it('the header power toggle bypasses the Effect, and audition fires it', async () => {
    const { api, container } = setup();
    const head = row(container, 'Pulse');
    await fireEvent.click(within(head).getByRole('button', { name: 'Pulse on' }));
    expect(api.effectById('Pulse')!.bypass).toBe(true);
    await fireEvent.click(within(head).getByRole('button', { name: 'Audition Pulse' }));
    expect(api.fired).toEqual(['effect:Pulse']);
  });

  it('double-click the name to rename; Enter commits', async () => {
    const { api, container } = setup();
    const head = row(container, 'Pulse');
    await fireEvent.dblClick(within(head).getByRole('button', { name: 'Pulse' }));
    const input = within(head).getByRole('textbox', { name: 'Effect name' }) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Big hit' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.effectById('Pulse')!.name).toBe('Big hit');
  });

  it('← / → on a Modifier grip reorders that Effect’s chain', async () => {
    const { api, container } = setup();
    const run = within(row(container, 'Pulse')).getByRole('list', { name: 'Modifiers' });
    await fireEvent.keyDown(run.querySelector('[data-grip="m1"]')!, { key: 'ArrowRight' });
    expect(api.effectById('Pulse')!.modifiers.map((m) => m.uid)).toEqual(['m2', 'm1']);
  });

  it('a viewer sees the stack but every edit control is disabled', async () => {
    const { api, container } = setup(kickHead, false);
    const head = row(container, 'Pulse');
    const power = within(head).getByRole('button', { name: 'Pulse on' }) as HTMLButtonElement;
    expect(power.disabled).toBe(true);
    expect((head.querySelector('.grip') as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(within(head).getByRole('button', { name: 'Audition Pulse' }));
    expect(api.fired).toEqual(['effect:Pulse']);
    expect(api.undoDepth).toBe(0);
  });
});

describe('TriggerCard + TargetCard (through the strip)', () => {
  it('a Cue trigger commits a typed MIDI note and arms cue learn', async () => {
    const { api, container } = setup(kickCue);
    const chain = row(container, 'Drop');
    const note = within(chain).getByRole('spinbutton', { name: 'Cue MIDI note' }) as HTMLInputElement;
    await fireEvent.focus(note);
    await fireEvent.input(note, { target: { value: '38' } });
    await fireEvent.blur(note);
    const trigger = api.effectById('Drop')!.trigger;
    expect(trigger).toEqual({ kind: 'cue', source: { midiNote: 38 } });
    await fireEvent.click(within(chain).getByRole('button', { name: 'Learn cue MIDI' }));
    expect(api.cueLearnEffectId).toBe('Drop');
    await fireEvent.click(within(chain).getByRole('button', { name: 'Learn cue MIDI' }));
    expect(api.cueLearnEffectId).toBeNull();
  });

  it('the Target segments switch Kit / Hit drum / Select; Select toggles drums', async () => {
    const { api, container } = setup();
    const target = within(row(container, 'Pulse')).getByRole('region', { name: 'Target' });
    await fireEvent.click(within(target).getByRole('radio', { name: 'Hit drum' }));
    expect(api.effectById('Pulse')!.target).toEqual({ kind: 'hitDrum' });
    await tick();
    await fireEvent.click(within(target).getByRole('radio', { name: 'Select' }));
    expect(api.effectById('Pulse')!.target).toEqual({ kind: 'select', drums: [{ drumId: 'kick' }] });
    await tick();
    await fireEvent.click(within(target).getByRole('button', { name: 'Snare' }));
    expect(api.effectById('Pulse')!.target).toEqual({ kind: 'select', drums: [{ drumId: 'kick' }, { drumId: 'snare' }] });
  });
});
