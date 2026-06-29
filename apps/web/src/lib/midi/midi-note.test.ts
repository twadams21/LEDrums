import { describe, expect, it } from 'vitest';
import { formatMidiNote, midiChannelOptions, parseMidiNote } from './midi-note';

describe('midi note helpers', () => {
  it('formats MIDI notes using C-1 octave numbering', () => {
    expect(formatMidiNote(0)).toBe('C-1');
    expect(formatMidiNote(60)).toBe('C4');
    expect(formatMidiNote(69)).toBe('A4');
    expect(formatMidiNote(127)).toBe('G9');
  });

  it('parses note names and numeric note values', () => {
    expect(parseMidiNote('C-1')).toBe(0);
    expect(parseMidiNote('A4')).toBe(69);
    expect(parseMidiNote('C#4')).toBe(61);
    expect(parseMidiNote('Db4')).toBe(61);
    expect(parseMidiNote('38')).toBe(38);
  });

  it('rejects invalid or out-of-range notes', () => {
    expect(parseMidiNote('')).toBeNull();
    expect(parseMidiNote('H4')).toBeNull();
    expect(parseMidiNote('C-2')).toBeNull();
    expect(parseMidiNote('128')).toBeNull();
  });

  it('builds app MIDI channel options', () => {
    const opts = midiChannelOptions();
    expect(opts[0]).toEqual({ value: 'all', label: 'All channels' });
    expect(opts.at(-1)).toEqual({ value: '16', label: 'Channel 16' });
    expect(opts).toHaveLength(17);
  });
});
