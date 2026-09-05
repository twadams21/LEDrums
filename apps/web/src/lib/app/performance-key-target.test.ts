// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import Select from '../ui/Select.svelte';
import SegmentedControl from '../ui/SegmentedControl.svelte';
import Toggle from '../ui/Toggle.svelte';
import Slider from '../ui/Slider.svelte';
import Splitter from '../ui/Splitter.svelte';
import { performanceKeyTarget } from './performance-key-target';

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});

const OPTIONS = Array.from({ length: 5 }, (_, i) => ({ value: `o${i}`, label: `${i + 1}/4` }));

describe('performanceKeyTarget — DOM ownership adapter', () => {
  it('recognises native text inputs and contenteditable descendants', () => {
    const input = document.body.appendChild(document.createElement('input'));
    const editable = document.body.appendChild(document.createElement('div'));
    editable.setAttribute('contenteditable', 'true');
    const child = editable.appendChild(document.createElement('span'));

    expect(performanceKeyTarget(input).isEditableTarget).toBe(true);
    expect(performanceKeyTarget(child).isEditableTarget).toBe(true);
  });

  it('recognises the open Bits Select trigger and its portaled listbox', async () => {
    const { container } = render(Select, { props: { value: 'o0', options: OPTIONS, ariaLabel: 'Division' } });
    const trigger = container.querySelector('[data-keyboard-owner="select"]')!;
    expect(performanceKeyTarget(trigger).inOpenPopup).toBe(false);

    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(performanceKeyTarget(trigger).inOpenPopup).toBe(true);
    expect(performanceKeyTarget(document.querySelector('[role="listbox"]'))!.inOpenPopup).toBe(true);
  });

  it('recognises Bits segmented and toggle controls as roving keyboard owners', () => {
    const seg = render(SegmentedControl, {
      props: { value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], ariaLabel: 'Mode' },
    });
    const toggle = render(Toggle, { props: { pressed: false, ariaLabel: 'Enabled' } });

    expect(performanceKeyTarget(seg.container.querySelector('[data-keyboard-owner="roving"]')!).inKeyboardControl).toBe(true);
    expect(performanceKeyTarget(toggle.container.querySelector('[data-keyboard-owner="roving"]')!).inKeyboardControl).toBe(true);
  });

  it('recognises closed Select triggers, sliders, and separators as keyboard owners', () => {
    const select = render(Select, { props: { value: 'o0', options: OPTIONS, ariaLabel: 'Division' } });
    const slider = render(Slider, { props: { value: 50, min: 0, max: 100, ariaLabel: 'Tempo' } });
    const splitter = render(Splitter, { props: { orientation: 'vertical', size: 300, onResize: () => {}, label: 'Resize' } });

    expect(performanceKeyTarget(select.container.querySelector('[data-keyboard-owner="select"]')!).inKeyboardControl).toBe(true);
    expect(performanceKeyTarget(slider.container.querySelector('[data-keyboard-owner="slider"]')!).inKeyboardControl).toBe(true);
    expect(performanceKeyTarget(splitter.container.querySelector('[data-keyboard-owner="separator"]')!).inKeyboardControl).toBe(true);
  });

  it('recognises a modal through event path and global modal state', () => {
    const modal = document.body.appendChild(document.createElement('div'));
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const child = modal.appendChild(document.createElement('button'));

    expect(performanceKeyTarget(new KeyboardEvent('keydown', { bubbles: true, composed: true })).inModal).toBe(true);
    expect(performanceKeyTarget(child).inModal).toBe(true);
  });

  it('recognises an xyflow canvas without relying on focus blur', () => {
    const canvas = document.body.appendChild(document.createElement('div'));
    canvas.className = 'svelte-flow';
    const node = canvas.appendChild(document.createElement('div'));
    expect(performanceKeyTarget(node).inFlowCanvas).toBe(true);
  });
});
