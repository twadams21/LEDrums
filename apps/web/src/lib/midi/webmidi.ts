// WebMIDI capture (R6). Enumerates inputs and forwards note-on/off as a callback.
// Feature-detects a missing API and degrades gracefully (no throw, surfaced flag).

export interface MidiNoteEvent {
  note: number;
  /** 0..127. note-off and zero-velocity note-on both report velocity 0. */
  velocity: number;
  on: boolean;
  /** 1..16 MIDI channel. */
  channel: number;
}

export interface MidiCcEvent {
  /** Controller number 0..127. Controller 0 is reserved for global section recall. */
  controller: number;
  /** Controller value 0..127. */
  value: number;
  /** 1..16 MIDI channel. */
  channel: number;
}

export interface MidiProgramChangeEvent {
  /** Program number 0..127 (selects the song at that setlist index). */
  value: number;
  /** 1..16 MIDI channel. */
  channel: number;
}

/** MIDI beat clock: system real-time (0xF8 tick / 0xFA start / 0xFB continue / 0xFC stop) and
    the Song Position Pointer (0xF2). System messages carry no channel, so the app-wide channel
    filter never applies. `deviceId` is the WebMIDI port the message arrived on — the clock
    forwarder accepts ONE selected port so two clocks are never combined. */
export interface MidiClockEvent {
  command: 'tick' | 'start' | 'continue' | 'stop' | 'position';
  /** 14-bit song position in 16th notes, `position` only. */
  position?: number;
  /** Port id, set by {@link initMidi} (absent from a bare {@link parseMidiMessage} result). */
  deviceId?: string;
}

/**
 * A parsed MIDI message the engine cares about — a discriminated union so the
 * forwarder can route each shape to its own WS message. `note` covers note-on/off,
 * `cc` a Control Change (0xB0), `programChange` a Program Change (0xC0), `clock` the
 * system real-time beat clock + song position.
 */
export type MidiEvent =
  | ({ kind: 'note' } & MidiNoteEvent)
  | ({ kind: 'cc' } & MidiCcEvent)
  | ({ kind: 'programChange' } & MidiProgramChangeEvent)
  | ({ kind: 'clock' } & MidiClockEvent);

export type MidiEventHandler = (ev: MidiEvent) => void;

/** Live connection state of a MIDI port. A `disconnected` port is not removed from the
    access map (WebMIDI keeps it and flips its state) so the settings list can show it
    greyed rather than have it silently vanish on unplug. */
export type MidiDeviceState = 'connected' | 'disconnected';

/** A WebMIDI input port surfaced to the settings device list: identity + live state. */
export interface MidiDeviceInfo {
  /** Stable port id (WebMIDI `MIDIInput.id`); falls back to the access-map key when absent. */
  id: string;
  name: string;
  state: MidiDeviceState;
  /** Manufacturer string when the browser reports one. */
  manufacturer?: string;
}

/** Notified with the full device snapshot on init and again on every hot-plug
    (`statechange`), so the UI list refreshes without a reload. */
export type MidiDevicesHandler = (devices: MidiDeviceInfo[]) => void;

