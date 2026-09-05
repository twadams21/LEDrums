// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import Plus from '@lucide/svelte/icons/plus';
import IconButton from './IconButton.svelte';

const REASON = 'Viewing — take over to edit';

describe('IconButton', () => {
  it('keeps native disabled semantics while exposing the reason on keyboard focus and pointer hover', async () => {
    const onclick = vi.fn();
    const { getByRole, unmount } = render(IconButton, {
      props: { icon: Plus, label: 'Add song', disabled: true, disabledReason: REASON, onclick },
    });
    const button = getByRole('button', { name: 'Add song' }) as HTMLButtonElement;
    const trigger = button.parentElement as HTMLElement;

    expect(button.disabled).toBe(true);
    expect(getByRole('group', { name: 'Add song' })).toBe(trigger);
    expect(trigger.getAttribute('aria-label')).toBe('Add song');
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.tabIndex).toBe(0);
    expect(trigger.getAttribute('aria-describedby')).toContain(button.getAttribute('aria-describedby'));
    const description = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe(REASON);

    await fireEvent.focus(trigger);
    expect(trigger.tabIndex).toBe(0);
    expect(trigger.dataset.state).toBe('instant-open');
    expect(document.querySelector('[data-tooltip-content]')?.textContent).toBe(REASON);

    await fireEvent.blur(trigger);
    await fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    expect(trigger.dataset.state).not.toBe('closed');
    expect(document.querySelector('[data-tooltip-content]')?.textContent).toBe(REASON);

    await fireEvent.click(button);
    expect(onclick).not.toHaveBeenCalled();

    // End the pointer interaction before Testing Library tears down Bits UI's derived state.
    await fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    await fireEvent.blur(trigger);
    await new Promise((resolve) => setTimeout(resolve, 20));
    unmount();
  });

  it('calls the editor callback when enabled', async () => {
    const onclick = vi.fn();
    const { getByRole } = render(IconButton, { props: { icon: Plus, label: 'Add song', onclick } });
    await fireEvent.click(getByRole('button', { name: 'Add song' }));
    expect(onclick).toHaveBeenCalledOnce();
  });
});
