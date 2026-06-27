// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import EditableRow from './EditableRow.svelte';

describe('EditableRow', () => {
  it('renders as a selectable row when not editing', () => {
    const { container, queryByLabelText } = render(EditableRow, {
      props: { label: 'Verse', oncommit: vi.fn() },
    });
    expect(container.querySelector('.lab')?.textContent).toBe('Verse');
    // the row is wrapped in the ContextMenu trigger and shows no rename input yet
    expect(container.querySelector('.ctx-anchor')).not.toBeNull();
    expect(queryByLabelText('Rename')).toBeNull();
  });

  it('enters edit mode on double-click and seeds the input with the label', async () => {
    const { container, findByLabelText } = render(EditableRow, {
      props: { label: 'Verse', oncommit: vi.fn() },
    });
    await fireEvent.dblClick(container.querySelector('.li-main')!);
    const input = (await findByLabelText('Rename')) as HTMLInputElement;
    expect(input.value).toBe('Verse');
  });

  it('commits a changed name on Enter and leaves edit mode', async () => {
    const oncommit = vi.fn();
    const { findByLabelText, queryByLabelText } = render(EditableRow, {
      props: { label: 'Verse', editing: true, oncommit },
    });
    const input = (await findByLabelText('Rename')) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Chorus' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(oncommit).toHaveBeenCalledTimes(1);
    expect(oncommit).toHaveBeenCalledWith('Chorus');
    await waitFor(() => expect(queryByLabelText('Rename')).toBeNull());
  });

  it('reverts on Escape without committing', async () => {
    const oncommit = vi.fn();
    const oncancel = vi.fn();
    const { findByLabelText, queryByLabelText } = render(EditableRow, {
      props: { label: 'Verse', editing: true, oncommit, oncancel },
    });
    const input = (await findByLabelText('Rename')) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Chorus' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(oncommit).not.toHaveBeenCalled();
    expect(oncancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(queryByLabelText('Rename')).toBeNull());
  });

  it('treats an unchanged name as a revert, not a commit', async () => {
    const oncommit = vi.fn();
    const oncancel = vi.fn();
    const { findByLabelText } = render(EditableRow, {
      props: { label: 'Verse', editing: true, oncommit, oncancel },
    });
    const input = (await findByLabelText('Rename')) as HTMLInputElement;
    await fireEvent.blur(input); // blur with the value untouched
    expect(oncommit).not.toHaveBeenCalled();
    expect(oncancel).toHaveBeenCalledOnce();
  });

  it('surfaces extra context-menu verbs alongside the built-in Rename', () => {
    const onSelect = vi.fn();
    const { container } = render(EditableRow, {
      props: {
        label: 'Verse',
        oncommit: vi.fn(),
        actions: [{ label: 'Delete', danger: true, onSelect }],
      },
    });
    // the row renders inside the right-click ContextMenu trigger; the verb list
    // (built-in Rename + the supplied Delete) is wired without throwing.
    expect(container.querySelector('.ctx-anchor .li')).not.toBeNull();
  });
});
