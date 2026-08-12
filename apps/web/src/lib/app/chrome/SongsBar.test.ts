// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import SongsBar from './SongsBar.svelte';

/* SongsBar replaces the rail's SongRail in the tabbed chrome. These lock the
   chrome→store wiring: one chip per resolved setlist song (references badged in
   the tooltip), the active chip marked, select/add going to the right store
   methods, and the Add affordance hidden from viewers. */
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

  it('adds a song from the bar button; hidden for a read-only viewer', async () => {
    const store = mockStore();
    const { getByLabelText } = render(SongsBar, { props: { store } });
    await fireEvent.click(getByLabelText('Add song'));
    expect(store.createSong).toHaveBeenCalledTimes(1);

    const viewer = render(SongsBar, { props: { store: mockStore({ canEdit: false }) } });
    expect(viewer.queryByLabelText('Add song')).toBeNull();
  });

  it('renders a referenced library song (resolved tail) with a Library tooltip and empty-setlist copy', () => {
    const songs = [{ id: 's1', name: 'Local', sections: [{}] }];
    const store = mockStore({
      songs,
      resolvedSongs: [...songs, { id: 'song-9', name: 'Shared', sections: [{}, {}] }],
    });
    const { container } = render(SongsBar, { props: { store } });
    const chips = container.querySelectorAll('.chip');
    expect(chips.length).toBe(2);
    expect(chips[1]?.getAttribute('title')).toBe('Shared (Library)');

    const empty = render(SongsBar, { props: { store: mockStore({ songs: [], resolvedSongs: [] }) } });
    expect(empty.container.textContent).toContain('No songs in this show');
  });
});
