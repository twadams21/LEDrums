/* Production offline adapter. The browser owns relative time and authored section recall;
 * everything else is core's. An Effect show ({@link Sim.setEffectShow}) plays through a PRIVATE
 * core `createVoiceBusEngine` instance — the same class the server runs — so offline playback
 * matches the server engine by construction: voice allocation / retirement, envelopes, modifiers,
 * the Master chain and all float rendering. This is not a second renderer: render.ts only
 * quantizes this Sim's final frame for the preview. */

import { Framebuffer, voice, type EffectCategory, type EffectTag, type PixelModel, type PlayType } from '@ledrums/core';

// ---- param primitives -------------------------------------------------------------------------

/** Mirrors core `voice.ParamValue`: numbers/booleans plus `string` for enum choices and
    static-colour hex params. */
export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

/** One parameter of a generator, as the thumbnails and the gallery fixtures read it. */
export interface ParamSpec {
  key: string;
  label: string;
  kind: 'number' | 'bool' | 'enum' | 'color';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Allowed values for an `enum` param (rendered as a Select). */
  options?: string[];
  default: ParamValue;
  /** a number param an envelope can sweep over the voice's life. */
  envable?: boolean;
}

/** Core's easing vocabulary (the ease picker reads it). */
export type EaseFn = voice.EaseFn;
export type EaseDir = voice.EaseDir;
export type EaseSpec = voice.EaseSpec;

export type Scope = 'drum' | 'kit' | 'hoop';

/** A generator surfaced as a selectable effect definition (the thumbnail fixtures). */
export interface EffectDef {
  id: string;
  name: string;
  /** The core {@link EffectGenerator} registered under this id renders it. */
  generatorId?: string;
  /** Effect category (base/trigger/wash/meter/texture/particle/utility). */
  category?: EffectCategory;
  /** Gallery card / inspector blurb (from core `metadata.ts`). */
  description?: string;
  /** Controlled-vocabulary tags. */
  tags?: readonly EffectTag[];
  /** User-facing collection derived from tags (first-match). */
  playType?: PlayType;
  /** When set, the effect is retired: never listed (aliases keep old content working). */
  deprecated?: { replacedBy: string; note?: string };
  busId: string;
  scope: Scope;
  params: ParamSpec[];
  attackMs: number;
  /** one-shot dwell at full before release. */
  sustainMs: number;
  releaseMs: number;
}

/** One offline input on the Effect path — the facets core `matchSectionEffects` reads. A drum
    hit carries `drumId` / `zone`; a MIDI Cue `note`; an OSC Cue `address` (+ `value`). */
export interface EffectHit {
  drumId?: string;
  zone?: string;
  note?: number;
  address?: string;
  value?: number;
  /** 0..1 hit velocity (drum / note). */
  velocity?: number;
}

/** The song / section an Effect show recall names (a null song resolves against the active one). */
export interface EffectSelection {
  songId: string | null;
  sectionId: string | null;
}

export interface LogEntry {
  t: number;
  pad: string;
  resolved: string[];
}

/** Resolve a param spec list to its default values. */
export function defaultParams(effect: Pick<EffectDef, 'params'>): ParamValues {
  const out: ParamValues = {};
  for (const s of effect.params) out[s.key] = s.default;
  return out;
}

export class Sim {
  timeMs = 0;
  beat = 0;
  bpm = 120;
  beatsPerBar = 4;
  /** dt of the most recent tick, ms. */
  lastDt = 0;
  log: LogEntry[] = [];

  private framebuffer: Framebuffer | null = null;

  /** Immutable model revisions supplied by the store. */
  private model: PixelModel | null = null;
  get pixelModel(): PixelModel | null { return this.model; }
  set pixelModel(model: PixelModel | null) {
    if (this.model === model) return;
    this.model = model;
    this.framebuffer = null;
    if (model && this.engine) this.engine.setModel(model);
  }

  // The Sim only owns the clock: it stamps inputs with its own `timeMs`, and `tick` advances the
  // engine to that time, so an input sent between ticks lands on the next tick exactly as on the
  // server.
  private engine: voice.RenderEngine | null = null;
  private effectNames = new Map<string, string>();
  private readonly effectFires = new Map<string, number>();

  /**
   * Load a runtime Show built from an Effect library (core `buildRuntimeShow`), or `null` to
   * unload it. Loading replaces live Effect voices (core `setShow` semantics), then recalls
   * `selection` — or the engine's preserved / first song + section — so the section's Always
   * Effects and Master chain keep playing across an edit.
   */
  setEffectShow(show: voice.Show | null, selection?: EffectSelection): void {
    if (!show) {
      this.engine = null;
      this.effectNames.clear();
      this.effectFires.clear();
      return;
    }
    if (!this.engine) {
      this.engine = voice.createVoiceBusEngine({ onDiagnostic: (d) => this.onDiagnostic(d) });
      if (this.model) this.engine.setModel(this.model);
    }
    this.effectNames.clear();
    for (const song of show.songs ?? []) {
      for (const section of song.sections) for (const e of section.effects ?? []) this.effectNames.set(e.id, e.name);
    }
    this.engine.setShow(show);
    const target = selection ?? this.toSelection(this.engine.getActiveSelection());
    this.send({ kind: 'recallSection', songId: target.songId, sectionId: target.sectionId });
  }

