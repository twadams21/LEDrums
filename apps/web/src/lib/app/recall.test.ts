import { describe, expect, it } from 'vitest';
import { isReservedCc, midiForSection, midiForSong, oscForSection, RESERVED_CC } from './recall';

describe('recall strings', () => {
  it('formats the OSC section-recall message (address + section arg)', () => {
    expect(oscForSection(0, 0)).toBe('/ledrums/song_0/section 0');
    expect(oscForSection(2, 3)).toBe('/ledrums/song_2/section 3');
  });

  it('the OSC address (without the arg) matches the server recall convention', () => {
    // The server parses `/ledrums/song_<n>/section`; the helper appends the section arg.
    const [address] = oscForSection(1, 4).split(' ');
    expect(address).toBe('/ledrums/song_1/section');
  });

  it('formats the MIDI Program Change message for a song', () => {
    expect(midiForSong(0)).toBe('Program Change 0');
    expect(midiForSong(5)).toBe('Program Change 5');
  });

  it('formats the MIDI CC#0 message for a section', () => {
    expect(midiForSection(0)).toBe('CC 0 value 0');
    expect(midiForSection(2)).toBe('CC 0 value 2');
  });
});

describe('reserved controller', () => {
  it('reserves controller 0 for section recall', () => {
    expect(RESERVED_CC).toBe(0);
    expect(isReservedCc(0)).toBe(true);
    expect(isReservedCc(1)).toBe(false);
    expect(isReservedCc(64)).toBe(false);
  });
});
