import { describe, expect, it } from 'vitest';
import type { InputMap, KitConfig } from '@ledrums/core';
import type { PatchRouting } from '../patch-routing';
import {
  hoopPixelSpan,
  orderedDataLines,
  patchEditorFor,
  pixelsPerHoopForDrum,
  setZoneMidiNote,
  setZoneOscAddress,
  zoneMidiNote,
  zoneOscAddress,
  zoneSlot,
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

  it('decodes a hoop node to a 0-based core hoop (topology id is 1-based)', () => {
    expect(patchEditorFor('hoop:snare:1')).toEqual({ kind: 'hoop', drumId: 'snare', hoop: 0 });
    expect(patchEditorFor('hoop:snare:4')).toEqual({ kind: 'hoop', drumId: 'snare', hoop: 3 });
  });

  it('decodes an output node carrying its OutputConfig id', () => {
    expect(patchEditorFor('output:2')).toEqual({ kind: 'output', outputId: '2' });
    expect(patchEditorFor('output:new-3')).toEqual({ kind: 'output', outputId: 'new-3' });
  });

  it('decodes a data line to a 1-based transmit position, null when opaque', () => {
    expect(patchEditorFor('dataline:3')).toEqual({ kind: 'dataline', index: 3 });
    expect(patchEditorFor('dataline:new-1')).toEqual({ kind: 'dataline', index: null });
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
  global: { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 304 },
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
      effectOriginLocal: { x: 0, y: 0, z: 0 },
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

// A → hoops 0,1 @ 50px ; B → hoop 0 @ 30px, all on one output, two datalines.
const routing: PatchRouting = {
  outputs: [
    {
      id: '1',
      startUniverse: 0,
      channelsPerPixel: 3,
      dataLines: [
        { id: '1:dl0', hoops: [{ drumId: 'A', hoop: 0 }, { drumId: 'A', hoop: 1 }] },
        { id: '1:dl1', hoops: [{ drumId: 'B', hoop: 0 }] },
      ],
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

describe('orderedDataLines', () => {
  it('flattens datalines across outputs in transmit order with 1-based positions', () => {
    const ordered = orderedDataLines(routing);
    expect(ordered.map((o) => o.pos)).toEqual([1, 2]);
    expect(ordered.map((o) => o.line.id)).toEqual(['1:dl0', '1:dl1']);
    expect(ordered.every((o) => o.output.id === '1')).toBe(true);
  });
});

describe('input-map zone editing', () => {
  const base: InputMap = { midiNotes: [{ note: 36, drumId: 'kick', slot: 0 }], oscMap: [], volumeOscAddress: '/vol' };

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