export interface MidiInitResult {
  available: boolean;
  /** Names of the enumerated MIDI inputs (empty when unavailable). */
  inputs: string[];
  /** Enumerated input devices with live connection state (empty when unavailable). */
  devices: MidiDeviceInfo[];
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
  id?: string;
  name?: string | null;
  manufacturer?: string | null;
  /** 'connected' | 'disconnected' per the WebMIDI spec. */
  state?: string | null;
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

/** [portId, input] pairs — the Map key is the WebMIDI port id; a plain `values()`-only
    handle (test fakes) falls back to a positional index. */
function inputEntries(access: MidiAccessLike): Array<[string, MidiInputLike]> {
  const inputs = access.inputs;
  if (inputs instanceof Map) return [...inputs.entries()];
  return [...(inputs as { values(): Iterable<MidiInputLike> }).values()].map(
    (input, idx) => [String(idx), input] as [string, MidiInputLike],
  );
}

/** Snapshot the input ports as {@link MidiDeviceInfo}. Pure over the access handle so the
    settings device list and its hot-plug refresh are unit-testable without real hardware. */
export function enumerateDevices(access: MidiAccessLike): MidiDeviceInfo[] {
  return inputEntries(access).map(([key, input]) => {
    const device: MidiDeviceInfo = {
      id: input.id ?? key,
      name: input.name ?? 'MIDI Input',
      state: input.state === 'disconnected' ? 'disconnected' : 'connected',
    };
    if (input.manufacturer) device.manufacturer = input.manufacturer;
    return device;
  });
}

/**
 * Parse a raw MIDI message into the engine event it represents, or null if it's a
 * status we don't forward. Handles note-on/off (0x90/0x80), Control Change (0xB0) and
 * Program Change (0xC0). The status low nibble is retained as a 1-based channel for the
 * app-wide MIDI filter. Program Change is a 2-byte message; everything else needs 3.
 */
export function parseMidiMessage(data: Uint8Array | number[] | null): MidiEvent | null {
  if (!data || data.length < 1) return null;
  const rawStatus = data[0]!;
  // System messages first — the beat clock is a single byte and has no channel, so it must be
  // recognised before the channel parse (and before the 2-byte minimum) can discard it.
  switch (rawStatus) {
    case 0xf8: return { kind: 'clock', command: 'tick' };
    case 0xfa: return { kind: 'clock', command: 'start' };
    case 0xfb: return { kind: 'clock', command: 'continue' };
    case 0xfc: return { kind: 'clock', command: 'stop' };
    case 0xf2: {
      if (data.length < 3) return null;
      return { kind: 'clock', command: 'position', position: (data[1]! & 0x7f) | ((data[2]! & 0x7f) << 7) };
    }
  }
  if (rawStatus >= 0xf0) return null; // sysex, MTC, song select, active sensing, reset: not forwarded
  if (data.length < 2) return null;
  const status = rawStatus & 0xf0;
  const channel = (rawStatus & 0x0f) + 1;
  // Program Change: status + program (2 bytes). Selects a song by setlist index.
  if (status === 0xc0 /* program change */) {
    return { kind: 'programChange', value: data[1]!, channel };
  }
  if (data.length < 3) return null;
  if (status === 0x90 /* note-on */) {
    // A note-on with velocity 0 is a conventional note-off.
    const velocity = data[2]!;
    return { kind: 'note', note: data[1]!, velocity, on: velocity > 0, channel };
  }
  if (status === 0x80 /* note-off */) {
    return { kind: 'note', note: data[1]!, velocity: 0, on: false, channel };
  }
  if (status === 0xb0 /* control change */) {
    return { kind: 'cc', controller: data[1]!, value: data[2]!, channel };
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
  onDevices?: MidiDevicesHandler,
): Promise<MidiInitResult> {
  const navigator_ =
    nav ?? (typeof navigator !== 'undefined' ? (navigator as unknown as MidiNavigatorLike) : undefined);

  const noop: MidiInitResult = { available: false, inputs: [], devices: [], reason: 'no-api', stop: () => {} };

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
      devices: [],
      reason: err instanceof Error ? err.message : 'access-denied',
      stop: () => {},
    };
  }

  const bound = new Set<MidiInputLike>();
  const bind = (): void => {
    for (const [key, input] of inputEntries(access)) {
      if (bound.has(input)) continue;
      bound.add(input);
      const deviceId = input.id ?? key;
      input.onmidimessage = (ev) => {
        const parsed = parseMidiMessage(ev.data);
        if (!parsed) return;
        // Only the clock carries its port: notes/CC/PC stay exactly as before (their tests and
        // consumers are unchanged), while clock ownership needs to know which port spoke.
        handler(parsed.kind === 'clock' ? { ...parsed, deviceId } : parsed);
      };
    }
  };
  const emitDevices = (): void => onDevices?.(enumerateDevices(access));
  bind();
  emitDevices();
  // Re-bind and re-publish the list when devices are hot-plugged.
  access.onstatechange = () => {
    bind();
    emitDevices();
  };

  return {
    available: true,
    inputs: inputValues(access).map((i) => i.name ?? 'MIDI Input'),
    devices: enumerateDevices(access),
    stop: () => {
      for (const input of bound) input.onmidimessage = null;
      access.onstatechange = null;
      bound.clear();
    },
  };
}
