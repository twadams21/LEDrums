// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import type { effectChain } from '@ledrums/core';
import { ShellStore } from '../shell-store.svelte';
import type { AppKeyboardStore } from '../app-keyboard';
import type { MappableSpec, MapTarget } from '../../trigger-lab/map-api';
import { MemoryMapModeApi } from './memory-map-api.svelte';
import { MapRegistry } from './registry.svelte';
import Harness from './MapModeHarness.test.svelte';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const KICK: effectChain.EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const cellTarget: MapTarget = { kind: 'fireCell', cell: KICK };
const cellSpec: MappableSpec = { target: cellTarget, kind: 'button', label: 'Kick · Center' };
const faderSpec: MappableSpec = { target: { kind: 'opacity', effectId: 'fx1' }, kind: 'continuous', label: 'Wash · Opacity' };

function setup(options: ConstructorParameters<typeof MemoryMapModeApi>[0] = {}) {
  const performed: MapTarget[] = [];
  const api = new MemoryMapModeApi({ onPerform: (t) => performed.push(t), ...options });
  const shell = new ShellStore();
  const registry = new MapRegistry();
  const onFire = vi.fn();
  const fireEffectAt = vi.fn();
  const store: AppKeyboardStore = {
    fireEffectAt,
    stepSetlist: vi.fn(() => true),
  };
  render(Harness, { api, shell, registry, cell: cellSpec, fader: faderSpec, onFire, store });
  const enter = (): void => {
    shell.setMapMode(true);
    flushSync();
  };
  return { api, shell, onFire, fireEffectAt, performed, enter };
}

function press(el: Element): void {
  // A real click is a pointerdown → mousedown → pointerup → mouseup → click sequence.
  fireEvent.pointerDown(el, { button: 0 });
  fireEvent.mouseDown(el, { button: 0 });
  fireEvent.pointerUp(el, { button: 0 });
  fireEvent.mouseUp(el, { button: 0 });
  fireEvent.click(el, { button: 0 });
}

function keydown(target: EventTarget, code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const key = init.key ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code.replace(/^Digit/, ''));
  const event = new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

const cellButton = (): HTMLElement => screen.getByRole('button', { name: 'Kick cell' });

