// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { DEFAULT_KIT, effectChain, inputMapSchema, type KitConfig } from '@ledrums/core';
import { MASTER_CELL } from '../../../trigger-lab/effects-api';
import { createStandaloneEffectsApi } from '../../../trigger-lab/effects-controller.svelte';
import type { MapTarget } from '../../../trigger-lab/map-api';
import { MemoryMapModeApi } from '../../map-mode/memory-map-api.svelte';
import { mapRegistry, type MappableEntry } from '../../map-mode/registry.svelte';
import { ShellStore } from '../../shell-store.svelte';
import { generatorParams, modifierParams } from './strip/cards/card-model';
import Harness from './MapModeApplyHarness.test.svelte';

/* map-mode-apply (effect chains S07b): the Effects grid and device strip register their
   controls with the `mappable` attachment, and in map mode a press on one arms it for learn
   instead of acting. Assertions read the registry (what the overlay outlines) and the two
   apis (what was armed, and what was — or was not — authored). */

type EffectCell = effectChain.EffectCell;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const kit: KitConfig = {
  ...DEFAULT_KIT,
  drums: [
    { ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' },
    { ...DEFAULT_KIT.drums[0]!, id: 'snare', label: 'Snare' },
  ],
};
// Kick has zones 0 + 1, Snare only zone 0 → Snare's zone-1 cell is disabled.
const inputMap = inputMapSchema.parse({
  zones: [
    { drumId: 'kick', slot: 0 },
    { drumId: 'kick', slot: 1 },
    { drumId: 'snare', slot: 0 },
  ],
});
const kickHead: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };

function setup() {
  const api = createStandaloneEffectsApi(
    {
      effects: [
        effectChain.parseEffect({
          id: 'pulse',
          name: 'Pulse',
          cell: kickHead,
          generator: { kind: 'solid' },
          modifiers: [{ uid: 'm1', modifierId: 'strobe' }],
        }),
      ],
      master: [effectChain.modifierDeviceSchema.parse({ uid: 'mm', modifierId: 'levels' })],
    },
    kit,
    { inputMap, canEdit: true },
  );
  api.selectCell(kickHead);
  const mapApi = new MemoryMapModeApi();
  const shell = new ShellStore();
  render(Harness, { api, mapApi, shell });
  flushSync();
  const enter = (): void => {
    shell.setMapMode(true);
    flushSync();
  };
  return { api, mapApi, shell, enter };
}

const ids = (mapApi: MemoryMapModeApi): string[] => mapRegistry.entries.map((e) => mapApi.mapTargetId(e.spec.target));
const has = (mapApi: MemoryMapModeApi, target: MapTarget): boolean => ids(mapApi).includes(mapApi.mapTargetId(target));
const entryFor = (mapApi: MemoryMapModeApi, target: MapTarget): MappableEntry | undefined =>
  mapRegistry.entries.find((e) => mapApi.mapTargetId(e.spec.target) === mapApi.mapTargetId(target));

function press(el: Element): void {
  // A real click is a pointerdown → mousedown → pointerup → mouseup → click sequence.
  fireEvent.pointerDown(el, { button: 0 });
  fireEvent.mouseDown(el, { button: 0 });
  fireEvent.pointerUp(el, { button: 0 });
  fireEvent.mouseUp(el, { button: 0 });
  fireEvent.click(el, { button: 0 });
}

describe('map-mode-apply: grid cells', () => {
  it('registers every enabled cell as a fireCell button, and not the Master or disabled cells', () => {
    const { api, mapApi } = setup();
    const expected: string[] = [];
    for (const row of api.gridRows) {
      for (const col of api.gridColumns) {
        const cell = { row: row.id, column: col.column };
        if (api.cellSummary(cell).enabled) expected.push(mapApi.mapTargetId({ kind: 'fireCell', cell }));
      }
    }
    const cellEntries = mapRegistry.entries.filter((e) => e.spec.target.kind === 'fireCell');
    expect(cellEntries.map((e) => mapApi.mapTargetId(e.spec.target)).sort()).toEqual(expected.sort());
    expect(cellEntries.every((e) => e.spec.kind === 'button' && e.node.getAttribute('role') === 'gridcell')).toBe(true);
    // The Snare zone-1 cell is disabled: nothing to fire, nothing to map.
    expect(has(mapApi, { kind: 'fireCell', cell: { row: 'snare', column: { kind: 'zone', slot: 1 } } })).toBe(false);
  });

  it('in map mode a press on a cell arms it instead of selecting it', () => {
    const { api, mapApi, enter } = setup();
    const kickAlways: EffectCell = { row: 'kick', column: { kind: 'always' } };
    enter();
    press(entryFor(mapApi, { kind: 'fireCell', cell: kickAlways })!.node);
    expect(mapApi.mapLearnTargetId).toBe(mapApi.mapTargetId({ kind: 'fireCell', cell: kickAlways }));
    expect(api.selectedCell).toEqual(kickHead);
  });
});

