import { z } from 'zod';
import { BLEND_MODES } from '../color/blend';
import { kitSchema } from '../geometry/kit-schema';

/** A control source feeds a live value (0..1 conceptually) into a parameter. */
export const controlSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('velocity'), drum: z.string().optional() }),
  z.object({ type: z.literal('volume') }),
  z.object({ type: z.literal('beat'), mult: z.number().default(1) }),
  z.object({
    type: z.literal('lfo'),
    rate: z.number().positive().default(1),
    shape: z.enum(['sine', 'triangle', 'square', 'saw']).default('sine'),
  }),
  z.object({ type: z.literal('osc'), address: z.string() }),
]);

export const curveSchema = z.enum(['linear', 'exp', 'log', 'invert']);

/** Binds a control source to a clip parameter over a min..max range with a curve. */
export const modulationSchema = z.object({
  source: controlSourceSchema,
  param: z.string(),
  min: z.number().default(0),
  max: z.number().default(1),
  curve: curveSchema.default('linear'),
});

export const paramValueSchema = z.union([z.number(), z.string(), z.boolean()]);

export const clipSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  effectId: z.string().min(1),
  params: z.record(paramValueSchema).default({}),
  modulations: z.array(modulationSchema).default([]),
});

export const layerRoleSchema = z.enum(['base', 'trigger', 'automation', 'effect']);

export const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  role: layerRoleSchema.default('effect'),
  blendMode: z.enum(BLEND_MODES).default('normal'),
  opacity: z.number().min(0).max(1).default(1),
  clips: z.array(clipSchema).default([]),
  activeClipId: z.string().nullable().default(null),
});

export const transportSchema = z.object({
  bpm: z.number().positive().default(120),
  playing: z.boolean().default(true),
  beatsPerBar: z.number().int().positive().default(4),
});

export const compositionSchema = z.object({
  layers: z.array(layerSchema).default([]),
  transport: transportSchema.default({}),
});

/**
 * Each drum exposes up to 8 trigger slots (Sensory Percussion-style zones).
 * What a `(drum, slot)` hit DOES is decided by the active section's bindings.
 */
export const TRIGGER_SLOT_COUNT = 8;
export const SLOT_LABELS = [
  'center', 'edge', 'rim-tip', 'rim-shoulder', 'shell', 'cross-stick', 'aux-1', 'aux-2',
] as const;
export const slotSchema = z.number().int().min(0).max(TRIGGER_SLOT_COUNT - 1);

/** Maps a MIDI note to a drum + trigger slot (velocity control + section routing). */
export const midiNoteMapSchema = z.object({
  note: z.number().int().min(0).max(127),
  drumId: z.string(),
  slot: slotSchema.default(0),
});

/** Maps an incoming OSC address to a drum + trigger slot (Sensory Percussion / Ableton). */
export const oscMapSchema = z.object({
  address: z.string(),
  drumId: z.string(),
  slot: slotSchema.default(0),
});

export const inputMapSchema = z.object({
  midiNotes: z.array(midiNoteMapSchema).default([]),
  /** Global MIDI channel filter. null = accept all channels; otherwise 1..16. */
  midiChannel: z.number().int().min(1).max(16).nullable().default(null),
  /** OSC addresses that fire a drum/slot trigger. */
  oscMap: z.array(oscMapSchema).default([]),
  /** OSC address that drives the master `volume` control. */
  volumeOscAddress: z.string().optional(),
});

/** A (drum, slot) trigger → the clip/layer it activates within a section. */
export const triggerBindingSchema = z.object({
  drumId: z.string(),
  slot: slotSchema,
  layerId: z.string(),
  clipId: z.string(),
});

/** A layer's active clip when a section loads (sets the look, not trigger-driven). */
export const sectionLayerClipSchema = z.object({
  layerId: z.string(),
  clipId: z.string().nullable(),
});

export const sectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  /** Optional length hint, bars. */
  bars: z.number().int().positive().optional(),
  /** Layer looks applied when this section is entered. */
  layerClips: z.array(sectionLayerClipSchema).default([]),
  /** Per (drum, slot) trigger routing for this section. */
  bindings: z.array(triggerBindingSchema).default([]),
});

export const songSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  bpm: z.number().positive().optional(),
  sections: z.array(sectionSchema).default([]),
});

export const setlistSchema = z.object({
  songs: z.array(songSchema).default([]),
  activeSongId: z.string().nullable().default(null),
  activeSectionId: z.string().nullable().default(null),
});

export const outputStateSchema = z.enum(['disabled', 'dry-run', 'armed']);
export const rgbOrderSchema = z.enum(['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR']);

export const outputSettingsSchema = z.object({
  state: outputStateSchema.default('disabled'),
  protocol: z.enum(['artnet', 'sacn']).default('artnet'),
  host: z.string().default('255.255.255.255'),
  port: z.number().int().positive().optional(),
  broadcast: z.boolean().default(false),
  rgbOrder: rgbOrderSchema.default('RGB'),
  /** Output transmit rate, frames/sec. */
  fps: z.number().positive().max(120).default(44),
  /** Source/multicast interface override (multi-NIC safety; sACN multicast + Art-Net bind). */
  iface: z.string().optional(),
  /** sACN E1.31 framing-layer priority, 1–200 (higher wins at a merging node). */
  priority: z.number().int().min(1).max(200).default(100),
});

export const projectSchema = z.object({
  name: z.string().default('Untitled'),
  kit: kitSchema,
  composition: compositionSchema.default({}),
  inputMap: inputMapSchema.default({}),
  setlist: setlistSchema.default({}),
  output: outputSettingsSchema.default({}),
});

export type ControlSource = z.infer<typeof controlSourceSchema>;
export type Curve = z.infer<typeof curveSchema>;
export type Modulation = z.infer<typeof modulationSchema>;
export type ParamValue = z.infer<typeof paramValueSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type LayerRole = z.infer<typeof layerRoleSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type Transport = z.infer<typeof transportSchema>;
export type Composition = z.infer<typeof compositionSchema>;
export type MidiNoteMap = z.infer<typeof midiNoteMapSchema>;
export type OscMap = z.infer<typeof oscMapSchema>;
export type InputMap = z.infer<typeof inputMapSchema>;
export type TriggerBinding = z.infer<typeof triggerBindingSchema>;
export type SectionLayerClip = z.infer<typeof sectionLayerClipSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Song = z.infer<typeof songSchema>;
export type Setlist = z.infer<typeof setlistSchema>;
export type OutputState = z.infer<typeof outputStateSchema>;
export type RgbOrder = z.infer<typeof rgbOrderSchema>;
export type OutputSettings = z.infer<typeof outputSettingsSchema>;
export type Project = z.infer<typeof projectSchema>;

/** Parse + validate a project JSON, applying defaults. Throws ZodError on invalid input. */
export function parseProject(raw: unknown): Project {
  return projectSchema.parse(raw);
}
