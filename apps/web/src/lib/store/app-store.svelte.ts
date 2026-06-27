import type {
  Clip,
  EngineStats,
  InputMap,
  Layer,
  Project,
  Section,
  Song,
  TriggerBinding,
} from '@ledrums/core';
import { WSClient, type ConnectionState } from '../ws/client';
import {
  initMidi,
  type MidiInitResult,
  type MidiEvent,
} from '../midi/webmidi';
import type {
  ClientMessage,
  EffectSpec,
  OutputStatus,
  SerializedModel,
} from '../ws/protocol-types';

export type AppMode = 'performance' | 'authoring';
export type PrimaryView = 'perform' | 'arrange' | 'map' | 'routing';
export type MidiState = 'unavailable' | 'no-access' | 'active';

/** One recent input echo, for the InputMonitor rolling tail. */
export interface InputHit {
  id: number;
  kind: 'midi' | 'osc';
  label: string;
  value: number;
  at: number;
}

const MAX_HITS = 48;

/**
 * Runes-based singleton store (plan U9). Holds all reactive app state, ingests
 * ServerMessages from the WSClient, forwards WebMIDI as {t:'midi'}, and exposes
 * typed client-message senders. Mutations are applied optimistically where the
 * panels need immediate feedback; the server echoes full {state} on structural
 * change as the source of truth.
 */
class AppStore {
  // --- reactive state ------------------------------------------------------
  project = $state<Project | null>(null);
  model = $state<SerializedModel | null>(null);
  effects = $state<EffectSpec[]>([]);
  frame = $state<Uint8Array | null>(null);
  projects = $state<string[]>([]);
  connection = $state<ConnectionState>('closed');
  reconnectAttempt = $state(0);
  midi = $state<MidiState>('unavailable');
  midiInputs = $state<string[]>([]);
  midiReason = $state<string | null>(null);
  outputStatus = $state<OutputStatus | null>(null);
  stats = $state<EngineStats | null>(null);
  latencyMs = $state(0);
  fps = $state(0);
  mode = $state<AppMode>('performance');
  view = $state<PrimaryView>('perform');
  hits = $state<InputHit[]>([]);
  lastError = $state<string | null>(null);

  // --- selection (UI-only) -------------------------------------------------
  selectedLayerId = $state<string | null>(null);

  private ws: WSClient;
  private midiHandle: MidiInitResult | null = null;
  private hitSeq = 0;

  constructor() {
    this.ws = new WSClient();
    this.ws.on({
      onConnection: (s) => {
        this.connection = s;
        this.reconnectAttempt = this.ws.reconnectAttempt;
      },
      onState: (project, model, effects, projects, output) => {
        this.project = project;
        this.model = model;
        this.effects = effects;
        this.projects = projects;
        this.outputStatus = output;
        if (
          this.selectedLayerId === null ||
          !project.composition.layers.some((l) => l.id === this.selectedLayerId)
        ) {
          this.selectedLayerId = project.composition.layers[0]?.id ?? null;
        }
      },
      onFrame: (frame) => {
        this.frame = frame;
      },
      onStats: (stats, latencyMs, fps, output) => {
        this.stats = stats;
        this.latencyMs = latencyMs;
        this.fps = fps;
        this.outputStatus = output;
      },
      onInput: (kind, label, value) => this.pushHit(kind, label, value),
      onProjects: (names) => {
        this.projects = names;
      },
      onError: (message) => {
        this.lastError = message;
      },
    });
  }

  // --- lifecycle -----------------------------------------------------------

  /** Connect WS + request MIDI. Call once on mount (browser only). */
  async start(): Promise<void> {
    this.ws.connect();
    this.ws.send({ t: 'listProjects' });
    await this.initMidiAccess();
  }

  stop(): void {
    this.midiHandle?.stop();
    this.ws.close();
  }

