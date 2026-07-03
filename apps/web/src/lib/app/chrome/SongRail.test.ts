// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import SongRail from './SongRail.svelte';

/* SongRail is thin wiring over the shared EditableRow primitive (rename / select / verbs
   are tested in EditableRow.test). These lock the chrome→store wiring: the right store
   method fires with the right id, and the section count renders as the row's secondary. */
function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  const songs = [
    { id: 's1', name: 'Song One', sections: [{}, {}] },
    { id: 's2', name: 'Song Two', sections: [{}] },
  ];
  return {
    songs,
    // The rail renders the RESOLVED setlist (S42); with no references it mirrors `songs`.
    resolvedSongs: songs,
    activeSongId: 's1',
    canEdit: true, // standalone/editor can author (S2); a viewer (false) hides the Add button
    createSong: vi.fn(),
    renameSong: vi.fn(),
    duplicateSong: vi.fn(),
    removeSong: vi.fn(),
    setActiveSong: vi.fn(),
    // Library-reference verbs — present so the origin-aware row actions resolve (unused for local rows).
    renameLibrarySong: vi.fn(),
    detachSongReference: vi.fn(),
    removeSongReference: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('SongRail', () => {
  it('renders one row per song with its name and pluralised section count', () => {
    const { container } = render(SongRail, { props: { store: mockStore() } });
    const rows = container.querySelectorAll('.li');
    expect(rows.length).toBe(2);
    const labels = [...container.querySelectorAll('.lab')].map((n) => n.textContent);
    expect(labels).toEqual(['Song One', 'Song Two']);
    const subs = [...container.querySelectorAll('.sub')].map((n) => n.textContent);
    expect(subs).toEqual(['2 sections', '1 section']);
  });

  it('marks the active song row', () => {
    const { container } = render(SongRail, { props: { store: mockStore() } });
    const rows = container.querySelectorAll('.li');
    expect(rows[0]?.classList.contains('active')).toBe(true);
    expect(rows[1]?.classList.contains('active')).toBe(false);
  });

  it('selects a song when its row is clicked', async () => {
    const store = mockStore();
    const { container } = render(SongRail, { props: { store } });
    await fireEvent.click(container.querySelectorAll('.li-main')[1]!);
    expect(store.setActiveSong).toHaveBeenCalledWith('s2');
  });

  it('adds a song from the header button', async () => {
    const store = mockStore();
    const { getByLabelText } = render(SongRail, { props: { store } });
    await fireEvent.click(getByLabelText('Add song'));
    expect(store.createSong).toHaveBeenCalledTimes(1);
  });

  it('hides the Add song button for a read-only viewer (S2)', () => {
    const { queryByLabelText } = render(SongRail, { props: { store: mockStore({ canEdit: false }) } });
    expect(queryByLabelText('Add song')).toBeNull();
  });

  it('renders a referenced library song (in resolvedSongs, not songs) with a Library badge and selects it', async () => {
    // A show that references one library song: it appears in the resolved setlist tail, badged.
    const songs = [{ id: 's1', name: 'Local', sections: [{}] }];
    const store = mockStore({
      songs,
      resolvedSongs: [...songs, { id: 'song-9', name: 'Shared', sections: [{}, {}] }],
    });
    const { container } = render(SongRail, { props: { store } });
    const rows = container.querySelectorAll('.li');
    expect(rows.length).toBe(2);
    // the reference row carries the "Library" origin pill; the local row does not
    expect(container.querySelectorAll('.pill').length).toBe(1);
    expect(container.querySelector('.pill')?.textContent).toContain('Library');
    // clicking the reference row selects it (navigable), by its library id
    await fireEvent.click(container.querySelectorAll('.li-main')[1]!);
    expect(store.setActiveSong).toHaveBeenCalledWith('song-9');
  });

  it('renames a song through the inline rename (double-click → type → Enter)', async () => {
    const store = mockStore();
    const { container, findByLabelText } = render(SongRail, { props: { store } });
    await fireEvent.dblClick(container.querySelector('.li-main')!);
    const input = (await findByLabelText('Rename song')) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Intro' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(store.renameSong).toHaveBeenCalledWith('s1', 'Intro'));
  });
});
