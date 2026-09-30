// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import { mapRegistry } from '../map-mode/registry.svelte';
import Transport from './Transport.svelte';

/* Transport in MIDI-map mode: the buttons that have a global-control twin (TAP, Stop all)
   register it, so mapping one writes the Settings binding for that action. */
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});

function mockStore(): TriggerLab {
  return {
    playing: false,
    beat: 0,
    beatsPerBar: 4,
    bpm: 120,
    velocity: 1,
    togglePlay: vi.fn(),
    panic: vi.fn(),
  } as unknown as TriggerLab;
}

describe('Transport in MIDI-map mode', () => {
  it('registers TAP as tap tempo and Stop all as stop all voices', () => {
    const { container } = render(Transport, { props: { store: mockStore() } });
    const mine = mapRegistry.entries.filter((e) => container.contains(e.node));
    expect(mine.map((e) => [e.node.textContent?.trim(), e.spec.target])).toEqual([
      ['TAP', { kind: 'globalControl', action: 'tapTempo' }],
      ['Stop all', { kind: 'globalControl', action: 'stopAllVoices' }],
    ]);
  });
});
