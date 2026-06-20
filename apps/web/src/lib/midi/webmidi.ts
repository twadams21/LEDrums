// WebMIDI capture (R6). Enumerates inputs and forwards note-on/off as a callback.
// Feature-detects a missing API and degrades gracefully (no throw, surfaced flag).

export interface MidiNoteEvent {
  note: number;
  /** 0..127. note-off and zero-velocity note-on both report velocity 0. */
  velocity: number;
  on: boolean;
}

export type MidiNoteHandler = (ev: MidiNoteEvent) => void;

export interface MidiInitResult {
  available: boolean;
  /** Names of the enumerated MIDI inputs (empty when unavailable). */
  inputs: string[];
  /** Detail when unavailable (e.g. 'no-api' or an access error message). */
  reason?: string;
  /** Stop listening and release the access handle. */
  stop(): void;
}

// Minimal structural types so this module is testable without DOM MIDI lib types.
interface MidiMessageEventLike {
  data: Uint8Array | number[] | null;
}
interface MidiInputLike {
  name?: string | null;
  onmidimessage: ((ev: MidiMessageEventLike) => void) | null;
}
interface MidiAccessLike {
  inputs: Map<string, MidiInputLike> | { values(): Iterable<MidiInputLike> };
  onstatechange?: ((ev: unknown) => void) | null;
}
interface MidiNavigatorLike {
  requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<MidiAccessLike>;
}

function inputValues(access: MidiAccessLike): MidiInputLike[] {
  const inputs = access.inputs as { values(): Iterable<MidiInputLike> };
  return [...inputs.values()];
}

/** Parse a raw MIDI status+data triple into a note event, or null if not a note. */
export function parseMidiMessage(data: Uint8Array | number[] | null): MidiNoteEvent | null {
  if (!data || data.length < 3) return null;
  const status = data[0]! & 0xf0;
  const note = data[1]!;
  const velocity = data[2]!;
  if (status === 0x90 /* note-on */) {
    // A note-on with velocity 0 is a conventional note-off.
    return { note, velocity, on: velocity > 0 };
  }
  if (status === 0x80 /* note-off */) {
    return { note, velocity: 0, on: false };
  }
  return null;
}

/**
 * Request MIDI access and forward note events to `handler`.
 * `nav` is injectable for testing; defaults to the global navigator.
 */
export async function initMidi(
  handler: MidiNoteHandler,
  nav?: MidiNavigatorLike,
): Promise<MidiInitResult> {
  const navigator_ =
    nav ?? (typeof navigator !== 'undefined' ? (navigator as unknown as MidiNavigatorLike) : undefined);

  const noop: MidiInitResult = { available: false, inputs: [], reason: 'no-api', stop: () => {} };

  if (!navigator_ || typeof navigator_.requestMIDIAccess !== 'function') {
    return noop;
  }

  let access: MidiAccessLike;
  try {
    access = await navigator_.requestMIDIAccess({ sysex: false });
  } catch (err) {
    return {
      available: false,
      inputs: [],
      reason: err instanceof Error ? err.message : 'access-denied',
      stop: () => {},
    };
  }

  const bound = new Set<MidiInputLike>();
  const bind = (): void => {
    for (const input of inputValues(access)) {
      if (bound.has(input)) continue;
      bound.add(input);
      input.onmidimessage = (ev) => {
        const parsed = parseMidiMessage(ev.data);
        if (parsed) handler(parsed);
      };
    }
  };
  bind();
  // Re-bind when devices are hot-plugged.
  access.onstatechange = () => bind();

  return {
    available: true,
    inputs: inputValues(access).map((i) => i.name ?? 'MIDI Input'),
    stop: () => {
      for (const input of bound) input.onmidimessage = null;
      access.onstatechange = null;
      bound.clear();
    },
  };
}