describe('map-mode-apply: device strip', () => {
  it('registers the Effect power, audition and opacity, and each Modifier power and mix', () => {
    const { mapApi } = setup();
    const expected: [MapTarget, string][] = [
      [{ kind: 'bypass', effectId: 'pulse' }, 'toggle'],
      [{ kind: 'fireEffect', effectId: 'pulse' }, 'button'],
      [{ kind: 'opacity', effectId: 'pulse' }, 'continuous'],
      [{ kind: 'bypass', effectId: 'pulse', modifierUid: 'm1' }, 'toggle'],
      [{ kind: 'modifierMix', effectId: 'pulse', modifierUid: 'm1' }, 'continuous'],
    ];
    for (const [target, kind] of expected) {
      expect(entryFor(mapApi, target)?.spec.kind, mapApi.mapTargetId(target)).toBe(kind);
    }
  });

  it('registers every number face param of the Generator and each Modifier, and no other kind', () => {
    const { api, mapApi } = setup();
    const effect = api.effectById('pulse')!;
    const genNumbers = generatorParams(effect.generator).filter((p) => p.kind === 'number');
    const modNumbers = modifierParams('strobe').filter((p) => p.kind === 'number');
    expect(genNumbers.length + modNumbers.length).toBeGreaterThan(0);
    for (const p of genNumbers) {
      expect(has(mapApi, { kind: 'param', effectId: 'pulse', device: 'generator', param: p.key }), p.key).toBe(true);
    }
    for (const p of modNumbers) {
      expect(has(mapApi, { kind: 'param', effectId: 'pulse', device: 'm1', param: p.key }), p.key).toBe(true);
    }
    const params = mapRegistry.entries.filter((e) => e.spec.target.kind === 'param');
    expect(params).toHaveLength(genNumbers.length + modNumbers.length);
    expect(params.every((e) => e.spec.kind === 'continuous')).toBe(true);
  });

  it('the Master chain registers nothing: a mapping addresses an Effect, and the Master is none', () => {
    const { api, mapApi } = setup();
    api.selectCell(MASTER_CELL);
    flushSync();
    expect(screen.getByRole('button', { name: /on$/ })).toBeTruthy(); // the Master modifier's power renders
    const strip = mapRegistry.entries.filter((e) => e.spec.target.kind !== 'fireCell');
    expect(strip.map((e) => mapApi.mapTargetId(e.spec.target))).toEqual([]);
  });

  it('in map mode a press on the Effect power arms its bypass instead of toggling it', () => {
    const { api, mapApi, enter } = setup();
    enter();
    press(screen.getByRole('button', { name: 'Pulse on' }));
    expect(mapApi.mapLearnTargetId).toBe(mapApi.mapTargetId({ kind: 'bypass', effectId: 'pulse' }));
    expect(api.effectById('pulse')!.bypass).toBe(false);
  });

  it('an armed opacity fader shows its bound CC', () => {
    const { mapApi, enter } = setup();
    enter();
    press(entryFor(mapApi, { kind: 'opacity', effectId: 'pulse' })!.node);
    expect(mapApi.mapLearnTargetId).toBe(mapApi.mapTargetId({ kind: 'opacity', effectId: 'pulse' }));
    expect(mapApi.bindTarget({ kind: 'opacity', effectId: 'pulse' }, { midiCc: 21 })).toEqual({ ok: true });
    flushSync();
    expect(screen.getByRole('region', { name: 'MIDI map mode' }).textContent).toContain('CC 21');
  });
});
