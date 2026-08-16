// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { fireEvent, render } from '@testing-library/svelte';
import CommitInput from './CommitInput.svelte';

/* The wheel gesture on a numeric field: one step per tick while hovered, and ONE commit per
   gesture. Each commit is a store mutation with an undo snapshot and a server write, so a
   ten-tick scroll publishing ten of them would be a defect, not a detail. The commit-decision
   rules themselves live in commit-input.test.ts. */

const wheel = (deltaY: number) => new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true });

function renderNumber(props: Record<string, unknown> = {}) {
  const onCommit = vi.fn();
  const { container } = render(CommitInput, {
    props: { type: 'number', value: 10, ariaLabel: 'Pixels', onCommit, ...props },
  });
  return { onCommit, input: container.querySelector('input')! };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CommitInput wheel-adjust', () => {
  it('moves one step per tick and commits once, at the end of the gesture', async () => {
    vi.useFakeTimers();
    const { onCommit, input } = renderNumber();

    for (let i = 0; i < 3; i++) input.dispatchEvent(wheel(-100));
    await tick();
    expect(input.value).toBe('13'); // the field tracks every tick…
    expect(onCommit).not.toHaveBeenCalled(); // …but nothing is published mid-gesture

    vi.advanceTimersByTime(200);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('13');
  });

  it('scrolls down as well as up, and clamps at the bounds', async () => {
    vi.useFakeTimers();
    const { onCommit, input } = renderNumber({ value: 1, min: 0, max: 4 });

    input.dispatchEvent(wheel(100));
    input.dispatchEvent(wheel(100)); // already at min — no further movement
    vi.advanceTimersByTime(200);
    await tick();

    expect(input.value).toBe('0');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('0');
  });

  it('swallows the scroll so the pane underneath stays put', () => {
    const { input } = renderNumber();
    const ev = wheel(-100);
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('leaves the page scrolling when the field is disabled', () => {
    const { onCommit, input } = renderNumber({ disabled: true });
    const ev = wheel(-100);
    input.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('leaves text fields alone — a rename is not a number', () => {
    const onCommit = vi.fn();
    const { container } = render(CommitInput, {
      props: { value: 'Kick', ariaLabel: 'Name', onCommit, autofocus: false },
    });
    const ev = wheel(-100);
    container.querySelector('input')!.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits a wheeled value once when the field is clicked into and blurred', async () => {
    const { onCommit, input } = renderNumber();

    input.dispatchEvent(wheel(-100));
    await fireEvent.focus(input);
    await fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('11');
  });
});
