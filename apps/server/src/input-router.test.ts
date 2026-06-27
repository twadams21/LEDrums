import { describe, expect, it } from 'vitest';
import { Engine, SLOT_LABELS, defaultProject, voice } from '@ledrums/core';
import {
  applyClientMessage,
  midiToEvent,
  oscRecall,
  oscToEvent,
  parseSectionRecallAddress,
  programChangeRecall,
  sectionIndexRecall,
  zoneForNote,
  zoneForOsc,
} from './input-router';

describe('input-router', () => {
  it('normalizes MIDI velocity and distinguishes note on/off', () => {
    expect(midiToEvent(38, 127, true, 5)).toEqual({ kind: 'noteOn', note: 38, velocity: 1, timeMs: 5 });
    expect(midiToEvent(38, 0, true, 5)).toEqual({ kind: 'noteOff', note: 38, timeMs: 5 });
    expect(midiToEvent(38, 100, false, 5)).toEqual({ kind: 'noteOff', note: 38, timeMs: 5 });
  });

  it('extracts the first numeric arg from an OSC event', () => {
    expect(oscToEvent({ address: '/p', args: ['x', 0.7] }, 0)).toEqual({ kind: 'osc', address: '/p', value: 0.7, timeMs: 0 });
  });

  it('routes a mapped MIDI note through the engine to activate its trigger clip', () => {
    const e = new Engine(defaultProject());
    e.setActiveClip('trigger', 'whole-drum');
    const r = applyClientMessage(e, { t: 'midi', note: 38, velocity: 100, on: true }, 0);
    e.tick(16);
    expect(r.structural).toBe(false);
    expect(r.monitor?.kind).toBe('midi');
    expect(e.getProject().composition.layers.find((l) => l.id === 'trigger')!.activeClipId).toBe('chase');
  });

  it('applies setParam without a structural change', () => {
    const e = new Engine(defaultProject());
    const r = applyClientMessage(e, { t: 'setParam', layerId: 'base', clipId: 'base-swirl', key: 'hue', value: 99 }, 0);
    expect(r.structural).toBe(false);
    expect(e.getProject().composition.layers[0]!.clips[0]!.params.hue).toBe(99);
  });

  it('ignores an unmapped MIDI note without throwing', () => {
    const e = new Engine(defaultProject());
    expect(() => applyClientMessage(e, { t: 'midi', note: 7, velocity: 100, on: true }, 0)).not.toThrow();
    e.tick(16);
  });

  it('marks structural changes for layer/transport edits', () => {
    const e = new Engine(defaultProject());
    expect(applyClientMessage(e, { t: 'setLayer', layerId: 'base', opacity: 0.5 }, 0).structural).toBe(true);
    expect(applyClientMessage(e, { t: 'setTransport', bpm: 140 }, 0).structural).toBe(true);
  });
});

describe('zone-map resolution (PINNED precedence step 1)', () => {
  // defaultProject maps note 36 → kick/slot 0 and OSC /sp/kick → kick/slot 0; slot 0 is
  // the 'center' zone. A match fires the pad-bound graph (caller stops); a miss returns
  // null so the caller forwards the raw input for a DIRECT trigger-source binding.
  it('resolves a mapped MIDI note to its (drumId, zone) pad', () => {
    const { inputMap } = defaultProject();
    expect(zoneForNote(inputMap, 36)).toEqual({ drumId: 'kick', zone: SLOT_LABELS[0] });
    expect(zoneForNote(inputMap, 38)).toEqual({ drumId: 'snare', zone: SLOT_LABELS[0] });
  });

  it('returns null for an unmapped MIDI note (forward raw for direct binding)', () => {
    expect(zoneForNote(defaultProject().inputMap, 7)).toBeNull();
  });

  it('resolves a mapped OSC address to its pad, null otherwise', () => {
    const { inputMap } = defaultProject();
    expect(zoneForOsc(inputMap, '/sp/kick')).toEqual({ drumId: 'kick', zone: SLOT_LABELS[0] });
    expect(zoneForOsc(inputMap, '/nope')).toBeNull();
  });
});

describe('global transport recall (STEP 0 — index → song/section ids)', () => {
  // Two-song setlist: songA[s0,s1,s2], songB[s0,s1].
  const show: voice.Show = {
    ...voice.emptyShow(),
    songs: [
      {
        id: 'songA',
        name: 'A',
        sections: [
          { id: 'a0', name: 'A0', slots: {} },
          { id: 'a1', name: 'A1', slots: {} },
          { id: 'a2', name: 'A2', slots: {} },
        ],
      },
      {
        id: 'songB',
        name: 'B',
        sections: [
          { id: 'b0', name: 'B0', slots: {} },
          { id: 'b1', name: 'B1', slots: {} },
        ],
      },
    ],
  };

  it('Program Change selects a song by index + recalls its FIRST section', () => {
    expect(programChangeRecall(show, 0)).toEqual({ songId: 'songA', sectionId: 'a0' });
    expect(programChangeRecall(show, 1)).toEqual({ songId: 'songB', sectionId: 'b0' });
  });

  it('Program Change out of range is a no-op (null)', () => {
    expect(programChangeRecall(show, 2)).toBeNull();
    expect(programChangeRecall(show, -1)).toBeNull();
    expect(programChangeRecall(null, 0)).toBeNull();
    expect(programChangeRecall({ ...voice.emptyShow() }, 0)).toBeNull(); // no songs
  });

  it('CC#0 value recalls a section by index in the ACTIVE song', () => {
    expect(sectionIndexRecall(show, 'songB', 1)).toEqual({ songId: 'songB', sectionId: 'b1' });
    expect(sectionIndexRecall(show, 'songA', 2)).toEqual({ songId: 'songA', sectionId: 'a2' });
  });

  it('CC#0 falls back to the first song when no active song is set', () => {
    expect(sectionIndexRecall(show, null, 1)).toEqual({ songId: 'songA', sectionId: 'a1' });
  });

  it('CC#0 out of range / empty setlist is a no-op (null)', () => {
    expect(sectionIndexRecall(show, 'songB', 2)).toBeNull(); // songB has only 2 sections
    expect(sectionIndexRecall(show, 'songA', 9)).toBeNull();
    expect(sectionIndexRecall(null, 'songA', 0)).toBeNull();
  });

  it('parses a section-recall OSC address (and rejects others)', () => {
    expect(parseSectionRecallAddress('/ledrums/song_0/section')).toBe(0);
    expect(parseSectionRecallAddress('/ledrums/song_12/section')).toBe(12);
    expect(parseSectionRecallAddress('/ledrums/song_0/section/extra')).toBeNull();
    expect(parseSectionRecallAddress('/sp/kick')).toBeNull();
  });

  it('OSC recall maps song index (address) + section index (value) → ids', () => {
    expect(oscRecall(show, '/ledrums/song_1/section', 1)).toEqual({ songId: 'songB', sectionId: 'b1' });
    expect(oscRecall(show, '/ledrums/song_0/section', 2.0)).toEqual({ songId: 'songA', sectionId: 'a2' });
    // value is floored to an integer index.
    expect(oscRecall(show, '/ledrums/song_0/section', 1.9)).toEqual({ songId: 'songA', sectionId: 'a1' });
  });

  it('OSC recall is null for non-recall addresses or out-of-range indices (falls through)', () => {
    expect(oscRecall(show, '/sp/kick', 0)).toBeNull();
    expect(oscRecall(show, '/ledrums/song_5/section', 0)).toBeNull(); // no song 5
    expect(oscRecall(show, '/ledrums/song_1/section', 5)).toBeNull(); // songB has no section 5
  });
});
