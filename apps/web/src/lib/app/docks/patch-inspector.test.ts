import { describe, expect, it } from 'vitest';
import type { InputMap, KitConfig, voice } from '@ledrums/core';
import type { HoopRef, PatchRouting } from '../patch-routing';
import { makeNode } from '../../trigger-lab/sim.graph-compilation';
import {
  addDeclaredZone,
  defaultZoneName,
  boundTriggerFor,
  buildPixelOutputTable,
  hoopPixelSpan,
  nextZoneSlot,
  setZoneLabel,
  zoneLabel,
  patchEditorFor,
  perHoopPixelCount,
  physicalPortLine,
  pixelsPerHoopForDrum,
  removeZone,
  setZoneMidiNote,
  setZoneOscAddress,
  totalKitPixelCount,
  zoneMidiNote,
  zoneOscAddress,
  zoneSlot,
  zoneSlotsForDrum,
} from './patch-inspector';

describe('patchEditorFor', () => {
  it('decodes the far-end singletons', () => {
    expect(patchEditorFor('input')).toEqual({ kind: 'input' });
    expect(patchEditorFor('controller')).toEqual({ kind: 'controller' });
  });

  it('decodes a trigger node', () => {
    expect(patchEditorFor('trigger:snare')).toEqual({ kind: 'trigger', drumId: 'snare' });
  });

  it('decodes a zone node to drumId + label + slot', () => {
    expect(patchEditorFor('zone:snare:edge')).toEqual({ kind: 'zone', drumId: 'snare', zone: 'edge', slot: 1 });
    expect(patchEditorFor('zone:kick:center')).toEqual({ kind: 'zone', drumId: 'kick', zone: 'center', slot: 0 });
  });

  it('decodes a drum node', () => {
    expect(patchEditorFor('drum:tom1')).toEqual({ kind: 'drum', drumId: 'tom1' });
  });

  it('decodes a hoop node to a 1-based core hoop (topology id + HoopRef both 1-based, A1)', () => {
    expect(patchEditorFor('hoop:snare:1')).toEqual({ kind: 'hoop', drumId: 'snare', hoop: 1 });
    expect(patchEditorFor('hoop:snare:4')).toEqual({ kind: 'hoop', drumId: 'snare', hoop: 4 });
  });

  it('decodes an output node carrying its OutputConfig id', () => {
    expect(patchEditorFor('output:2')).toEqual({ kind: 'output', outputId: '2' });
    expect(patchEditorFor('output:new-3')).toEqual({ kind: 'output', outputId: 'new-3' });
  });

  it('falls back to unknown for unrecognised ids', () => {
    expect(patchEditorFor('wat')).toEqual({ kind: 'unknown', id: 'wat' });
    expect(patchEditorFor('zone:onlyone')).toEqual({ kind: 'unknown', id: 'zone:onlyone' });
  });
});

describe('zoneSlot', () => {
  it('maps the canonical zone order to 0-based slots', () => {
    expect(zoneSlot('center')).toBe(0);
    expect(zoneSlot('edge')).toBe(1);
    expect(zoneSlot('rim')).toBe(2);
    expect(zoneSlot('shell')).toBe(3);
  });
  it('falls back to slot 0 for an unknown zone', () => {
    expect(zoneSlot('mystery')).toBe(0);
  });
});

const kit = (drumOverrides: Partial<KitConfig['drums'][number]> = {}): KitConfig => ({
  version: 1,
  units: 'mm',
  global: { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 304, mirror: 'none', expanded: false },
  drums: [
    {
      id: 'kick',
      label: 'Kick',
      color: '#fff',
      diameterIn: 22,
      hoopSpacingMm: 50,
      localSpinDeg: 0,
      startAngleDeg: 0,
      origin: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      ...drumOverrides,
    },
  ],
  outputs: [],
});

