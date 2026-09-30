// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import type { ApplyResult, EffectsAuthoringApi } from '../../trigger-lab/effects-api';
import { toastStore } from '../../ui/toast.svelte';
import SongsBar from './SongsBar.svelte';
import { mapRegistry } from '../map-mode/registry.svelte';
import { VIEWING_REASON } from './edit-gate';

/* SongsBar replaces the rail's SongRail in the tabbed chrome. These lock the
   chrome→store wiring: one chip per resolved setlist song (references wear a
   visible Library badge), the active chip marked, select/add/rename going to the
   right store methods, and the editor affordances hidden from viewers. */
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
    globalControls: {},
    canStepSetlist: vi.fn(() => true),
    stepSetlist: vi.fn(),
    canEdit: true,
    createSong: vi.fn(),
    setActiveSong: vi.fn(),
    renameSong: vi.fn(),
    renameLibrarySong: vi.fn(),
    duplicateSong: vi.fn(),
    removeSong: vi.fn(),
    removeSongReference: vi.fn(),
    detachSongReference: vi.fn(),
    // The bar's default authoring api (import surface): nothing to import.
    effectsApi: { legacyImportAvailable: false, legacyShowNames: [] },
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

  it('flanks the scrolling chips with accessible navigation arrows', async () => {
    const store = mockStore();
    const { getByRole } = render(SongsBar, { props: { store } });
    await fireEvent.click(getByRole('button', { name: 'Next song' }));
    expect(store.stepSetlist).toHaveBeenCalledWith('song', 1);
    expect(getByRole('button', { name: 'Previous song' }).getAttribute('aria-label')).toBe('Previous song');
  });

  it('selects a song when its chip is clicked', async () => {
    const store = mockStore();
    const { container } = render(SongsBar, { props: { store } });
    await fireEvent.click(container.querySelectorAll('.chip')[1]!);
    expect(store.setActiveSong).toHaveBeenCalledWith('s2');
  });

  it('adds a song from the bar button; stays disabled, explained, and reactive for a viewer', async () => {
    const store = mockStore();
    const { getByLabelText } = render(SongsBar, { props: { store } });
    await fireEvent.click(getByLabelText('Add song'));
    expect(store.createSong).toHaveBeenCalledTimes(1);

    const viewerStore = mockStore({ canEdit: false });
    const viewer = render(SongsBar, { props: { store: viewerStore } });
    const add = within(viewer.container).getByRole('button', { name: 'Add song' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(viewer.container.textContent).toContain(VIEWING_REASON);
    await fireEvent.click(add);
    expect(viewerStore.createSong).not.toHaveBeenCalled();

    viewerStore.canEdit = true;
    await viewer.rerender({ store: viewerStore });
    expect(add.disabled).toBe(false);
    await fireEvent.click(add);
    expect(viewerStore.createSong).toHaveBeenCalledTimes(1);
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

/* Import from the previous version (effect chains S06c): the notice, the setlist-menu action and
   the confirm dialog read and drive ONLY the authoring api's import surface. */
describe('SongsBar — legacy show import', () => {
  function importApi(over: Partial<Record<string, unknown>> = {}) {
    return {
      legacyImportAvailable: true,
      legacyShowNames: ['Old Tour', 'Festival'],
      importLegacyShows: vi.fn((): ApplyResult => ({ ok: true })),
      dismissLegacyImport: vi.fn(),
      ...over,
    } as unknown as EffectsAuthoringApi;
  }

  // jsdom has no Web Animations; the notice's enter / exit transitions need a minimal one that
  // finishes on the next tick.
  beforeAll(() => {
    Element.prototype.animate ??= function animate(): Animation {
      const animation = { onfinish: null as null | (() => void), cancel() {}, finish() {}, currentTime: 0 };
      setTimeout(() => animation.onfinish?.(), 0);
      return animation as unknown as Animation;
    };
  });
  afterEach(() => toastStore.clear());

  it('offers a notice that explains what is kept; confirming lists the shows and imports them', async () => {
    const api = importApi();
    const { getByRole, queryByRole } = render(SongsBar, { props: { store: mockStore(), api } });
    const notice = getByRole('region', { name: 'Import shows from the previous version' });
    expect(notice.textContent).toContain('kit, patch and inputs are kept');
    expect(notice.textContent).toContain('Graphs are not carried over');
    expect(notice.textContent).toContain('old data is left untouched');

    await fireEvent.click(within(notice).getByRole('button', { name: 'Import 2 shows…' }));
    const list = await waitFor(() => screen.getByRole('list', { name: 'Shows to import' }));
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Old Tour', 'Festival']);
    // The notice steps aside while its dialog is open.
    await waitFor(() => expect(queryByRole('region', { name: 'Import shows from the previous version' })).toBeNull());

    await fireEvent.click(screen.getByRole('button', { name: 'Import 2 shows' }));
    expect(api.importLegacyShows).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Shows to import' })).toBeNull());
    expect(toastStore.items.map((t) => [t.message, t.tone])).toEqual([['Imported 2 shows from the previous version.', 'success']]);
  });

  it('keeps the dialog open with the reason when the import is refused', async () => {
    const api = importApi({ importLegacyShows: vi.fn((): ApplyResult => ({ ok: false, reason: 'Storage is full.' })) });
    const { getByRole } = render(SongsBar, { props: { store: mockStore(), api } });
    await fireEvent.click(getByRole('button', { name: 'Import 2 shows…' }));
    await fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Import 2 shows' })));
    expect((await waitFor(() => screen.getByRole('alert'))).textContent).toBe('Storage is full.');
    expect(screen.getByRole('list', { name: 'Shows to import' })).toBeTruthy();
    expect(toastStore.items).toEqual([]);
  });

  it('dismisses the offer through the api', async () => {
    const api = importApi();
    const { getByRole } = render(SongsBar, { props: { store: mockStore(), api } });
    await fireEvent.click(getByRole('button', { name: 'Dismiss import notice' }));
    expect(api.dismissLegacyImport).toHaveBeenCalledTimes(1);
    await fireEvent.click(getByRole('button', { name: 'Not now' }));
    expect(api.dismissLegacyImport).toHaveBeenCalledTimes(2);
    expect(api.importLegacyShows).not.toHaveBeenCalled();
  });

  it('shows no notice once the offer is gone, or to a viewer', () => {
    const dismissed = render(SongsBar, { props: { store: mockStore(), api: importApi({ legacyImportAvailable: false }) } });
    expect(dismissed.container.querySelector('[data-legacy-import-notice]')).toBeNull();
    dismissed.unmount();
    const viewer = render(SongsBar, { props: { store: mockStore({ canEdit: false }), api: importApi() } });
    expect(viewer.container.querySelector('[data-legacy-import-notice]')).toBeNull();
  });

  it('keeps the on-demand setlist-menu action after a dismiss', async () => {
    const api = importApi({ legacyImportAvailable: false });
    const { getByRole } = render(SongsBar, { props: { store: mockStore(), api } });
    await fireEvent.keyDown(getByRole('button', { name: 'Setlist actions' }), { key: 'Enter' });
    await fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: 'Import shows from the previous version…' })));
    expect(await waitFor(() => screen.getByRole('list', { name: 'Shows to import' }))).toBeTruthy();
  });

  it('disables the menu action, with the reason, when there is nothing to import', async () => {
    const api = importApi({ legacyImportAvailable: false, legacyShowNames: [] });
    const { getByRole } = render(SongsBar, { props: { store: mockStore(), api } });
    await fireEvent.keyDown(getByRole('button', { name: 'Setlist actions' }), { key: 'Enter' });
    const item = await waitFor(() => screen.getByRole('menuitem', { name: /^Import shows — No shows from the previous version/ }));
    expect(item.hasAttribute('data-disabled') || item.getAttribute('aria-disabled') === 'true').toBe(true);
  });
});

describe('SongsBar in MIDI-map mode', () => {
  it('registers the arrows as the song global controls (song chips have no mapping target)', () => {
    const { container } = render(SongsBar, { props: { store: mockStore() } });
    const mine = mapRegistry.entries.filter((e) => container.contains(e.node));
    expect(mine.map((e) => e.spec.target)).toEqual([
      { kind: 'globalControl', action: 'prevSong' },
      { kind: 'globalControl', action: 'nextSong' },
    ]);
    expect(mine.map((e) => e.spec.label)).toEqual(['Previous song', 'Next song']);
  });
});
