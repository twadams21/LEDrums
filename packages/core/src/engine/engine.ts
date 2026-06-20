import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { buildDmxMap, type DmxMap } from '../geometry/dmx-map';
import type { DrumConfig } from '../geometry/kit-schema';
import type { Clip, Layer, OutputSettings, Project, Transport } from '../model/project-schema';
import { getEffect, tryGetEffect } from '../effects/registry';
import { Framebuffer } from './framebuffer';
import { ControlState } from './control-state';
import { advanceTransport } from './transport';
import { resolveParams } from './modulation';
import { composite, type CompositeLayer } from './compositor';
import type { RenderContext, TransportState, Trigger } from './render-context';

export type InputEvent =
  | { kind: 'noteOn'; note: number; velocity: number; timeMs: number }
  | { kind: 'noteOff'; note: number; timeMs: number }
  | { kind: 'osc'; address: string; value: number; timeMs: number };

export interface EngineStats {
  timeMs: number;
  beat: number;
  bar: number;
  activeTriggers: number;
  tickCount: number;
  pixelCount: number;
}

const MAX_TRIGGER_AGE_MS = 6000;

/**
 * The render engine (plan U6). Owns the project, pixel model, DMX map, control state,
 * transport, per-clip mutable state, and a time-stamped input queue. `tick(dt)` drains
 * inputs at the tick boundary, advances transport, renders every layer's active clip,
 * and composites bottom→top. Pure: no wall-clock or IO. Replay-deterministic (R13).
 */
export class Engine {
  private project: Project;
  private model!: PixelModel;
  private dmxMap!: DmxMap;
  private controlState = new ControlState();

  private timeMs = 0;
  private beat = 0;
  private tickCount = 0;
  private seq = 0;

  private triggers: Trigger[] = [];
  private queue: InputEvent[] = [];
  private layerBuffers = new Map<string, Framebuffer>();
  private clipStates = new Map<string, unknown>();
  private prevActive = new Map<string, string | null>();
  private finalFb!: Framebuffer;

  constructor(project: Project) {
    this.project = project;
    this.rebuild();
  }

  // --- lifecycle -----------------------------------------------------------

  /** Rebuild geometry-derived structures (model, dmx map, buffers). */
  private rebuild(): void {
    this.model = buildPixelModel(this.project.kit);
    this.dmxMap = this.buildMapSafe();
    this.finalFb = new Framebuffer(this.model.pixelCount);
    this.layerBuffers.clear();
    for (const layer of this.project.composition.layers) {
      this.layerBuffers.set(layer.id, new Framebuffer(this.model.pixelCount));
    }
    this.clipStates.clear();
    this.prevActive.clear();
  }

  private buildMapSafe(): DmxMap {
    try {
      return buildDmxMap(this.project.kit, this.model);
    } catch {
      // Invalid topology must not stop rendering/preview — fall back to a flat map.
      const flat = { ...this.project.kit, outputs: [], global: { ...this.project.kit.global, maxPixelsPerOutput: Number.MAX_SAFE_INTEGER } };
      return buildDmxMap(flat, this.model);
    }
  }

  setProject(project: Project): void {
    this.project = project;
    this.timeMs = 0;
    this.beat = 0;
    this.triggers = [];
    this.queue = [];
    this.controlState.reset();
    this.rebuild();
  }

  getProject(): Project {
    return this.project;
  }

  getModel(): PixelModel {
    return this.model;
  }

  getDmxMap(): DmxMap {
    return this.dmxMap;
  }

  getFrame(): Framebuffer {
    return this.finalFb;
  }

  getStats(): EngineStats {
    return {
      timeMs: this.timeMs,
      beat: this.beat,
      bar: Math.floor(this.beat / this.project.composition.transport.beatsPerBar),
      activeTriggers: this.triggers.length,
      tickCount: this.tickCount,
      pixelCount: this.model.pixelCount,
    };
  }

  // --- input ---------------------------------------------------------------

  /** Enqueue a time-stamped input event; applied at the next tick boundary (R13/R14). */
  applyEvent(event: InputEvent): void {
    this.queue.push(event);
  }

  private drainQueue(): void {
    if (this.queue.length === 0) return;
    // Apply events stamped at or before now, in time order.
    const due = this.queue.filter((e) => e.timeMs <= this.timeMs);
    this.queue = this.queue.filter((e) => e.timeMs > this.timeMs);
    due.sort((a, b) => a.timeMs - b.timeMs);
    for (const e of due) this.processEvent(e);
  }

  private processEvent(e: InputEvent): void {
    if (e.kind === 'noteOn') {
      const maps = this.project.inputMap.midiNotes.filter((m) => m.note === e.note);
      if (maps.length === 0) {
        this.triggers.push({ seq: ++this.seq, drumId: '', note: e.note, velocity: e.velocity, timeMs: this.timeMs, ageMs: 0 });
        return;
      }
      for (const m of maps) {
        this.controlState.setVelocity(m.drumId, e.velocity);
        this.triggers.push({ seq: ++this.seq, drumId: m.drumId, note: e.note, velocity: e.velocity, timeMs: this.timeMs, ageMs: 0 });
        if (m.trigger) this.setActiveClip(m.trigger.layerId, m.trigger.clipId);
      }
    } else if (e.kind === 'osc') {
      this.controlState.setOsc(e.address, e.value);
      if (e.address === this.project.inputMap.volumeOscAddress) this.controlState.volume = e.value;
      for (const t of this.project.inputMap.oscTriggers) {
        if (t.address === e.address) this.setActiveClip(t.layerId, t.clipId);
      }
    }
    // noteOff currently has no engine effect (velocity decays on its own envelope).
  }