describe('pixelsPerHoopForDrum', () => {
  it('returns the literal override verbatim, ignoring density', () => {
    const k = kit({ pixelsPerHoop: 37, ledDensityPxPerM: 200 });
    expect(pixelsPerHoopForDrum(k.drums[0]!, k)).toBe(37);
  });

  it('derives from density × circumference (matching core) when no override', () => {
    const k = kit({ diameterIn: 22 });
    // π × (22 × 25.4 / 1000) m × 60 px/m ≈ 105.3 → round 105
    const circM = (Math.PI * 22 * 25.4) / 1000;
    expect(pixelsPerHoopForDrum(k.drums[0]!, k)).toBe(Math.max(1, Math.round(circM * 60)));
  });

  it('honours a per-drum density override', () => {
    const k = kit({ ledDensityPxPerM: 30 });
    const circM = (Math.PI * 22 * 25.4) / 1000;
    expect(pixelsPerHoopForDrum(k.drums[0]!, k)).toBe(Math.max(1, Math.round(circM * 30)));
  });
});

// A → hoops 0,1 @ 50px ; B → hoop 0 @ 30px, all one output's flat chain.
const routing: PatchRouting = {
  outputs: [
    {
      id: '1',
      startUniverse: 0,
      channelsPerPixel: 3,
      hoops: [{ drumId: 'A', hoop: 0 }, { drumId: 'A', hoop: 1 }, { drumId: 'B', hoop: 0 }],
    },
  ],
};
const px = (h: { drumId: string }): number => (h.drumId === 'A' ? 50 : 30);

describe('hoopPixelSpan', () => {
  it('returns the global span of a hoop in transmit order', () => {
    expect(hoopPixelSpan(routing, { drumId: 'A', hoop: 0 }, px)).toEqual({ first: 0, last: 49 });
    expect(hoopPixelSpan(routing, { drumId: 'A', hoop: 1 }, px)).toEqual({ first: 50, last: 99 });
    expect(hoopPixelSpan(routing, { drumId: 'B', hoop: 0 }, px)).toEqual({ first: 100, last: 129 });
  });

  it('returns null for a hoop wired into no output', () => {
    expect(hoopPixelSpan(routing, { drumId: 'Z', hoop: 0 }, px)).toBeNull();
  });
});

describe('input-map zone editing', () => {
  const base: InputMap = { midiChannel: null,
    globalControls: {}, zones: [], midiNotes: [{ note: 36, drumId: 'kick', slot: 0 }], oscMap: [], volumeOscAddress: '/vol' };

  it('reads the note / address for a (drumId, slot)', () => {
    expect(zoneMidiNote(base, 'kick', 0)).toBe(36);
    expect(zoneMidiNote(base, 'kick', 1)).toBeNull();
    expect(zoneOscAddress(base, 'kick', 0)).toBeNull();
  });

  it('sets a note immutably and preserves siblings', () => {
    const next = setZoneMidiNote(base, 'snare', 2, 40);
    expect(next.midiNotes).toContainEqual({ note: 40, drumId: 'snare', slot: 2 });
    expect(next.midiNotes).toContainEqual({ note: 36, drumId: 'kick', slot: 0 });
    expect(next.volumeOscAddress).toBe('/vol');
    expect(base.midiNotes).toHaveLength(1); // input untouched
  });

  it('replaces an existing note rather than duplicating it', () => {
    const next = setZoneMidiNote(base, 'kick', 0, 38);
    expect(next.midiNotes.filter((n) => n.drumId === 'kick' && n.slot === 0)).toEqual([
      { note: 38, drumId: 'kick', slot: 0 },
    ]);
  });

  it('clears a note when passed null', () => {
    const next = setZoneMidiNote(base, 'kick', 0, null);
    expect(zoneMidiNote(next, 'kick', 0)).toBeNull();
  });

  it('sets / trims / clears an OSC address', () => {
    const set = setZoneOscAddress(base, 'kick', 0, '  /snare/edge  ');
    expect(zoneOscAddress(set, 'kick', 0)).toBe('/snare/edge');
    const cleared = setZoneOscAddress(set, 'kick', 0, '   ');
    expect(zoneOscAddress(cleared, 'kick', 0)).toBeNull();
  });
});

