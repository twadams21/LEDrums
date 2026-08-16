// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Field from './Field.svelte';

/* Locks the label-forwarding split: the default variant is a real <label> (click focuses /
   activates the wrapped control — the point of a label), while variant="group" must NOT be a
   <label>, because a native label click activates the FIRST labelable descendant — for a
   composite control like SegmentedControl that silently clicks its first button (e.g. the
   Mirror row resetting to None). The group wrapper keeps its accessible name via
   role=group + aria-labelledby. */

const button = createRawSnippet(() => ({
  render: () => `<button type="button" data-testid="inner">First</button>`,
}));

describe('Field', () => {
  it('default variant wraps in a <label> (native forwarding intact)', () => {
    render(Field, { props: { label: 'Port', children: button } });
    const wrapper = screen.getByText('Port').closest('.field');
    expect(wrapper?.tagName).toBe('LABEL');
  });

  it('variant="group" is NOT a <label>: a click on the label text must not reach the control', async () => {
    render(Field, { props: { label: 'Mirror', variant: 'group', children: button } });
    const labelText = screen.getByText('Mirror');
    expect(labelText.closest('label')).toBeNull();

    const inner = screen.getByTestId('inner');
    const onClick = vi.fn();
    inner.addEventListener('click', onClick);
    await fireEvent.click(labelText);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('variant="group" keeps the accessible name via role=group + aria-labelledby', () => {
    render(Field, { props: { label: 'Mirror', variant: 'group', children: button } });
    const group = screen.getByRole('group', { name: 'Mirror' });
    expect(group.classList.contains('field')).toBe(true);
  });
});
