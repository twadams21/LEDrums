// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ListMusic from '@lucide/svelte/icons/list-music';
import ListItem from './ListItem.svelte';

describe('ListItem', () => {
  it('renders the label and secondary sub-label', () => {
    const { container } = render(ListItem, { props: { label: 'Verse', secondary: '3 sections' } });
    expect(container.querySelector('.lab')?.textContent).toBe('Verse');
    expect(container.querySelector('.sub')?.textContent).toBe('3 sections');
  });

  it('omits the secondary sub-label when not provided', () => {
    const { container } = render(ListItem, { props: { label: 'Verse' } });
    expect(container.querySelector('.sub')).toBeNull();
  });

  it('reflects the active state on the row and its button', () => {
    const { container } = render(ListItem, { props: { label: 'Verse', active: true } });
    expect(container.querySelector('.li')?.classList.contains('active')).toBe(true);
    expect(container.querySelector('.li-main')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('is inactive by default', () => {
    const { container } = render(ListItem, { props: { label: 'Verse' } });
    expect(container.querySelector('.li')?.classList.contains('active')).toBe(false);
  });

  it('renders an icon when supplied', () => {
    const { container } = render(ListItem, { props: { label: 'Verse', icon: ListMusic } });
    expect(container.querySelector('.li-main svg')).not.toBeNull();
  });

  it('fires onclick when the row is clicked', async () => {
    const onclick = vi.fn();
    const { container } = render(ListItem, { props: { label: 'Verse', onclick } });
    await fireEvent.click(container.querySelector('.li-main')!);
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('marks the button disabled in the disabled state', () => {
    const { container } = render(ListItem, { props: { label: 'Verse', disabled: true } });
    expect(container.querySelector('.li')?.classList.contains('disabled')).toBe(true);
    expect((container.querySelector('.li-main') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the hover-revealed actions snippet', () => {
    const actions = createRawSnippet(() => ({
      render: () => `<button data-testid="row-action">Delete</button>`,
    }));
    const { getByTestId } = render(ListItem, { props: { label: 'Verse', actions } });
    expect(getByTestId('row-action')).toBeTruthy();
  });
});
