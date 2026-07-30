/**
 * Live input value tables (S37/S38) — the last MIDI CC, OSC and note value the editor has
 * SEEN, keyed exactly as the core engine keys them (`voice.ccKey` / `voice.noteKey` / raw OSC
 * address). This is input state, not render state: it is fed both by our own WebMIDI forward
 * and by the server's `input` echo, so it is live whether or not an engine link is open.
 *
 * It backs the node-face live readouts — a `cc` node's value bar, an `osc` node's readout, a
 * `note` node's gate — which sample through the SAME core functions the engine samples with
 * (`voice.sampleCc` / `sampleOsc` / `sampleNote`), so a node face can never draw a value the
 * render path wouldn't read.
 *
 * These tables used to live on the retired offline `Sim` because that was the only object with
 * a clock; they outlived it because they were never simulation output in the first place.
 */
import { voice } from '@ledrums/core';

/** Monotonic clock in ms — injected so tests drive note release deterministically. */
export type NowMs = () => number;

const defaultNow: NowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class LiveInputTables {
  /** Controller+channel → 0..1 (see core `ccKey`). Both the specific-channel key and the omni
      slot are written, so an omni mapping reads the latest value whatever channel sent it.
      Exposed as core's READONLY table type — only this class's writers mutate it. */
  readonly cc: voice.CcTable;
  /** OSC address → 0..1. */
  readonly osc: voice.OscTable;
  /** note+channel → gate/velocity/release state (see core `noteKey`). */
  readonly notes: voice.NoteTable;

  private readonly ccW = new Map<string, number>();
  private readonly oscW = new Map<string, number>();
  private readonly notesW = new Map<string, voice.NoteState>();
  private readonly now: NowMs;

  constructor(now: NowMs = defaultNow) {
    this.now = now;
    this.cc = this.ccW;
    this.osc = this.oscW;
    this.notes = this.notesW;
  }

  /** Current clock value — the same reading {@link setNote} stamps releases with, so a caller
      sampling note state compares like against like. */
  nowMs(): number {
    return this.now();
  }

  /** Update the CC table from a raw MIDI CC (value 0..127), writing the specific-channel key
      AND the omni slot — matching the core engine's `processEvent`. */
  setCc(controller: number, value: number, channel: number | null): void {
    const v = voice.ccValue01(value);
    this.ccW.set(voice.ccKey(controller, channel), v);
    this.ccW.set(voice.ccKey(controller, null), v);
  }

  /** Update the OSC table from a raw OSC value at `address` (clamped to 0..1), mirroring the
      core engine's `processEvent` OSC-table write. */
  setOsc(address: string, value: number): void {
    this.oscW.set(address, voice.oscValue01(value));
  }

  /** Record a note on/off. A note-off keeps the previous gate/velocity and stamps
      `releasedAtMs` from {@link nowMs}, so `voice.sampleNote`'s release ramp has a clock that
      advances with wall time (the retired sim's clock only advanced while transport played). */
  setNote(note: number, velocity: number, channel: number | null, on: boolean): void {
    const v = voice.noteValue01(velocity / 127);
    const releasedAtMs = this.now();
    const write = (ch: number | null): void => {
      const key = voice.noteKey(note, ch);
      const prev = this.notesW.get(key);
      this.notesW.set(
        key,
        on
          ? { gate: 1, velocity: v, releasedAtMs: null }
          : { gate: prev?.gate ?? 0, velocity: prev?.velocity ?? 0, releasedAtMs },
      );
    };
    write(channel);
    write(null);
  }
}