  /** The engine's active song / section (null ids before an Effect show is loaded). */
  get effectSelection(): EffectSelection {
    return this.toSelection(this.engine?.getActiveSelection() ?? { activeSongId: null, activeSectionId: null });
  }

  /** Audition one Effect of the active section by id (keyboard audition, MIDI-map). */
  fireEffect(effectId: string, velocity = 1): void {
    this.send({ kind: 'fireEffect', effectId, velocity });
  }

  /** A drum hit / MIDI note / OSC message on the Effect path: fires every matching Effect. */
  hitEffects(hit: EffectHit): void {
    const kind = hit.address !== undefined ? 'osc' : hit.note !== undefined ? 'noteOn' : 'key';
    this.send({ kind, ...hit });
  }

  /** A MIDI note-off on the Effect path: releases the `hold` Effects its note / zone fired.
      Core releases holds only on a note-off, so the note is required. */
  releaseEffects(hit: Pick<EffectHit, 'drumId' | 'zone'> & { note: number }): void {
    this.send({ kind: 'noteOff', ...hit });
  }

  /** Recall a section: the engine replaces the Always Effects and the Master chain. `songId`
      names the song, null resolving against the engine's active one. */
  recallSection(sectionId: string, songId: string | null = null): void {
    this.send({ kind: 'recallSection', songId, sectionId });
  }

  /** Sim time (ms) an Effect last spawned a voice (0 = never) — the fire-flash source. */
  effectFiredAt(effectId: string): number {
    return this.effectFires.get(effectId) ?? 0;
  }

  /** Live Effect-path voices for the Layers dock (allocates: call at telemetry cadence). */
  effectVoiceStats(): voice.VoiceStat[] {
    return this.engine?.stats().voices ?? [];
  }

  /** Release every live voice (panic). */
  stopAll(): void {
    this.send({ kind: 'releaseBus' });
  }

  /** A raw MIDI CC (value 0..127): the engine keeps its own CC table and fires CC Cues on the
      rising edge. */
  setCc(controller: number, value: number, channel: number | null): void {
    this.send({ kind: 'cc', controller, value, ...(channel !== null ? { channel } : {}) });
  }

  /** A raw OSC value at `address` — modulation only; an OSC Cue fires through
      `hitEffects({ address })`. */
  setOsc(address: string, value: number): void {
    this.send({ kind: 'oscValue', address, value });
  }

  /** The latest analysed audio frame (GH #214), stamped at the sim clock by the engine. */
  setAudio(frame: voice.AudioFeatureFrame): void {
    this.send({ kind: 'audioFeatures', audio: frame });
  }

  tick(dtMs: number): void {
    this.timeMs += dtMs;
    this.lastDt = dtMs;
    this.beat += (dtMs / 60000) * this.bpm;
    if (!this.engine) return;
    const bar = Math.floor(this.beat / this.beatsPerBar);
    this.engine.tick(this.timeMs, dtMs, { timeMs: this.timeMs, beat: this.beat, bar,
      beatInBar: this.beat - bar * this.beatsPerBar, bpm: this.bpm, beatsPerBar: this.beatsPerBar, playing: true });
  }

  /** The engine's frame, composited (voices + Master chain) at its last tick. A paused repaint
      returns that frame unchanged. Before a show loads, a blank frame of the model's size. */
  render(model: PixelModel): Readonly<Float32Array> {
    this.pixelModel = model;
    if (this.engine) return this.engine.frame();
    if (!this.framebuffer || this.framebuffer.pixelCount !== model.pixelCount) this.framebuffer = new Framebuffer(model.pixelCount);
    return this.framebuffer.rgba;
  }

  private toSelection(s: { activeSongId: string | null; activeSectionId: string | null }): EffectSelection {
    return { songId: s.activeSongId, sectionId: s.activeSectionId };
  }

  private send(ev: Omit<voice.InputEvent, 'timeMs'>): void {
    this.engine?.applyInput({ ...ev, timeMs: this.timeMs } as voice.InputEvent);
  }

  private onDiagnostic(d: voice.VoiceDiagnostic): void {
    if (d.kind === 'effect-fired') {
      this.effectFires.set(d.effectId, this.timeMs);
      this.pushLog(d.input, [`▶ ${this.effectNames.get(d.effectId) ?? d.effectId}  (${d.trigger})`], d.trigger);
    } else if (d.kind === 'effect-skipped') {
      this.pushLog(d.input, [`— skipped ${this.effectNames.get(d.effectId) ?? d.effectId} (${d.reason})`]);
    } else if (d.kind === 'effect-missed') {
      this.pushLog(d.input, ['— nothing (no Effect matches)']);
    }
  }

  private pushLog(input: voice.VoiceInputDescriptor | null, resolved: string[], fallback = 'effect'): void {
    const pad = input ? [input.drumId, input.zone].filter((x) => x !== undefined).join(':') || input.kind : fallback;
    this.log.unshift({ t: this.timeMs, pad, resolved });
    if (this.log.length > 60) this.log.length = 60;
  }
}
