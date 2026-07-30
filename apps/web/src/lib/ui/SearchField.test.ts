// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import SearchField from './SearchField.svelte';

/* SearchField had drifted out of the value-control contract: it shipped with no
   `disabled` prop at all, so a caller could disable the TextField beside it but not
   the search box. Adopting ControlProps<string> closed that hole rather than encoding
   it via Omit, which makes `disabled` real behaviour here — and real behaviour needs
   its own evidence. The enabled cases are the control group. */
describe('SearchField', () => {
  it('reports every keystroke through onChange', async () => {
    const onChange = vi.fn();
    const { container } = render(SearchField, { props: { value: '', onChange } });
    const input = container.querySelector('.search-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'kick' } });
    expect(onChange).toHaveBeenCalledWith('kick');
  });

  it('clears to empty through onChange when the clear button is pressed', async () => {
    const onChange = vi.fn();
    const { container } = render(SearchField, { props: { value: 'kick', onChange } });
    const clear = container.querySelector('.search-clear') as HTMLButtonElement;
    expect(clear).not.toBeNull();
    await fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('disables the input itself, not just the pill around it', () => {
    const { container } = render(SearchField, { props: { value: 'kick', disabled: true } });
    const input = container.querySelector('.search-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('does not fire onChange from the clear button while disabled', async () => {
    const onChange = vi.fn();
    const { container } = render(SearchField, { props: { value: 'kick', disabled: true, onChange } });
    const clear = container.querySelector('.search-clear') as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    await fireEvent.click(clear);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('carries the caller-supplied accessible name, defaulting to "Search"', () => {
    const { container, unmount } = render(SearchField, { props: { value: '' } });
    expect(container.querySelector('.search-input')?.getAttribute('aria-label')).toBe('Search');
    unmount();
    const named = render(SearchField, { props: { value: '', ariaLabel: 'Search effects' } });
    expect(named.container.querySelector('.search-input')?.getAttribute('aria-label')).toBe('Search effects');
  });
});