describe('perHoopPixelCount', () => {
  it('reads the first-class hoops[] count (B4), 1-based', () => {
    const k = kit({ hoops: [{ pixelCount: 10, reverse: false }, { pixelCount: 20, reverse: false }] });
    expect(perHoopPixelCount(k.drums[0]!, k, 1)).toBe(10);
    expect(perHoopPixelCount(k.drums[0]!, k, 2)).toBe(20);
  });

  it('falls back to the drum uniform count when hoops[] is absent', () => {
    const k = kit({ pixelsPerHoop: 42 });
    expect(perHoopPixelCount(k.drums[0]!, k, 1)).toBe(42);
    expect(perHoopPixelCount(k.drums[0]!, k, 3)).toBe(42);
  });

  it('falls back to the uniform count for an out-of-range hoop index', () => {
    const k = kit({ pixelsPerHoop: 42, hoops: [{ pixelCount: 10, reverse: false }] });
    expect(perHoopPixelCount(k.drums[0]!, k, 5)).toBe(42);
  });
});

describe('totalKitPixelCount', () => {
  it('sums mixed per-hoop counts from hoops[] (its length is the hoop count)', () => {
    const k = kit({ hoops: [{ pixelCount: 10, reverse: false }, { pixelCount: 20, reverse: false }, { pixelCount: 5, reverse: false }] });
    expect(totalKitPixelCount(k)).toBe(35);
  });

  it('uses the global hoop count × uniform when no hoops[] / hoopCount override', () => {
    const k = kit({ pixelsPerHoop: 25 }); // global hoopCount = 4
    expect(totalKitPixelCount(k)).toBe(100);
  });

  it('honours a per-drum hoopCount override (no hoops[])', () => {
    const k = kit({ pixelsPerHoop: 25, hoopCount: 2 });
    expect(totalKitPixelCount(k)).toBe(50);
  });
});

describe('physicalPortLine', () => {
  it('maps expanded logical outputs onto 4 ports × 2 lines (0-based index in)', () => {
    expect(physicalPortLine(0, true)).toEqual({ port: 1, line: 1 });
    expect(physicalPortLine(1, true)).toEqual({ port: 1, line: 2 });
    expect(physicalPortLine(2, true)).toEqual({ port: 2, line: 1 });
    expect(physicalPortLine(7, true)).toEqual({ port: 4, line: 2 });
  });

  it('maps each logical output to its own port on line 1 in normal mode', () => {
    expect(physicalPortLine(0, false)).toEqual({ port: 1, line: 1 });
    expect(physicalPortLine(3, false)).toEqual({ port: 4, line: 1 });
  });
});

describe('buildPixelOutputTable', () => {
  const pxForHoop = (h: HoopRef): number => (h.drumId === 'A' ? 50 : 30);

  it('walks outputs in transmit order with a dense channel cursor, snapping on startUniverse', () => {
    const r: PatchRouting = {
      outputs: [
        { id: 'o1', channelsPerPixel: 3, hoops: [{ drumId: 'A', hoop: 1 }, { drumId: 'A', hoop: 2 }] }, // 100px → 300ch
        { id: 'o2', channelsPerPixel: 3, hoops: [{ drumId: 'B', hoop: 1 }] }, // 30px, dense from ch300
        { id: 'o3', channelsPerPixel: 3, hoops: [] }, // unwired
        { id: 'o4', startUniverse: 2, channelsPerPixel: 3, hoops: [{ drumId: 'A', hoop: 1 }] }, // snaps to ch1024
      ],
    };
    expect(buildPixelOutputTable(r, kit(), pxForHoop)).toEqual([
      { outputId: 'o1', index: 0, startUniverse: 0, startChannel: 0, pixelCount: 100 },
      { outputId: 'o2', index: 1, startUniverse: 0, startChannel: 300, pixelCount: 30 },
      { outputId: 'o3', index: 2, startUniverse: null, startChannel: 390, pixelCount: 0 },
      { outputId: 'o4', index: 3, startUniverse: 2, startChannel: 1024, pixelCount: 50 },
    ]);
  });

  it('reports the universe a run crosses into once its start channel passes 512', () => {
    const r: PatchRouting = {
      outputs: [
        { id: 'big', channelsPerPixel: 3, hoops: [{ drumId: 'A', hoop: 1 }, { drumId: 'A', hoop: 2 }, { drumId: 'A', hoop: 3 }, { drumId: 'A', hoop: 4 }] }, // 200px → 600ch
        { id: 'next', channelsPerPixel: 3, hoops: [{ drumId: 'B', hoop: 1 }] }, // dense from ch600 → universe 1
      ],
    };
    const rows = buildPixelOutputTable(r, kit(), pxForHoop);
    expect(rows[1]).toEqual({ outputId: 'next', index: 1, startUniverse: 1, startChannel: 600, pixelCount: 30 });
  });
});

