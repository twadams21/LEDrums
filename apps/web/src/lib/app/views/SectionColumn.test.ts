// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import { MASTER_CELL } from '../../trigger-lab/effects-api';
import { createStandaloneEffectsApi } from '../../trigger-lab/effects-controller.svelte';
import type { ShellStore } from '../shell-store.svelte';
import type { SetlistSection, Song } from '../setlist';
import SectionColumn from './SectionColumn.svelte';
import { mapRegistry } from '../map-mode/registry.svelte';

/* A Sections-view column summarises ITS section's grid (not the api's active one): one row per
   occupied cell with its Effect names, plus the Master chain. Clicking a row activates the
   section, selects that cell and opens the Effects view — the S06c navigation contract. */

type EffectCell = effectChain.EffectCell;

const kit: KitConfig = {
  ...DEFAULT_KIT,
  drums: [{ ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' }],
};
const kickHead: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const kitClock: EffectCell = { row: 'kit', column: { kind: 'clock' } };
const fx = (id: string, name: string, cell: EffectCell) => effectChain.parseEffect({ id, name, cell, generator: { kind: 'solid' } });

function fixture(section: Partial<SetlistSection> & Record<string, unknown>) {
  const store = {
    activeSectionId: 's1',
    canEditActiveSong: true,
    canEdit: true,
    isViewer: false,
    isLocalSong: () => true,
    activeSongById: { sections: [{ id: 's1' }, { id: 's2' }] },
    setActiveSection: vi.fn(),
    renameSection: vi.fn(),
  } as unknown as TriggerLab;
  const shell = { select: vi.fn(), setView: vi.fn() } as unknown as ShellStore;
  // The api's active section is a DIFFERENT one: the column must read its own section value.
  const api = createStandaloneEffectsApi({ effects: [fx('other', 'Not this', kickHead)], master: [] }, kit);
  const full = { id: 's2', name: 'Chorus', graphs: [], looks: {}, ...section } as SetlistSection;
  const song = { id: 'song', name: 'Song', sections: [full] } as Song;
  const view = render(SectionColumn, { props: { store, api, shell, song, section: full, onSectionDragStart: () => {}, onDragEnd: () => {} } });
  return { store, shell, api, ...view };
}

describe('SectionColumn — Effect summary', () => {
  it('lists the section’s occupied cells with their Effect names, and the Master chain first', () => {
    const { container } = fixture({
      effects: [fx('a', 'Pulse', kickHead), fx('b', 'Glow', kickHead), fx('c', 'Tick', kitClock)],
      master: [{ uid: 'm1', modifierId: 'strobe', params: {}, mix: 1, bypass: false }],
    });
    const rows = [...container.querySelectorAll('[data-cell-row]')];
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('Master');
    expect(rows[1]!.querySelector('.rowname')!.textContent).toBe('Kit');
    expect(rows[1]!.querySelector('.names')!.textContent).toBe('Tick');
    expect(rows[2]!.querySelector('.names')!.textContent).toBe('Pulse · Glow');
    expect(rows[2]!.querySelector('.count')!.textContent).toBe('2');
    expect(container.querySelector('.colcount')!.textContent).toBe('3');
    expect(container.textContent).not.toContain('Not this');
  });

  it('opens a cell: activates the section, selects the cell, switches to the Effects view', async () => {
    const { container, store, shell, api } = fixture({ effects: [fx('a', 'Pulse', kickHead)], master: [] });
    await fireEvent.click(container.querySelector('[data-cell-row]')!);
    expect(store.setActiveSection).toHaveBeenCalledWith('s2');
    expect(api.selectedCell).toEqual(kickHead);
    expect(shell.setView).toHaveBeenCalledWith('trigger');
  });

  it('opens the Master chain and the empty grid', async () => {
    const { getByRole, getByText, api, shell } = fixture({
      effects: [],
      master: [{ uid: 'm1', modifierId: 'strobe', params: {}, mix: 1, bypass: true }],
    });
    await fireEvent.click(getByRole('button', { name: /^Open Master/ }));
    expect(api.selectedCell).toBe(MASTER_CELL);
    await fireEvent.click(getByText('Edit effects'));
    expect(api.selectedCell).toBeNull();
    expect(shell.setView).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state for a section with no Effects (and a graph-shaped one)', () => {
    const { container } = fixture({});
    expect(container.querySelectorAll('[data-cell-row]')).toHaveLength(0);
    expect(container.textContent).toContain('No effects yet.');
    expect(container.querySelector('.colcount')!.textContent).toBe('0');
  });

  it('marks a fully bypassed cell in its accessible name', () => {
    const bypassed = { ...fx('a', 'Pulse', kickHead), bypass: true };
    const { getByRole } = fixture({ effects: [bypassed], master: [] });
    expect(getByRole('button', { name: /Pulse, bypassed$/ })).toBeTruthy();
  });
});

describe('SectionColumn in MIDI-map mode', () => {
  it('registers its header as a recall of this section in its own song', () => {
    const { container } = fixture({});
    const mine = mapRegistry.entries.filter((e) => container.contains(e.node));
    expect(mine.map((e) => [e.spec.target, e.spec.kind, e.spec.label])).toEqual([
      [{ kind: 'recallSection', sectionId: 's2', songId: 'song' }, 'button', 'Section · Chorus'],
    ]);
  });
});
