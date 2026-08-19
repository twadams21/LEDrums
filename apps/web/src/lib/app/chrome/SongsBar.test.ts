// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import SongsBar from './SongsBar.svelte';

/* SongsBar replaces the rail's SongRail in the tabbed chrome. These lock the
   chrome→store wiring: one chip per resolved setlist song (references wear a
   visible Library badge), the active chip marked, select/add/rename going to the
   right store methods, and the editor affordances disabled (not hidden) for viewers. */
function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  const songs = [
    { id: 's1', name: 'Song One', sections: [{}, {}] },
    { id: 's2', name: 'Song Two', sections: [{}] },
  ];
  return {
    songs,
    // The bar renders the RESOLVED setlist (S42); with no references it mirrors `songs`.
    resolvedSongs: songs,
    activeSongId: 's1',
    canEdit: true,
    createSong: vi.fn(),
    setActiveSong: vi.fn(),
    renameSong: vi.fn(),
    renameLibrarySong: vi.fn(),
    duplicateSong: vi.fn(),
    removeSong: vi.fn(),
    removeSongReference: vi.fn(),
    detachSongReference: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('SongsBar', () => {
  it('renders one chip per song with its name and section count', () => {
    const { container } = render(SongsBar, { props: { store: mockStore() } });
    const chips = [...container.querySelectorAll('.chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['Song One2', 'Song Two1']);
  });

  it('marks the active song chip', () => {
    const { container } = render(SongsBar, { props: { store: mockStore() } });
    const chips = container.querySelectorAll('.chip');
    expect(chips[0]?.classList.contains('on')).toBe(true);
    expect(chips[1]?.classList.contains('on')).toBe(false);
  });

  it('selects a song when its chip is clicked', async () => {
    const store = mockStore();
    const { container } = render(SongsBar, { props: { store } });
    await fireEvent.click(container.querySelectorAll('.chip')[1]!);
    expect(store.setActiveSong).toHaveBeenCalledWith('s2');
  });

  it('adds a song from the bar button; disabled (not hidden) for a read-only viewer', async () => {
    const store = mockStore();
    const { getByLabelText } = render(SongsBar, { props: { store } });
    await fireEvent.click(getByLabelText('Add song'));
    expect(store.createSong).toHaveBeenCalledTimes(1);

    // The viewer keeps the control on screen, dead (edit-gate) — a `+` that vanishes
    // once presence lands reads as a bug, not as read-only.
    const viewer = render(SongsBar, { props: { store: mockStore({ canEdit: false }) } });
    expect((within(viewer.container).getByLabelText('Add song') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders a referenced library song (resolved tail) with a Library tooltip and empty-setlist copy', () => {
    const songs = [{ id: 's1', name: 'Local', sections: [{}] }];
    const store = mockStore({
      songs,
      resolvedSongs: [...songs, { id: 'song-9', name: 'Shared', sections: [{}, {}] }],
    });
    const { container, getByLabelText } = render(SongsBar, { props: { store } });
    const chips = container.querySelectorAll('.chip');
    expect(chips.length).toBe(2);
    expect(chips[1]?.getAttribute('title')).toBe('Shared (Library)');
    // The reference wears a VISIBLE Library badge, not just a tooltip.
    expect(chips[1]?.contains(getByLabelText('Library reference'))).toBe(true);
    expect(chips[0]?.querySelector('.ref')).toBeNull();

    const empty = render(SongsBar, { props: { store: mockStore({ songs: [], resolvedSongs: [] }) } });
    expect(empty.container.textContent).toContain('No songs in this show');
  });

  it('double-click renames a local song inline via the store', async () => {
    const store = mockStore();
    const { container, findByLabelText, queryByLabelText } = render(SongsBar, { props: { store } });
    await fireEvent.dblClick(container.querySelectorAll('.chip')[1]!);
    const input = (await findByLabelText('Rename song')) as HTMLInputElement;
    expect(input.value).toBe('Song Two');
    await fireEvent.input(input, { target: { value: 'Song 2.1' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(store.renameSong).toHaveBeenCalledWith('s2', 'Song 2.1');
    await waitFor(() => expect(queryByLabelText('Rename song')).toBeNull());
  });

  it('renaming a library reference routes to the canonical library copy', async () => {
    const songs = [{ id: 's1', name: 'Local', sections: [{}] }];
    const store = mockStore({
      songs,
      resolvedSongs: [...songs, { id: 'song-9', name: 'Shared', sections: [{}] }],
    });
    const { container, findByLabelText } = render(SongsBar, { props: { store } });
    await fireEvent.dblClick(container.querySelectorAll('.chip')[1]!);
    const input = (await findByLabelText('Rename library song')) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Shared v2' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(store.renameLibrarySong).toHaveBeenCalledWith('song-9', 'Shared v2');
    expect(store.renameSong).not.toHaveBeenCalled();
  });

  it('a read-only viewer cannot enter the inline rename', async () => {
    const store = mockStore({ canEdit: false });
    const { container, queryByLabelText } = render(SongsBar, { props: { store } });
    await fireEvent.dblClick(container.querySelectorAll('.chip')[0]!);
    // startRename defers a frame; give it one before asserting nothing mounted.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(queryByLabelText('Rename song')).toBeNull();
  });
});