describe('boundTriggerFor', () => {
  const drumGraph = (drumId: string, zone: string): voice.TriggerGraph => ({
    nodes: [makeNode('trigger', 'trigger', 0, 0, { source: { kind: 'drum', drumId, zone } })],
    edges: [],
  });
  const midiGraph = (): voice.TriggerGraph => ({
    nodes: [makeNode('trigger', 'trigger', 0, 0, { source: { kind: 'midi', note: 60 } })],
    edges: [],
  });

  it('finds the first graph bound to the drum by identity, labelled drumId:zone', () => {
    const graphs = { 'graph-1': midiGraph(), 'kick:center': drumGraph('kick', 'center') };
    expect(boundTriggerFor('kick', graphs)).toEqual({ graphKey: 'kick:center', label: 'kick:center' });
  });

  it('returns null when no graph carries a matching drum source', () => {
    expect(boundTriggerFor('snare', { 'graph-1': midiGraph(), 'kick:center': drumGraph('kick', 'center') })).toBeNull();
  });
});

describe('nextZoneSlot', () => {
  const empty: InputMap = { midiChannel: null, globalControls: {}, zones: [], midiNotes: [], oscMap: [] };

  it('hands out the lowest free slot on the drum', () => {
    expect(nextZoneSlot(empty, 'kick')).toBe(0);
    expect(nextZoneSlot(addDeclaredZone(empty, 'kick', 0), 'kick')).toBe(1);
  });

  it('reuses a removed zone slot instead of drifting upward', () => {
    let m = addDeclaredZone(addDeclaredZone(empty, 'kick', 0), 'kick', 1);
    m = removeZone(m, 'kick', 0);
    expect(nextZoneSlot(m, 'kick')).toBe(0);
  });

  it('counts bound-but-undeclared slots, and only this drum', () => {
    const m: InputMap = {
      midiChannel: null,
      globalControls: {},
      zones: [],
      midiNotes: [{ note: 36, drumId: 'kick', slot: 0 }],
      oscMap: [{ address: '/s', drumId: 'snare', slot: 1 }],
    };
    expect(nextZoneSlot(m, 'kick')).toBe(1);
    expect(nextZoneSlot(m, 'snare')).toBe(0);
  });

  it('keeps going past the old 8-slot cap — a drum may have as many zones as it needs', () => {
    let m: InputMap = { midiChannel: null, globalControls: {}, zones: [], midiNotes: [], oscMap: [] };
    for (let i = 0; i < 12; i++) m = addDeclaredZone(m, 'kick', nextZoneSlot(m, 'kick'));
    expect(zoneSlotsForDrum(m, 'kick')).toHaveLength(12);
    expect(nextZoneSlot(m, 'kick')).toBe(12);
  });
});

