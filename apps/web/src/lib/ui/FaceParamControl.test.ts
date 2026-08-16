// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import FaceParamControl from './FaceParamControl.svelte';
import { DRAG_TRAVEL_PX } from './drag-number';

/* The in-place control that rides a node-face param row (S5). What matters here: the right
   control per declared type, xyflow's drag/pan/wheel guards present (without them a drag on
   the value drags the NODE), one gesture bracket per drag, and a modulated param staying
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

describe('guards against the canvas', () => {
  it('carries nodrag / nopan / nowheel so a value edit never moves or zooms the graph', () => {
    const { container } = render(FaceParamControl, { props: { ...numberProps, onChange: () => {} } });
    const root = container.querySelector('.facectl')!;
    expect(root.classList.contains('nodrag')).toBe(true);
    expect(root.classList.contains('nopan')).toBe(true);
    expect(root.classList.contains('nowheel')).toBe(true);
  });
});

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
