const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

export function formatMidiNote(note: number): string {
  const n = Math.trunc(note);
  const name = NOTE_NAMES[((n % 12) + 12) % 12]!;
  const octave = Math.floor(n / 12) - 1;
  return `${name}${octave}`;
}

export function parseMidiNote(input: string): number | null {
  const text = input.trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return n >= 0 && n <= 127 ? n : null;
  }

  const m = /^([A-Ga-g])([#bB]?)(-?\d+)$/.exec(text);
  if (!m) return null;
  const pitch = `${m[1]!.toUpperCase()}${m[2] ? m[2]!.toUpperCase() : ''}`;
  const semitone = NOTE_TO_SEMITONE[pitch];
  const octave = Number(m[3]);
  if (semitone === undefined || !Number.isInteger(octave)) return null;
  const note = (octave + 1) * 12 + semitone;
  return note >= 0 && note <= 127 ? note : null;
}

export function midiChannelOptions(): Array<{ value: string; label: string }> {
  return [
    { value: 'all', label: 'All channels' },
    ...Array.from({ length: 16 }, (_, i) => {
      const channel = i + 1;
      return { value: String(channel), label: `Channel ${channel}` };
    }),
  ];
}
