// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import FaceParamControl from './FaceParamControl.svelte';
import { DRAG_TRAVEL_PX } from './drag-number';

/* The in-place control that rides a card param row (S5). What matters here: the right
   control per declared type, one gesture bracket per drag, and a modulated param staying
   EDITABLE with a badge (the ColorSwatch precedent) rather than going read-only. */

const numberProps = {
  kind: 'number' as const,
  value: 0.5,
  display: '0.5',
  min: 0,
  max: 1,
  step: 0.01,
  ariaLabel: 'Size',
};

describe('number — drag field', () => {
  it('renders the pre-formatted read-out, not a raw float', () => {
    const { getByRole } = render(FaceParamControl, {
      props: { ...numberProps, value: 0.3333, display: '0.33', onChange: () => {} },
    });
    expect(getByRole('slider').textContent?.trim()).toBe('0.33');
  });

  it('publishes the value the drag reaches, anchored at pointer-down', () => {
    const onChange = vi.fn();
    const { getByRole } = render(FaceParamControl, { props: { ...numberProps, value: 0, onChange } });
    const field = getByRole('slider');
    // jsdom has no pointer capture — stub it so the handler can run
    (field as HTMLElement & { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};

    fireEvent.pointerDown(field, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(field, { clientX: 100 + DRAG_TRAVEL_PX / 2, pointerId: 1 });

    expect(onChange).toHaveBeenCalledWith(0.5);
  });

  it('brackets the drag in exactly one gesture (one undo for the whole drag)', () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { getByRole } = render(FaceParamControl, {
      props: { ...numberProps, value: 0, onChange: () => {}, onGestureStart, onGestureEnd },
    });
    const field = getByRole('slider');
    (field as HTMLElement & { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};

    fireEvent.pointerDown(field, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(field, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(field, { clientX: 40, pointerId: 1 });
    fireEvent.pointerUp(field, { pointerId: 1 });

    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });

  it('closes the gesture exactly once even when pointerup races pointercancel', () => {
    const onGestureEnd = vi.fn();
    const { getByRole } = render(FaceParamControl, {
      props: { ...numberProps, onChange: () => {}, onGestureStart: () => {}, onGestureEnd },
    });
    const field = getByRole('slider');
    (field as HTMLElement & { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};

    fireEvent.pointerDown(field, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(field, { pointerId: 1 });
    fireEvent.pointerCancel(field, { pointerId: 1 });
    fireEvent.lostPointerCapture(field, { pointerId: 1 });

    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });

  it('ignores pointermove with no drag open (a hover must not edit)', () => {
    const onChange = vi.fn();
    const { getByRole } = render(FaceParamControl, { props: { ...numberProps, onChange } });
    fireEvent.pointerMove(getByRole('slider'), { clientX: 999 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('steps on the arrow keys so the field works without a pointer', () => {
    const onChange = vi.fn();
    const { getByRole } = render(FaceParamControl, { props: { ...numberProps, value: 0.5, onChange } });
    fireEvent.keyDown(getByRole('slider'), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(0.51);
    fireEvent.keyDown(getByRole('slider'), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith(0.49);
  });

  it('exposes its range to assistive tech', () => {
    const { getByRole } = render(FaceParamControl, { props: { ...numberProps, onChange: () => {} } });
    const field = getByRole('slider');
    expect(field.getAttribute('aria-valuenow')).toBe('0.5');
    expect(field.getAttribute('aria-valuemin')).toBe('0');
    expect(field.getAttribute('aria-valuemax')).toBe('1');
    expect(field.getAttribute('aria-label')).toBe('Size');
  });
});

describe('enum — cycle chip', () => {
  const enumProps = {
    kind: 'enum' as const,
    value: 'add',
    display: 'add',
    options: ['add', 'over', 'mask'],
    ariaLabel: 'Mode',
  };

  it('cycles forward on click and wraps', () => {
    const onChange = vi.fn();
    const { getByRole, rerender } = render(FaceParamControl, { props: { ...enumProps, onChange } });
    fireEvent.click(getByRole('button'));
    expect(onChange).toHaveBeenCalledWith('over');

    rerender({ ...enumProps, value: 'mask', display: 'mask', onChange });
    fireEvent.click(getByRole('button'));
    expect(onChange).toHaveBeenLastCalledWith('add');
  });

  it('cycles backward on shift-click', () => {
    const onChange = vi.fn();
    const { getByRole } = render(FaceParamControl, { props: { ...enumProps, onChange } });
    fireEvent.click(getByRole('button'), { shiftKey: true });
    expect(onChange).toHaveBeenCalledWith('mask');
  });

  it('is a no-op for a single-option enum', () => {
    const onChange = vi.fn();
    const { getByRole } = render(FaceParamControl, {
      props: { ...enumProps, options: ['only'], value: 'only', display: 'only', onChange },
    });
    fireEvent.click(getByRole('button'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('bool — switch', () => {
  it('renders a switch reflecting the value and toggles it', () => {
    const onChange = vi.fn();
    const { getByRole } = render(FaceParamControl, {
      props: { kind: 'bool' as const, value: false, display: 'off', ariaLabel: 'Mirror', onChange },
    });
    const sw = getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('modulated rows', () => {
  it('badges a driven param but keeps it editable — the base value stays the thing you edit', () => {
    const onChange = vi.fn();
    const { container, getByRole } = render(FaceParamControl, {
      props: { ...numberProps, modulated: true, onChange },
    });
    expect(container.querySelector('.modbadge')).not.toBeNull();
    fireEvent.keyDown(getByRole('slider'), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalled(); // NOT read-only
  });

  it('a read-only viewer cannot edit', () => {
    const onChange = vi.fn();
    const { container, getByRole } = render(FaceParamControl, {
      props: { ...numberProps, disabled: true, onChange },
    });
    expect(container.querySelector('.facectl.disabled')).not.toBeNull();
    fireEvent.keyDown(getByRole('slider'), { key: 'ArrowUp' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

/* F3 items 4 + 6: the row carries a real slider rail, and a wheel over the control edits it
   in place. The rail is ABSOLUTE (press lands where you pressed); the wheel is one step per
   tick and must preventDefault, or the pane scrolls out from under the gesture. */

describe('number — rail', () => {
  it('renders a rail whose fill and thumb track the value', () => {
    const { container } = render(FaceParamControl, {
      props: { ...numberProps, value: 0.25, display: '0.25', onChange: () => {} },
    });
    expect((container.querySelector('.fill') as HTMLElement).style.width).toBe('25%');
    expect((container.querySelector('.thumb') as HTMLElement).style.left).toBe('25%');
  });

  it('omits the rail for a param with no declared range — there is no position to map', () => {
    const { container } = render(FaceParamControl, {
      props: { kind: 'number' as const, value: 4, display: '4', step: 1, ariaLabel: 'Steps', onChange: () => {} },
    });
    expect(container.querySelector('.rail')).toBeNull();
  });

  it('jumps to where it is pressed and brackets the press as one gesture', () => {
    const onChange = vi.fn();
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { container } = render(FaceParamControl, {
      props: { ...numberProps, value: 0, onChange, onGestureStart, onGestureEnd },
    });
    const rail = container.querySelector('.rail') as HTMLElement & { setPointerCapture: (id: number) => void };
    rail.setPointerCapture = () => {};
    // jsdom lays nothing out, so pin the rail's box
    rail.getBoundingClientRect = () => ({ left: 0, width: 100, right: 100, top: 0, bottom: 16, height: 16, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireEvent.pointerDown(rail, { button: 0, clientX: 75, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0.75);
    fireEvent.pointerMove(rail, { clientX: 20, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0.2);
    fireEvent.pointerUp(rail, { pointerId: 1 });

    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });
});

describe('number — wheel', () => {
  it('a scroll without ⌥ never edits the param', () => {
    const onChange = vi.fn();
    const { getByRole } = render(FaceParamControl, { props: { ...numberProps, value: 0.5, onChange } });
    fireEvent.wheel(getByRole('slider'), { deltaY: -100 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('steps the value one step per tick over the value field', () => {
    const onChange = vi.fn();
    const { getByRole } = render(FaceParamControl, { props: { ...numberProps, value: 0.5, onChange } });
    fireEvent.wheel(getByRole('slider'), { altKey: true, deltaY: -100 });
    expect(onChange).toHaveBeenLastCalledWith(0.51);
    fireEvent.wheel(getByRole('slider'), { altKey: true, deltaY: 100 });
    expect(onChange).toHaveBeenLastCalledWith(0.49);
  });

  it('steps over the rail too, and cancels the page scroll it rode in on', () => {
    const onChange = vi.fn();
    const { container } = render(FaceParamControl, { props: { ...numberProps, value: 0.5, onChange } });
    const ev = new WheelEvent('wheel', { altKey: true, deltaY: -100, cancelable: true, bubbles: true });
    container.querySelector('.rail')!.dispatchEvent(ev);
    expect(onChange).toHaveBeenLastCalledWith(0.51);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not edit a read-only viewer’s value', () => {
    const onChange = vi.fn();
    const { getByRole } = render(FaceParamControl, { props: { ...numberProps, disabled: true, onChange } });
    fireEvent.wheel(getByRole('slider'), { altKey: true, deltaY: -100 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

/* Exact values and fine control on the card slider (Tim, 2026-10-02: "i can't type in a number
   into any of the boxes"). */
function setupTyped(props: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const view = render(FaceParamControl, { props: { kind: 'number', value: 8, display: '8.00', min: 0, max: 40, step: 0.1, ariaLabel: 'Rate', onChange, ...props } });
  // jsdom has no pointer capture; the drag handlers call it.
  HTMLElement.prototype.setPointerCapture = () => {};
  return { view, onChange };
}
const click = async (el: Element) => {
  await fireEvent.pointerDown(el, { button: 0, clientX: 100, pointerId: 1 });
  await fireEvent.pointerUp(el, { button: 0, clientX: 100, pointerId: 1 });
  await tick();
};

describe('typing a value', () => {
  it('a click on the value opens it for typing; Enter commits the exact value', async () => {
    const { view, onChange } = setupTyped();
    await click(view.getByRole('slider', { name: 'Rate' }));
    const box = view.getByRole('textbox', { name: 'Rate value' }) as HTMLInputElement;
    expect(box.value).toBe('8');
    await fireEvent.input(box, { target: { value: '12.25' } });
    await fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(12.25);
  });

  it('Esc cancels; a non-number changes nothing; out of range clamps', async () => {
    const { view, onChange } = setupTyped();
    await click(view.getByRole('slider', { name: 'Rate' }));
    await fireEvent.input(view.getByRole('textbox'), { target: { value: '30' } });
    await fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    await click(view.getByRole('slider', { name: 'Rate' }));
    await fireEvent.input(view.getByRole('textbox'), { target: { value: 'fast' } });
    await fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    await click(view.getByRole('slider', { name: 'Rate' }));
    await fireEvent.input(view.getByRole('textbox'), { target: { value: '500' } });
    await fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(40);
  });

  it('a drag still adjusts, and does not open the box', async () => {
    const { view, onChange } = setupTyped();
    const field = view.getByRole('slider', { name: 'Rate' });
    await fireEvent.pointerDown(field, { button: 0, clientX: 100, pointerId: 1 });
    await fireEvent.pointerMove(field, { clientX: 160, pointerId: 1 });
    await fireEvent.pointerUp(field, { clientX: 160, pointerId: 1 });
    expect(onChange).toHaveBeenCalled();
    expect(view.queryByRole('textbox')).toBeNull();
  });

  it('Enter on the focused value opens it; Shift + arrow steps ten', async () => {
    const { view, onChange } = setupTyped();
    const field = view.getByRole('slider', { name: 'Rate' });
    await fireEvent.keyDown(field, { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(9);
    await fireEvent.keyDown(field, { key: 'Enter' });
    await tick();
    expect(view.getByRole('textbox', { name: 'Rate value' })).toBeTruthy();
  });

  it('a percent param is typed as shown', async () => {
    const { view, onChange } = setupTyped({ value: 0.5, display: '50', min: 0, max: 1, step: 0.01, entry: { factor: 100, unit: '%' } });
    await click(view.getByRole('slider', { name: 'Rate' }));
    expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('50');
    await fireEvent.input(view.getByRole('textbox'), { target: { value: '33' } });
    await fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(0.33);
  });
});

describe('Shift and the arrows (Tim, 2026-10-02: "the shift key doesn\u2019t work")', () => {
  function rail(view: { container: HTMLElement }): HTMLElement {
    const el = view.container.querySelector<HTMLElement>('.rail')!;
    el.setPointerCapture = () => {};
    el.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 16, right: 100, bottom: 16, x: 0, y: 0, toJSON() {} }) as DOMRect;
    return el;
  }

  it('Shift on the rail creeps from the current value at a quarter speed — it never jumps to the pointer', async () => {
    const onChange = vi.fn();
    const view = render(FaceParamControl, { props: { kind: 'number', value: 50, display: '50', min: 0, max: 100, step: 0.1, ariaLabel: 'Depth', onChange } });
    const r = rail(view);
    await fireEvent.pointerDown(r, { button: 0, clientX: 90, pointerId: 1, shiftKey: true });
    expect(onChange).not.toHaveBeenCalled(); // no jump to 90
    await fireEvent.pointerMove(r, { clientX: 98, pointerId: 1, shiftKey: true }); // 8% of the rail
    expect(onChange).toHaveBeenLastCalledWith(52); // 50 + 8 × ¼
  });

  it('without Shift the rail still jumps to where it is pressed', async () => {
    const onChange = vi.fn();
    const view = render(FaceParamControl, { props: { kind: 'number', value: 50, display: '50', min: 0, max: 100, step: 1, ariaLabel: 'Depth', onChange } });
    await fireEvent.pointerDown(rail(view), { button: 0, clientX: 20, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(20);
  });

  it('a fine creep smaller than one step is not rounded away', async () => {
    const onChange = vi.fn();
    const view = render(FaceParamControl, { props: { kind: 'number', value: 50, display: '50', min: 0, max: 100, step: 1, ariaLabel: 'Depth', onChange } });
    const r = rail(view);
    await fireEvent.pointerDown(r, { button: 0, clientX: 10, pointerId: 1, shiftKey: true });
    for (let x = 11; x <= 18; x++) await fireEvent.pointerMove(r, { clientX: x, pointerId: 1, shiftKey: true }); // 8 × ¼ = 2
    expect(onChange).toHaveBeenLastCalledWith(52);
  });

  it('pressing the rail focuses the value, so the arrows work straight after', async () => {
    const onChange = vi.fn();
    const view = render(FaceParamControl, { props: { kind: 'number', value: 50, display: '50', min: 0, max: 100, step: 1, ariaLabel: 'Depth', onChange } });
    await fireEvent.pointerDown(rail(view), { button: 0, clientX: 50, pointerId: 1 });
    expect(document.activeElement).toBe(view.getByRole('slider', { name: 'Depth' }));
  });

  it('Up / Down step the typed box (Shift: ten); Enter commits it', async () => {
    const onChange = vi.fn();
    const view = render(FaceParamControl, { props: { kind: 'number', value: 50, display: '50', min: 0, max: 100, step: 1, ariaLabel: 'Depth', onChange } });
    const field = view.getByRole('slider', { name: 'Depth' });
    field.setPointerCapture = () => {};
    await fireEvent.pointerDown(field, { button: 0, clientX: 5, pointerId: 1 });
    await fireEvent.pointerUp(field, { button: 0, clientX: 5, pointerId: 1 });
    await tick();
    const box = view.getByRole('textbox', { name: 'Depth value' }) as HTMLInputElement;
    await fireEvent.keyDown(box, { key: 'ArrowUp', shiftKey: true });
    await fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.value).toBe('59');
    await fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(59);
  });

  it('a param with no declared step steps by 1 on a wide range and a hundredth on a narrow one', async () => {
    const onChange = vi.fn();
    const wide = render(FaceParamControl, { props: { kind: 'number', value: 120, display: '120', min: 0, max: 360, ariaLabel: 'Hue', onChange } });
    await fireEvent.keyDown(wide.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(121);
    await fireEvent.keyDown(wide.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(130);
    const narrow = render(FaceParamControl, { props: { kind: 'number', value: 0.5, display: '0.50', min: 0, max: 1, ariaLabel: 'Amount', onChange } });
    await fireEvent.keyDown(narrow.getByRole('slider', { name: 'Amount' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(0.51);
  });
});