  // --- tick ----------------------------------------------------------------

  tick(dtMs: number): void {
    this.timeMs += dtMs;
    this.drainQueue();

    const adv = advanceTransport(this.project.composition.transport, this.beat, this.timeMs, dtMs);
    this.beat = adv.beat;
    const transport = adv.state;

    this.controlState.decay(dtMs);

    // Age + prune triggers.
    for (const t of this.triggers) t.ageMs = this.timeMs - t.timeMs;
    if (this.triggers.length > 0) {
      this.triggers = this.triggers.filter((t) => t.ageMs <= MAX_TRIGGER_AGE_MS);
    }

    const ctx: RenderContext = {
      model: this.model,
      timeMs: this.timeMs,
      dt: dtMs,
      transport,
      triggers: this.triggers,
    };

    const composeLayers: CompositeLayer[] = [];
    for (const layer of this.project.composition.layers) {
      const buffer = this.layerBuffers.get(layer.id) ?? new Framebuffer(this.model.pixelCount);
      this.layerBuffers.set(layer.id, buffer);
      buffer.clear();
      this.renderLayer(layer, ctx, buffer);
      composeLayers.push({ fb: buffer, blendMode: layer.blendMode, opacity: layer.opacity });
    }

    composite(composeLayers, this.finalFb);
    this.tickCount++;
  }

  private renderLayer(layer: Layer, ctx: RenderContext, buffer: Framebuffer): void {
    // Reset per-clip state when the active clip changes (KTD7).
    if (this.prevActive.get(layer.id) !== layer.activeClipId) {
      if (layer.activeClipId) this.clipStates.delete(`${layer.id}:${layer.activeClipId}`);
      this.prevActive.set(layer.id, layer.activeClipId);
    }
    if (!layer.activeClipId) return;
    const clip = layer.clips.find((c) => c.id === layer.activeClipId);
    if (!clip) return;
    const effect = tryGetEffect(clip.effectId);
    if (!effect) return;
    const params = resolveParams(clip, this.controlState, ctx.transport);
    const state = this.ensureClipState(layer.id, clip, effect);
    effect.render(ctx, params, buffer, state);
  }

  private ensureClipState(layerId: string, clip: Clip, effect: ReturnType<typeof getEffect>): unknown {
    if (!effect.createState) return undefined;
    const key = `${layerId}:${clip.id}`;
    let s = this.clipStates.get(key);
    if (s === undefined) {
      s = effect.createState(this.model);
      this.clipStates.set(key, s);
    }
    return s;
  }

  // --- mutations (used by the server reducer) ------------------------------

  setParam(layerId: string, clipId: string, key: string, value: number | string | boolean): void {
    const clip = this.findClip(layerId, clipId);
    if (clip) clip.params[key] = value;
  }

  setLayerProps(layerId: string, props: Partial<Pick<Layer, 'blendMode' | 'opacity' | 'activeClipId' | 'name'>>): void {
    const layer = this.project.composition.layers.find((l) => l.id === layerId);
    if (!layer) return;
    Object.assign(layer, props);
  }

  setActiveClip(layerId: string, clipId: string | null): void {
    const layer = this.project.composition.layers.find((l) => l.id === layerId);
    if (layer) layer.activeClipId = clipId;
  }

  setTransport(partial: Partial<Transport>): void {
    Object.assign(this.project.composition.transport, partial);
  }

  setOutput(partial: Partial<OutputSettings>): void {
    Object.assign(this.project.output, partial);
  }

  addLayer(layer: Layer): void {
    this.project.composition.layers.push(layer);
    this.layerBuffers.set(layer.id, new Framebuffer(this.model.pixelCount));
  }

  removeLayer(layerId: string): void {
    this.project.composition.layers = this.project.composition.layers.filter((l) => l.id !== layerId);
    this.layerBuffers.delete(layerId);
  }

  addClip(layerId: string, clip: Clip): void {
    const layer = this.project.composition.layers.find((l) => l.id === layerId);
    if (layer) layer.clips.push(clip);
  }

  removeClip(layerId: string, clipId: string): void {
    const layer = this.project.composition.layers.find((l) => l.id === layerId);
    if (!layer) return;
    layer.clips = layer.clips.filter((c) => c.id !== clipId);
    if (layer.activeClipId === clipId) layer.activeClipId = layer.clips[0]?.id ?? null;
    this.clipStates.delete(`${layerId}:${clipId}`);
  }

  /** Update a drum's transform and rebuild geometry (KitEditor live calibration). */
  setKitTransform(drumId: string, partial: Partial<Pick<DrumConfig, 'origin' | 'rotation' | 'localSpinDeg' | 'startAngleDeg'>>): void {
    const drum = this.project.kit.drums.find((d) => d.id === drumId);
    if (!drum) return;
    Object.assign(drum, partial);
    this.rebuild();
  }

  private findClip(layerId: string, clipId: string): Clip | undefined {
    return this.project.composition.layers.find((l) => l.id === layerId)?.clips.find((c) => c.id === clipId);
  }
}