describe('MIDI-map mode overlay', () => {
  it('renders nothing until map mode is on', () => {
    const { enter } = setup();
    expect(screen.queryByRole('region', { name: 'MIDI map mode' })).toBeNull();
    enter();
    expect(screen.getByRole('region', { name: 'MIDI map mode' }).textContent).toContain('Click a control to map it');
  });

  it('a click arms the control instead of firing it', () => {
    const { api, onFire, enter } = setup();
    enter();
    press(cellButton());
    flushSync();
    expect(onFire).not.toHaveBeenCalled();
    expect(api.mapLearnTargetId).toBe(api.mapTargetId(cellTarget));
    expect(screen.getByRole('region', { name: 'MIDI map mode' }).textContent).toContain('Kick · Center');
  });

  it('clicks on unmappable UI do nothing while mapping, and act again after', () => {
    const { onFire, shell, enter } = setup();
    enter();
    press(screen.getByRole('button', { name: 'Unmappable' }));
    expect(onFire).not.toHaveBeenCalled();
    shell.setMapMode(false);
    flushSync();
    press(screen.getByRole('button', { name: 'Unmappable' }));
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('arm then a MIDI note binds the control', () => {
    const { api, enter } = setup();
    enter();
    press(cellButton());
    api.receiveLearnInput({ midiNote: 36 });
    flushSync();
    expect(api.bindingFor(cellTarget)).toEqual({ midiNote: 36 });
    expect(screen.getByRole('region', { name: 'MIDI map mode' }).textContent).toContain('Note 36');
  });

  it('arm then a computer key binds it (key learn through the app keyboard dispatcher)', () => {
    const { api, fireEffectAt, enter } = setup();
    enter();
    press(cellButton());
    const event = keydown(window, 'KeyQ');
    expect(event.defaultPrevented).toBe(true);
    expect(api.bindingFor(cellTarget)).toEqual({ key: 'KeyQ' });
    // Digits are learnt too, not auditioned behind the overlay.
    keydown(window, 'Digit1');
    expect(fireEffectAt).not.toHaveBeenCalled();
    expect(api.bindingFor(cellTarget)).toEqual({ key: 'Digit1' });
  });

  it('Delete / Backspace clears the armed control’s binding', () => {
    const { api, enter } = setup({ mappings: [{ id: 'm1', source: { midiNote: 40 }, target: cellTarget }] });
    enter();
    press(cellButton());
    keydown(window, 'Backspace', { key: 'Backspace' });
    expect(api.bindingFor(cellTarget)).toBeNull();
  });

  it('Escape exits map mode and cancels learn', () => {
    const { api, shell, enter } = setup();
    enter();
    press(cellButton());
    keydown(window, 'Escape', { key: 'Escape' });
    expect(shell.mapMode).toBe(false);
    expect(api.mapLearnTargetId).toBeNull();
    expect(screen.queryByRole('region', { name: 'MIDI map mode' })).toBeNull();
  });

  it('the Done button exits map mode', async () => {
    const { shell, enter } = setup();
    enter();
    await fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(shell.mapMode).toBe(false);
  });

  it('Enter on the focused Clear button activates it instead of being learnt', () => {
    const { api, enter } = setup({ mappings: [{ id: 'm1', source: { midiNote: 40 }, target: cellTarget }] });
    enter();
    press(cellButton());
    const clear = screen.getByRole('button', { name: /Clear/ });
    clear.focus();
    const event = keydown(clear, 'Enter', { key: 'Enter' });
    // Left to the browser's native activation; jsdom does not synthesise it, so click as it would.
    expect(event.defaultPrevented).toBe(false);
    expect(api.bindingFor(cellTarget)).toEqual({ midiNote: 40 });
    clear.click();
    flushSync();
    expect(api.bindingFor(cellTarget)).toBeNull();
    expect(api.inputMappings.some((m) => 'key' in m.source && m.source.key === 'Enter')).toBe(false);
  });

  it('Space on the focused Done button is not learnt; Enter elsewhere still is', () => {
    const { api, enter } = setup();
    enter();
    press(cellButton());
    const done = screen.getByRole('button', { name: /Done/ });
    const space = keydown(done, 'Space', { key: ' ' });
    expect(space.defaultPrevented).toBe(false);
    expect(api.bindingFor(cellTarget)).toBeNull();
    keydown(window, 'Enter', { key: 'Enter' });
    expect(api.bindingFor(cellTarget)).toEqual({ key: 'Enter' });
  });

  it('a conflicting binding is refused with its reason and the control stays armed', () => {
    const { api, enter } = setup({ claims: [{ source: { key: 'KeyZ' }, reason: 'Key Z already fires Snare · Edge' }] });
    enter();
    press(cellButton());
    keydown(window, 'KeyZ');
    expect(api.bindingFor(cellTarget)).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Key Z already fires Snare · Edge');
    // still armed: the next key binds
    keydown(window, 'KeyX');
    expect(api.bindingFor(cellTarget)).toEqual({ key: 'KeyX' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a MIDI refusal from learn shows on the armed control', () => {
    const { api, enter } = setup({ claims: [{ source: { midiNote: 38 }, reason: 'Note 38 is the snare head zone' }] });
    enter();
    press(cellButton());
    api.receiveLearnInput({ midiNote: 38 });
    flushSync();
    expect(screen.getByRole('alert').textContent).toBe('Note 38 is the snare head zone');
    expect(api.mapLearnTargetId).toBe(api.mapTargetId(cellTarget));
  });

  it('a mapped continuous control edits its range', async () => {
    const { api, enter } = setup({ mappings: [{ id: 'm2', source: { midiCc: 21 }, target: faderSpec.target as effectChain.InputMappingTarget }] });
    enter();
    press(screen.getByRole('slider', { name: 'Opacity' }));
    flushSync();
    const max = screen.getByRole('spinbutton', { name: 'Range maximum' });
    await fireEvent.focus(max);
    await fireEvent.input(max, { target: { value: '0.5' } });
    await fireEvent.blur(max);
    expect(api.inputMappings[0]).toMatchObject({ rangeMax: 0.5, rangeMin: undefined });
  });

  it('an unset range shows the target’s own range (defaultRange), a set bound shows itself', () => {
    const { enter } = setup({
      mappings: [{ id: 'm2', source: { midiCc: 21 }, target: faderSpec.target as effectChain.InputMappingTarget, rangeMax: 0.4 }],
    });
    enter();
    press(screen.getByRole('slider', { name: 'Opacity' }));
    flushSync();
    expect((screen.getByRole('spinbutton', { name: 'Range minimum' }) as HTMLInputElement).value).toBe('0');
    expect((screen.getByRole('spinbutton', { name: 'Range maximum' }) as HTMLInputElement).value).toBe('0.4');
  });

  it('a viewer cannot arm', () => {
    const { api, enter } = setup({ canEdit: false });
    enter();
    press(cellButton());
    expect(api.mapLearnTargetId).toBeNull();
    expect(screen.getByRole('region', { name: 'MIDI map mode' }).textContent).toContain('read-only');
  });
});

describe('key mappings outside map mode', () => {
  const keyed = { mappings: [{ id: 'mk', source: { key: 'KeyQ' }, target: cellTarget }] };

  it('a mapped key performs its target and is claimed', () => {
    const { performed } = setup(keyed);
    const event = keydown(window, 'KeyQ');
    expect(performed).toEqual([cellTarget]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('a held key fires once — repeats are swallowed', () => {
    const { performed } = setup(keyed);
    keydown(window, 'KeyQ');
    const repeat = keydown(window, 'KeyQ', { repeat: true });
    expect(performed).toHaveLength(1);
    expect(repeat.defaultPrevented).toBe(true);
  });

  it('does not fire while typing in a text field', () => {
    const { performed } = setup(keyed);
    const event = keydown(screen.getByRole('textbox', { name: 'Name' }), 'KeyQ');
    expect(performed).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('yields to a keyboard-owning control', () => {
    const { performed } = setup(keyed);
    const owner = document.createElement('div');
    owner.setAttribute('data-keyboard-owner', 'roving');
    owner.tabIndex = 0;
    document.body.append(owner);
    keydown(owner, 'KeyQ');
    expect(performed).toEqual([]);
  });

  it('an unmapped key falls through to the Perform digits', () => {
    const { performed, fireEffectAt } = setup(keyed);
    keydown(window, 'Digit2');
    expect(performed).toEqual([]);
    expect(fireEffectAt).toHaveBeenCalledWith(1);
  });

  it('mod+m enters map mode', () => {
    const { shell } = setup();
    keydown(window, 'KeyM', { key: 'm', ctrlKey: true });
    expect(shell.mapMode).toBe(true);
  });
});