  private async initMidiAccess(): Promise<void> {
    try {
      this.midiHandle = await initMidi((ev) => this.onMidiInput(ev));
    } catch {
      this.midiHandle = null;
    }
    if (!this.midiHandle || !this.midiHandle.available) {
      this.midi = this.midiHandle?.reason === 'no-api' ? 'unavailable' : 'no-access';
      this.midiReason = this.midiHandle?.reason ?? 'no-api';
      this.midiInputs = [];
      return;
    }
    this.midi = 'active';
    this.midiInputs = this.midiHandle.inputs;
    this.midiReason = null;
  }

  /** Forward a parsed MIDI event to the server: notes as `midi`, Control Change as `cc`,
   * Program Change as `programChange` (the latter two drive global transport recall). */
  private onMidiInput(ev: MidiEvent): void {
    switch (ev.kind) {
      case 'note':
        this.ws.send({ t: 'midi', note: ev.note, velocity: ev.velocity, on: ev.on });
        return;
      case 'cc':
        this.ws.send({ t: 'cc', controller: ev.controller, value: ev.value });
        return;
      case 'programChange':
        this.ws.send({ t: 'programChange', value: ev.value });
        return;
    }
  }

  private pushHit(kind: 'midi' | 'osc', label: string, value: number): void {
    const hit: InputHit = { id: ++this.hitSeq, kind, label, value, at: Date.now() };
    const next = [hit, ...this.hits];
    this.hits = next.length > MAX_HITS ? next.slice(0, MAX_HITS) : next;
  }

  // --- derived helpers -----------------------------------------------------

  get selectedLayer(): Layer | null {
    if (!this.project || !this.selectedLayerId) return null;
    return this.project.composition.layers.find((l) => l.id === this.selectedLayerId) ?? null;
  }

  effectById(id: string): EffectSpec | undefined {
    return this.effects.find((e) => e.id === id);
  }

  // --- raw send (escape hatch) --------------------------------------------

  send(msg: ClientMessage): void {
    this.ws.send(msg);
  }

  // --- typed senders + optimistic local mutations -------------------------

  setMode(mode: AppMode): void {
    this.mode = mode;
  }

  setView(view: PrimaryView): void {
    this.view = view;
    if (view !== 'perform') this.mode = 'authoring';
  }

  selectLayer(layerId: string | null): void {
    this.selectedLayerId = layerId;
  }

  /** Optimistically write the param locally, then send to the server. */
  setParam(layerId: string, clipId: string, key: string, value: number | string | boolean): void {
    const clip = this.project?.composition.layers
      .find((l) => l.id === layerId)
      ?.clips.find((c) => c.id === clipId);
    if (clip) clip.params[key] = value;
    this.send({ t: 'setParam', layerId, clipId, key, value });
  }

  setLayer(
    layerId: string,
    props: { blendMode?: Layer['blendMode']; opacity?: number; activeClipId?: string | null; name?: string },
  ): void {
    const layer = this.project?.composition.layers.find((l) => l.id === layerId);
    if (layer) {
      if (props.blendMode !== undefined) layer.blendMode = props.blendMode;
      if (props.opacity !== undefined) layer.opacity = props.opacity;
      if (props.activeClipId !== undefined) layer.activeClipId = props.activeClipId;
      if (props.name !== undefined) layer.name = props.name;
    }
    this.send({ t: 'setLayer', layerId, ...props });
  }

  addLayer(layer: Layer): void {
    this.send({ t: 'addLayer', layer });
  }

  removeLayer(layerId: string): void {
    this.send({ t: 'removeLayer', layerId });
  }

  addClip(layerId: string, clip: Clip): void {
    this.send({ t: 'addClip', layerId, clip });
  }

  removeClip(layerId: string, clipId: string): void {
    this.send({ t: 'removeClip', layerId, clipId });
  }

