// @vitest-environment jsdom
/* Reordering Splice / Slice slots (Tim, 2026-09-28: re-ordering a set of colours meant dialling each
   one again), against the real in-memory authoring api: a slot moves whole, every move is ONE undo
   step, focus follows a keyboard move, a drop lands in the gap under the pointer, and a viewer
   cannot reorder. */
import { describe, expect, it } from 'vitest';
import { createEvent, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
import { createStandaloneEffectsApi } from '../../../../../trigger-lab/effects-controller.svelte';
import SlotsEditor from './SlotsEditor.svelte';

const kit: KitConfig = { ...DEFAULT_KIT, drums: [{ ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' }] };
const cell = { row: 'kick', column: { kind: 'zone' as const, slot: 0 } };
const RED = { color: '#ff0000' };
const GREEN = { color: '#00ff00', muted: true };
const BLUE = { color: '#0000ff' };

function demo(kind: 'splice' | 'slice' = 'splice', slots: Array<Record<string, unknown>> = [RED, GREEN, BLUE], opts: { canEdit?: boolean } = {}) {
  const parsed = effectChain.parseEffect({ id: 'e1', name: 'Cut', cell, generator: { kind, slots } });
  const api = createStandaloneEffectsApi({ effects: [parsed], master: [] }, kit, opts);
  const effect = () => api.effectById('e1')!;
  const view = render(SlotsEditor, { props: { api, effect: effect() } });
  const rerender = () => view.rerender({ api, effect: effect() });
  return { api, effect, view, rerender };
}
const colours = (effect: effectChain.Effect) => effect.generator.slots!.map((s) => s.color);

describe('SlotsEditor — reordering', () => {
  it('↓ on a grip moves that slot one place — whole, in one undo step — and focus follows it', async () => {
    const { api, effect, view, rerender } = demo();
    await fireEvent.keyDown(view.getByLabelText(/Splice 1 of 3/), { key: 'ArrowDown' });
    expect(colours(effect())).toEqual(['#00ff00', '#ff0000', '#0000ff']);
    expect(effect().generator.slots![0]!.muted).toBe(true); // the mute travelled with its colour
    expect(api.undoDepth).toBe(1);
    await rerender();
    await tick();
    expect(document.activeElement?.getAttribute('data-grip')).toBe('1');
  });

  it('↑ on the first slot does nothing', async () => {
    const { api, effect, view } = demo();
    await fireEvent.keyDown(view.getByLabelText(/Splice 1 of 3/), { key: 'ArrowUp' });
    expect(colours(effect())).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(api.undoDepth).toBe(0);
  });

  it('dropping a dragged slot lands it in the gap under the pointer', async () => {
    const { effect, view } = demo();
    const items = view.container.querySelectorAll('li.slot');
    items.forEach((item, i) => {
      item.getBoundingClientRect = () => ({ top: i * 100, height: 80, bottom: i * 100 + 80, left: 0, right: 200, width: 200, x: 0, y: i * 100, toJSON() {} }) as DOMRect;
    });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', setDragImage() {}, effectAllowed: '', dropEffect: '' };
    await fireEvent.dragStart(view.getByLabelText(/Splice 3 of 3/), { dataTransfer });
    // jsdom has no DragEvent, so the pointer position is put on the event by hand.
    const at = (type: 'dragOver' | 'drop', clientY: number) => {
      const event = createEvent[type](items[0]!, { dataTransfer });
      Object.defineProperty(event, 'clientY', { value: clientY });
      return fireEvent(items[0]!, event);
    };
    await at('dragOver', 10); // the top half of the first slot → gap 0
    await at('drop', 10);
    expect(colours(effect())).toEqual(['#0000ff', '#ff0000', '#00ff00']);
  });

  it('names the grips for a Slice, and shows none for a lone slot', () => {
    expect(demo('slice').view.getByLabelText(/Slice 2 of 3/)).toBeTruthy();
    expect(demo('splice', [RED]).view.queryByLabelText(/Splice 1 of 1/)).toBeNull();
  });

  it('a viewer cannot reorder', async () => {
    const { effect, view } = demo('splice', [RED, GREEN, BLUE], { canEdit: false });
    const grip = view.getByLabelText(/Splice 1 of 3/) as HTMLButtonElement;
    expect(grip.disabled).toBe(true);
    await fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(colours(effect())).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });
});
