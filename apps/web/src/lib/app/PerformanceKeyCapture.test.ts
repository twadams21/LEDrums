// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import Select from '../ui/Select.svelte';
import Slider from '../ui/Slider.svelte';
import Splitter from '../ui/Splitter.svelte';
import PerformanceKeyCapture, { type PerformanceKeyShell, type PerformanceKeyStore } from './PerformanceKeyCapture.svelte';
import { performanceKeyTarget } from './performance-key-target';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-keyboard-owner="modal"], [role="dialog"]').forEach((node) => node.remove());
});

const options = Array.from({ length: 5 }, (_, i) => ({ value: `o${i}`, label: `${i + 1}/4` }));

function fixture(view: PerformanceKeyShell['view'] = 'perform') {
  const store: PerformanceKeyStore = {
    activeSong: { sections: [{ id: 'a' }, { id: 'b' }] },
    activeSectionId: 'a',
    fireSectionGraph: vi.fn(),
    setActiveSection: vi.fn(),
  };
  const shell: PerformanceKeyShell = { view, settingsPane: null };
  render(PerformanceKeyCapture, { props: { store, shell } });
  return { store, shell };
}

function key(target: EventTarget, keyName: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('PerformanceKeyCapture — mounted capture integration', () => {
  it('claims a Perform digit at capture and fires one graph', () => {
    const { store } = fixture();
    let bubbled = 0;
    const listener = (): void => {
      bubbled++;
    };
    document.addEventListener('keydown', listener);

    const event = key(document.body, '1');

    expect(store.fireSectionGraph).toHaveBeenCalledWith(0);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).toBe(0);
    document.removeEventListener('keydown', listener);
  });

  it('yields authoring views, modified chords, repeated digits, and Enter/Escape', () => {
    const { store, shell } = fixture();
    for (const keyName of ['Enter', 'Escape']) key(document.body, keyName);
    key(document.body, '1', { repeat: true });
    key(document.body, '1', { shiftKey: true });
    key(document.body, 'ArrowRight', { metaKey: true });
    shell.view = 'trigger';
    const authoring = key(document.body, '1');

    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(authoring.defaultPrevented).toBe(false);
  });

  it('lets repeated arrows step sections while the action remains capture-owned', () => {
    const { store } = fixture();
    const event = key(document.body, 'ArrowRight', { repeat: true });

    expect(store.setActiveSection).toHaveBeenCalledWith('b');
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets a closed Select retain digit/typeahead ownership and its open portal', async () => {
    const { store } = fixture();
    const select = render(Select, { props: { value: 'o0', options, ariaLabel: 'Division' } });
    const trigger = select.container.querySelector('[data-keyboard-owner="select"]')!;

    const closed = key(trigger, '1');
    expect(closed.defaultPrevented).toBe(false);
    expect(store.fireSectionGraph).not.toHaveBeenCalled();

    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await tick();
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    key(listbox!, '1');
    expect(store.fireSectionGraph).not.toHaveBeenCalled();

    key(listbox!, 'Escape');
    await tick();
    key(trigger, '1'); // focus/ownership after dismissal remains with the Select trigger
    expect(store.fireSectionGraph).not.toHaveBeenCalled();
  });

  it('lets Transport-style sliders and Splitter arrows reach their native controls', () => {
    const { store } = fixture();
    const slider = render(Slider, { props: { value: 50, min: 0, max: 100, ariaLabel: 'Tempo' } });
    const resize = vi.fn();
    const splitter = render(Splitter, { props: { orientation: 'vertical', size: 300, onResize: resize, label: 'Resize' } });
    let bubbled = 0;
    const listener = (): void => {
      bubbled++;
    };
    document.addEventListener('keydown', listener);

    const sliderEvent = key(slider.container.querySelector('[role="slider"]')!, 'ArrowRight');
    const splitterEvent = key(splitter.container.querySelector('[role="separator"]')!, 'ArrowRight');

    expect(store.setActiveSection).not.toHaveBeenCalled();
    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith(316);
    expect(bubbled).toBe(2);
    expect(sliderEvent.defaultPrevented).toBe(true); // Slider itself claims its native step.
    expect(splitterEvent.defaultPrevented).toBe(true); // Splitter itself claims its native resize.
    document.removeEventListener('keydown', listener);
  });

  it('suppresses background shortcuts for a portalled modal', () => {
    const { store } = fixture();
    const modal = document.body.appendChild(document.createElement('div'));
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const portalButton = modal.appendChild(document.createElement('button'));

    expect(performanceKeyTarget(portalButton).inModal).toBe(true);
    const event = key(portalButton, '1');
    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