  setTransport(props: { bpm?: number; playing?: boolean; beatsPerBar?: number }): void {
    // Optimistic transport for snappy BPM/play feedback.
    if (this.project) {
      const t = this.project.composition.transport;
      if (props.bpm !== undefined) t.bpm = props.bpm;
      if (props.playing !== undefined) t.playing = props.playing;
      if (props.beatsPerBar !== undefined) t.beatsPerBar = props.beatsPerBar;
    }
    this.send({ t: 'setTransport', ...props });
  }

  setKitTransform(
    drumId: string,
    props: {
      origin?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number };
      localSpinDeg?: number;
      startAngleDeg?: number;
    },
  ): void {
    this.send({ t: 'setKitTransform', drumId, ...props });
  }

  setOutput(props: {
    state?: Project['output']['state'];
    protocol?: Project['output']['protocol'];
    host?: string;
    rgbOrder?: Project['output']['rgbOrder'];
    fps?: number;
    broadcast?: boolean;
  }): void {
    // Optimistic local output mirror so the panel reflects edits immediately.
    if (this.project) {
      const o = this.project.output;
      if (props.state !== undefined) o.state = props.state;
      if (props.protocol !== undefined) o.protocol = props.protocol;
      if (props.host !== undefined) o.host = props.host;
      if (props.rgbOrder !== undefined) o.rgbOrder = props.rgbOrder;
      if (props.fps !== undefined) o.fps = props.fps;
      if (props.broadcast !== undefined) o.broadcast = props.broadcast;
    }
    this.send({ t: 'setOutput', ...props });
  }

  loadProject(name: string): void {
    this.send({ t: 'loadProject', name });
  }

  saveProject(name: string): void {
    this.send({ t: 'saveProject', name });
  }

  listProjects(): void {
    this.send({ t: 'listProjects' });
  }

  setActiveSection(songId: string, sectionId: string): void {
    if (this.project) {
      this.project.setlist.activeSongId = songId;
      this.project.setlist.activeSectionId = sectionId;
    }
    this.send({ t: 'setActiveSection', songId, sectionId });
  }

  setBinding(sectionId: string, binding: TriggerBinding): void {
    const section = this.findSection(sectionId);
    if (section) {
      section.bindings = [
        ...section.bindings.filter((b) => b.drumId !== binding.drumId || b.slot !== binding.slot),
        binding,
      ];
    }
    this.send({ t: 'setBinding', sectionId, binding });
  }

  removeBinding(sectionId: string, drumId: string, slot: number): void {
    const section = this.findSection(sectionId);
    if (section) {
      section.bindings = section.bindings.filter((b) => b.drumId !== drumId || b.slot !== slot);
    }
    this.send({ t: 'removeBinding', sectionId, drumId, slot });
  }

  addSong(song: Song): void {
    this.send({ t: 'addSong', song });
  }

  removeSong(songId: string): void {
    this.send({ t: 'removeSong', songId });
  }

  addSection(songId: string, section: Section): void {
    this.send({ t: 'addSection', songId, section });
  }

  removeSection(songId: string, sectionId: string): void {
    this.send({ t: 'removeSection', songId, sectionId });
  }

  setSectionLayerClip(sectionId: string, layerId: string, clipId: string | null): void {
    const section = this.findSection(sectionId);
    if (section) {
      section.layerClips = [
        ...section.layerClips.filter((entry) => entry.layerId !== layerId),
        { layerId, clipId },
      ];
    }
    this.send({ t: 'setSectionLayerClip', sectionId, layerId, clipId });
  }

  setInputMap(inputMap: InputMap): void {
    if (this.project) this.project.inputMap = inputMap;
    this.send({ t: 'setInputMap', inputMap });
  }

  private findSection(sectionId: string): Section | null {
    for (const song of this.project?.setlist.songs ?? []) {
      const section = song.sections.find((s) => s.id === sectionId);
      if (section) return section;
    }
    return null;
  }
}

/** App-wide singleton. */
export const store = new AppStore();
