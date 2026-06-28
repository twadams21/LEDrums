// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import EditableRow from './EditableRow.svelte';

describe('EditableRow', () => {
  it('renders as a selectable row when not editing', () => {
    const { container, queryByLabelText } = render(EditableRow, {
      props: { label: 'Verse', onCommit: vi.fn() },
    });
    expect(container.querySelector('.lab')?.textContent).toBe('Verse');
    // the row is wrapped in the ContextMenu trigger and shows no rename input yet
    expect(container.querySelector('.ctx-anchor')).not.toBeNull();
    expect(queryByLabelText('Rename')).toBeNull();
  });

  it('enters edit mode on double-click and seeds the input with the label', async () => {
    const { container, findByLabelText } = render(EditableRow, {
      props: { label: 'Verse', onCommit: vi.fn() },
    });
    await fireEvent.dblClick(container.querySelector('.li-main')!);
    const input = (await findByLabelText('Rename')) as HTMLInputElement;
    expect(input.value).toBe('Verse');
  });

  it('commits a changed name on Enter and leaves edit mode', async () => {
    const onCommit = vi.fn();
    const { findByLabelText, queryByLabelText } = render(EditableRow, {
      props: { label: 'Verse', editing: true, onCommit },
    });
    const input = (await findByLabelText('Rename')) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Chorus' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Chorus');
    await waitFor(() => expect(queryByLabelText('Rename')).toBeNull());
  });

  it('reverts on Escape without committing', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { findByLabelText, queryByLabelText } = render(EditableRow, {
      props: { label: 'Verse', editing: true, onCommit, onCancel },
    });
    const input = (await findByLabelText('Rename')) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Chorus' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(queryByLabelText('Rename')).toBeNull());
  });

  it('treats an unchanged name as a revert, not a commit', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { findByLabelText } = render(EditableRow, {
      props: { label: 'Verse', editing: true, onCommit, onCancel },
    });
    const input = (await findByLabelText('Rename')) as HTMLInputElement;
    await fireEvent.blur(input); // blur with the value untouched
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('surfaces extra context-menu verbs alongside the built-in Rename', () => {
    const onSelect = vi.fn();
    const { container } = render(EditableRow, {
      props: {
        label: 'Verse',
        onCommit: vi.fn(),
        actions: [{ label: 'Delete', danger: true, onSelect }],
      },
    });
    // the row renders inside the right-click ContextMenu trigger; the verb list
    // (built-in Rename + the supplied Delete) is wired without throwing.
    expect(container.querySelector('.ctx-anchor .li')).not.toBeNull();
  });

  it('forwards the quickActions snippet to the row as hover quick-actions', () => {
    const quickActions = createRawSnippet(() => ({
      render: () => `<button data-testid="quick">Duplicate</button>`,
    }));
    const { container, getByTestId } = render(EditableRow, {
      props: { label: 'Verse', onCommit: vi.fn(), quickActions },
    });
    expect(getByTestId('quick')).toBeTruthy();
    expect(container.querySelector('.li-actions [data-testid="quick"]')).not.toBeNull();
  });

  it('forwards the trailing snippet to the row as an always-visible indicator', () => {
    const trailing = createRawSnippet(() => ({
      render: () => `<span data-testid="dot">●</span>`,
    }));
    const { container } = render(EditableRow, {
      props: { label: 'Verse', onCommit: vi.fn(), trailing },
    });
    expect(container.querySelector('.li-trailing [data-testid="dot"]')).not.toBeNull();
  });
});
