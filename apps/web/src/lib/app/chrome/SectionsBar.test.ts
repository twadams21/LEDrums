// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import SectionsBar from './SectionsBar.svelte';
import { NO_ACTIVE_SONG_REASON, REFERENCE_SONG_REASON, VIEWING_REASON } from './edit-gate';

/* SectionsBar (tabbed chrome row 3): one chip per section of the active song,
   the active section marked, a chip click recalling via setActiveSection. */
function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  const activeSong = {
    id: 's1',
    name: 'Song One',
    sections: [
      { id: 'sec-1', name: 'Intro', graphs: ['g1', 'g2'] },
      { id: 'sec-2', name: 'Chorus', graphs: ['g1'] },
    ],
  };
  const configuredActiveSong = 'activeSong' in over ? over.activeSong : activeSong;
  return {
    activeSong: configuredActiveSong,
    activeSongById: configuredActiveSong,
    activeLocalSong: configuredActiveSong,
    activeSectionId: 'sec-1',
    globalControls: {},
    canStepSetlist: vi.fn(() => true),
    stepSetlist: vi.fn(),
    canEdit: true,
    setActiveSection: vi.fn(),
    addSongSection: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('SectionsBar', () => {
  it('renders one chip per section with its name and graph count', () => {
    const { container } = render(SectionsBar, { props: { store: mockStore() } });
    const chips = [...container.querySelectorAll('.chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['Intro2', 'Chorus1']);
  });

  it('marks the active section chip', () => {
    const { container } = render(SectionsBar, { props: { store: mockStore() } });
    const chips = container.querySelectorAll('.chip');
    expect(chips[0]?.classList.contains('on')).toBe(true);
    expect(chips[1]?.classList.contains('on')).toBe(false);
  });

  it('flanks the scrolling chips with accessible navigation arrows', async () => {
    const store = mockStore();
    const { getByRole } = render(SectionsBar, { props: { store } });
    await fireEvent.click(getByRole('button', { name: 'Next section' }));
    expect(store.stepSetlist).toHaveBeenCalledWith('section', 1);
  });

  it('recalls a section when its chip is clicked', async () => {
    const store = mockStore();
    const { container } = render(SectionsBar, { props: { store } });
    await fireEvent.click(container.querySelectorAll('.chip')[1]!);
    expect(store.setActiveSection).toHaveBeenCalledWith('sec-2');
  });

  it('adds and names a section through the section controller action', async () => {
    const store = mockStore();
    const { getByLabelText } = render(SectionsBar, { props: { store } });
    await fireEvent.click(getByLabelText('Add section'));
    expect(store.addSongSection).toHaveBeenCalledWith('Section 3');
  });

  it('keeps the add control disabled and explained for viewers, then re-enables it after takeover', async () => {
    const store = mockStore({ canEdit: false });
    const { getByRole, rerender } = render(SectionsBar, { props: { store } });
    const add = getByRole('button', { name: 'Add section' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute('aria-describedby')).toBeTruthy();
    expect(within(add.parentElement!.parentElement!).getByText(VIEWING_REASON)).toBeTruthy();

    await fireEvent.click(add);
    expect(store.addSongSection).not.toHaveBeenCalled();

    store.canEdit = true;
    await rerender({ store });
    expect(add.disabled).toBe(false);
    await fireEvent.click(add);
    expect(store.addSongSection).toHaveBeenCalledWith('Section 3');
  });

  it('keeps the add control visible and precisely explains the no-song state', async () => {
    const store = mockStore({ activeSong: null, canEdit: false });
    const { getByRole, container } = render(SectionsBar, { props: { store } });
    const add = getByRole('button', { name: 'Add section' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(container.textContent).toContain(NO_ACTIVE_SONG_REASON);
    expect(container.textContent).not.toContain(VIEWING_REASON);
    await fireEvent.click(add);
    expect(store.addSongSection).not.toHaveBeenCalled();
  });

  it('disables section add for a canonical song, with the reference reason taking precedence over viewer state', async () => {
    const reference = mockStore({ activeSongById: mockStore().activeSong, activeLocalSong: null, canEdit: false });
    const { getByRole, container } = render(SectionsBar, { props: { store: reference } });
    const add = getByRole('button', { name: 'Add section' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(container.textContent).toContain(REFERENCE_SONG_REASON);
    expect(container.textContent).not.toContain(VIEWING_REASON);
    await fireEvent.click(add);
    expect(reference.addSongSection).not.toHaveBeenCalled();
  });

  it('shows the empty state when the active song has no sections (or no song)', () => {
    const none = render(SectionsBar, {
      props: { store: mockStore({ activeSong: { id: 's1', name: 'Empty', sections: [] } }) },
    });
    expect(none.container.textContent).toContain('No sections in this song');
    const noSong = render(SectionsBar, { props: { store: mockStore({ activeSong: null }) } });
    expect(noSong.container.textContent).toContain('No sections in this song');
  });
});
