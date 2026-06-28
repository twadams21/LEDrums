// WebMIDI capture (R6). Enumerates inputs and forwards note-on/off as a callback.
// Feature-detects a missing API and degrades gracefully (no throw, surfaced flag).

export interface MidiNoteEvent {
  note: number;
  /** 0..127. note-off and zero-velocity note-on both report velocity 0. */
  velocity: number;
  on: boolean;
}

export interface MidiCcEvent {
  /** Controller number 0..127. Controller 0 is reserved for global section recall. */
  controller: number;
  /** Controller value 0..127. */
  value: number;
}

export interface MidiProgramChangeEvent {
  /** Program number 0..127 (selects the song at that setlist index). */
  value: number;
}

/**
 * A parsed MIDI message the engine cares about — a discriminated union so the
 * forwarder can route each shape to its own WS message. `note` covers note-on/off,
 * `cc` a Control Change (0xB0), `programChange` a Program Change (0xC0).
 */
export type MidiEvent =
  | ({ kind: 'note' } & MidiNoteEvent)
  | ({ kind: 'cc' } & MidiCcEvent)
  | ({ kind: 'programChange' } & MidiProgramChangeEvent);

export type MidiEventHandler = (ev: MidiEvent) => void;

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

/**
 * Parse a raw MIDI message into the engine event it represents, or null if it's a
 * status we don't forward. Handles note-on/off (0x90/0x80), Control Change (0xB0) and
 * Program Change (0xC0). The channel nibble is masked off — channel lives on the patch
 * device, not here. Program Change is a 2-byte message; everything else needs 3.
 */
export function parseMidiMessage(data: Uint8Array | number[] | null): MidiEvent | null {
  if (!data || data.length < 2) return null;
  const status = data[0]! & 0xf0;
  // Program Change: status + program (2 bytes). Selects a song by setlist index.
  if (status === 0xc0 /* program change */) {
    return { kind: 'programChange', value: data[1]! };
  }
  if (data.length < 3) return null;
  if (status === 0x90 /* note-on */) {
    // A note-on with velocity 0 is a conventional note-off.
    const velocity = data[2]!;
    return { kind: 'note', note: data[1]!, velocity, on: velocity > 0 };
  }
  if (status === 0x80 /* note-off */) {
    return { kind: 'note', note: data[1]!, velocity: 0, on: false };
  }
  if (status === 0xb0 /* control change */) {
    return { kind: 'cc', controller: data[1]!, value: data[2]! };
  }
  return null;
}

/**
 * Request MIDI access and forward parsed events (note / cc / program-change) to
 * `handler`. `nav` is injectable for testing; defaults to the global navigator.
 */
export async function initMidi(
  handler: MidiEventHandler,
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
