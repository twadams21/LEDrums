// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import SectionsBar from './SectionsBar.svelte';

/* SectionsBar (tabbed chrome row 3): one chip per section of the active song,
   the active section marked, a chip click recalling via setActiveSection. */
function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  return {
    activeSong: {
      id: 's1',
      name: 'Song One',
      sections: [
        { id: 'sec-1', name: 'Intro', graphs: ['g1', 'g2'] },
        { id: 'sec-2', name: 'Chorus', graphs: ['g1'] },
      ],
    },
    activeSectionId: 'sec-1',
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

  it('recalls a section when its chip is clicked', async () => {
    const store = mockStore();
    const { container } = render(SectionsBar, { props: { store } });
    await fireEvent.click(container.querySelectorAll('.chip')[1]!);
    expect(store.setActiveSection).toHaveBeenCalledWith('sec-2');
  });

  it('adds a section from the bar, named after the count, for editors', async () => {
    const store = mockStore();
    const { getByLabelText } = render(SectionsBar, { props: { store } });
    await fireEvent.click(getByLabelText('Add section'));
    expect(store.addSongSection).toHaveBeenCalledWith('Section 3');
  });

  // A viewer keeps the affordance VISIBLE but dead (edit-gate) — hiding it made the
  // bar flash its `+` on load, before presence arrives, and explained nothing.
  it('disables the add affordance for viewers and when there is no song, never hides it', () => {
    const viewer = render(SectionsBar, { props: { store: mockStore({ canEdit: false }) } });
    expect((within(viewer.container).getByLabelText('Add section') as HTMLButtonElement).disabled).toBe(true);
    const noSong = render(SectionsBar, { props: { store: mockStore({ activeSong: null }) } });
    expect((within(noSong.container).getByLabelText('Add section') as HTMLButtonElement).disabled).toBe(true);
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