describe('zone names', () => {
  const empty: InputMap = { midiChannel: null, globalControls: {}, zones: [], midiNotes: [], oscMap: [] };

  it('falls back to the slot default name until the zone is renamed', () => {
    expect(zoneLabel(empty, 'kick', 0)).toBe('center');
    expect(zoneLabel(empty, 'kick', 11)).toBe('Zone 12'); // past the classic slot names
  });

  it('setZoneLabel stores a free-text name', () => {
    const m = setZoneLabel(addDeclaredZone(empty, 'kick', 0), 'kick', 0, '  Beater  ');
    expect(zoneLabel(m, 'kick', 0)).toBe('Beater');
  });

  it('names a bound-but-undeclared zone by declaring it, so the name persists', () => {
    const bound = setZoneMidiNote(empty, 'kick', 3, 42);
    const named = setZoneLabel(bound, 'kick', 3, 'Rim click');
    expect(named.zones).toEqual([{ drumId: 'kick', slot: 3, label: 'Rim click' }]);
    expect(zoneMidiNote(named, 'kick', 3)).toBe(42);
  });

  it('an emptied name reverts to the default rather than showing blank', () => {
    const m = setZoneLabel(setZoneLabel(empty, 'kick', 1, 'Edge hit'), 'kick', 1, '   ');
    expect(zoneLabel(m, 'kick', 1)).toBe('edge');
  });

  it('names are display only — two zones may share one, and identity stays the slot', () => {
    let m = setZoneLabel(addDeclaredZone(empty, 'kick', 0), 'kick', 0, 'Hit');
    m = setZoneLabel(addDeclaredZone(m, 'kick', 1), 'kick', 1, 'Hit');
    expect(zoneSlotsForDrum(m, 'kick')).toEqual([0, 1]);
  });
});

describe('declared zones (add / remove / relabel + effective set)', () => {
  const empty: InputMap = { midiChannel: null,
    globalControls: {}, zones: [], midiNotes: [], oscMap: [] };

  it('addDeclaredZone persists a slot with no binding (idempotent)', () => {
    const m = addDeclaredZone(empty, 'kick', 2);
    expect(m.zones).toEqual([{ drumId: 'kick', slot: 2, label: '' }]);
    expect(addDeclaredZone(m, 'kick', 2)).toBe(m); // no-op when already declared
    expect(zoneSlotsForDrum(m, 'kick')).toEqual([2]);
  });

  it('zoneSlotsForDrum unions declared + bound slots, deduped and sorted', () => {
    const m: InputMap = {
      midiChannel: null,
    globalControls: {},
      zones: [{ drumId: 'kick', slot: 5, label: '' }],
      midiNotes: [{ note: 36, drumId: 'kick', slot: 0 }],
      oscMap: [{ address: '/k', drumId: 'kick', slot: 0 }, { address: '/x', drumId: 'snare', slot: 1 }],
    };
    expect(zoneSlotsForDrum(m, 'kick')).toEqual([0, 5]); // slot 0 counted once; snare excluded
  });

  it('removeZone drops the declaration AND every binding for the slot', () => {
    const m: InputMap = {
      midiChannel: null,
    globalControls: {},
      zones: [{ drumId: 'kick', slot: 1, label: '' }],
      midiNotes: [{ note: 36, drumId: 'kick', slot: 1 }],
      oscMap: [{ address: '/k', drumId: 'kick', slot: 1 }],
    };
    const out = removeZone(m, 'kick', 1);
    expect(zoneSlotsForDrum(out, 'kick')).toEqual([]);
    expect(out.midiNotes).toEqual([]);
    expect(out.oscMap).toEqual([]);
  });

  it("removing a zone leaves its neighbours' bindings alone", () => {
    let m = setZoneMidiNote(addDeclaredZone(addDeclaredZone(empty, 'kick', 0), 'kick', 1), 'kick', 0, 42);
    m = setZoneMidiNote(m, 'kick', 1, 44);
    const out = removeZone(m, 'kick', 0);
    expect(zoneSlotsForDrum(out, 'kick')).toEqual([1]);
    expect(zoneMidiNote(out, 'kick', 1)).toBe(44);
  });

});
