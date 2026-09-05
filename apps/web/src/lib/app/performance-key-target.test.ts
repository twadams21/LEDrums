// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import Select from '../ui/Select.svelte';
import SegmentedControl from '../ui/SegmentedControl.svelte';
import Toggle from '../ui/Toggle.svelte';
import { performanceKeyTarget } from './performance-key-target';

afterEach(cleanup);

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

  it('recognises an xyflow canvas without relying on focus blur', () => {
    const canvas = document.body.appendChild(document.createElement('div'));
    canvas.className = 'svelte-flow';
    const node = canvas.appendChild(document.createElement('div'));
    expect(performanceKeyTarget(node).inFlowCanvas).toBe(true);
  });
});
