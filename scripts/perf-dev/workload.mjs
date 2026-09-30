import { createHash } from 'node:crypto';

export const WORKLOAD_VERSION = 'spatial-midi-audio-effects-v1';
export const AUDIO_HZ = 30;
export const MIDI_BURST_MS = 1000;
export const emptyShow = () => ({ songs: [] });
export const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The Wave Generator Style that hosts `spatial-field` (core `effect-chain/generators/wave.ts`). */
export const GENERATOR = Object.freeze({ kind: 'wave', style: 'field' });
export const SONG_ID = 'perf-dev';
export const SECTION_ID = 'perf-dev-section';
const BANDS = ['level', 'bass', 'mids', 'highs'];

/** One CANONICAL Effect (every field core's `effectSchema` would default is present): the
 * protocol Show gate passes Effects through unchanged and refuses a non-canonical one. */
function effect(id, source, params, band) {
  return {
    id, name: 'Synthetic Spatial Field', bypass: false,
    cell: { row: source.drumId, column: { kind: 'zone', slot: source.slot } },
    trigger: { kind: 'zone' },
    retrigger: 'restart',
    amp: { attackMs: 0, decayMs: 0, sustainLevel: 1, length: 'loop', releaseMs: 0 },
    generator: { kind: GENERATOR.kind, style: GENERATOR.style, params },
    modifiers: [],
    controls: [{
      uid: `${id}-audio`, kind: 'audio', settings: { band },
      mappings: [{ device: 'generator', param: 'brightness', amount: 1, invert: false, rangeMin: 0.25, rangeMax: 0.9 }],
    }],
    target: { kind: 'kit' },
    blend: 'add',
    opacity: 1,
  };
}

/** Every Effect of a workload Show, in section order. */
export const workloadEffects = (show) => show.songs.flatMap((song) => song.sections.flatMap((section) => section.effects));

/** No project, input-map or library edits. Use the existing kit's mapped MIDI notes so the
 * engine gets real sourceDrumIds (direct, unmapped MIDI sources have no drum disturbance origin).
 * Each lane is one looping kit-wide Effect in its source drum's zone cell with retrigger
 * `restart`: repeating hits refresh its spatial disturbance without accumulating endless loops.
 * The engine's minimum release tail still overlaps on restart; requested voices counts sustained
 * lanes, while stats reports ALL active voices including tails. */
export function buildWorkload(state, voices = 8) {
  if (!Number.isInteger(voices) || voices < 1 || voices > 32) throw new Error('voices must be 1..32');
  const spatial = state.effects?.find((spec) => spec.id === 'spatial-field');
  if (!spatial || !Array.isArray(spatial.paramSpec)) throw new Error('Server must advertise spatial-field');
  const defaults = Object.fromEntries(spatial.paramSpec.map((spec) => [spec.key, spec.default]));
  for (const key of ['brightness', 'hue', 'scale', 'twist', 'speed', 'disturbance', 'lifeMs']) {
    if (!Number.isFinite(defaults[key])) throw new Error(`spatial-field must advertise numeric ${key}`);
  }
  const inputMap = state.project.inputMap;
  const reserved = new Set(Object.values(inputMap.globalControls ?? {}).map((binding) => binding?.midiNote));
  const drums = new Set(state.project.kit.drums.map((drum) => drum.id));
  const seenNotes = new Set();
  const seenPads = new Set();
  const sources = [];
  // First mapping for each note wins, matching the host zone-map; never route past a bad first
  // entry to a later duplicate. Sorting happens AFTER resolving that precedence.
  for (const map of inputMap.midiNotes ?? []) {
    if (seenNotes.has(map.note)) continue;
    seenNotes.add(map.note);
    const pad = `${map.drumId}:${map.slot}`;
    if (reserved.has(map.note) || !drums.has(map.drumId) || seenPads.has(pad)) continue;
    if (!Number.isInteger(map.note) || map.note < 0 || map.note > 127 ||
        !Number.isInteger(map.slot) || map.slot < 0 || map.slot > 7) continue;
    seenPads.add(pad);
    sources.push({ note: map.note, drumId: map.drumId, slot: map.slot });
  }
  sources.sort((a, b) => a.note - b.note);
  if (!sources.length) throw new Error('Need an existing kit MIDI mapping not reserved by a global control');
  // Prefer one source per drum, then extra zones, to distribute disturbances through world XYZ.
  const firstDrums = new Set();
  const ordered = [...sources.filter((s) => {
    if (firstDrums.has(s.drumId)) return false;
    firstDrums.add(s.drumId);
    return true;
  })];
  ordered.push(...sources.filter((s) => !ordered.includes(s)));
  const used = ordered.slice(0, voices);
  const effects = [];
  for (let i = 0; i < voices; i++) {
    const params = { ...defaults, hue: (i * 47) % 360, brightness: 0.7, disturbance: 1, lifeMs: 1500 };
    effects.push(effect(`perf-dev-${i}`, used[i % used.length], params, BANDS[i % BANDS.length]));
  }
  const show = {
    songs: [{ id: SONG_ID, name: 'Perf dev', sections: [{ id: SECTION_ID, name: 'Perf dev', effects, master: [] }] }],
  };
  return {
    show, sources: used, channel: inputMap.midiChannel ?? 1,
    metadata: {
      version: WORKLOAD_VERSION, requestedVoices: voices, effect: 'spatial-field',
      generator: { kind: GENERATOR.kind, style: GENERATOR.style }, effectDefaults: defaults,
      showSha256: fingerprint(show), kitSha256: fingerprint(state.project.kit),
      inputMapSha256: fingerprint(inputMap), pixelCount: state.model.count,
      drumCount: state.project.kit.drums.length, sources: used,
      audioHz: AUDIO_HZ, midiBurstMs: MIDI_BURST_MS,
      voicePolicy: 'One looping kit-wide Spatial Field Effect (Wave / Field) per lane in its source drum zone cell, retrigger restart, hit each second. Engine release tails on restart temporarily add voices above requestedVoices.',
      transport: state.project.composition.transport,
    },
  };
}

/** Sequence-indexed, not random or audio capture. Delayed sends skip to the current index;
 * the runner reports skipped emissions instead of hiding a burst of client-side catch-up. */
export function audioMessage(index) {
  const phase = (index % 120) / 120;
  return {
    t: 'audioFeatures',
    level: 0.5 + 0.4 * Math.sin(2 * Math.PI * phase),
    bass: 0.5 + 0.4 * Math.sin(2 * Math.PI * phase * 2),
    mids: 0.5 + 0.4 * Math.cos(2 * Math.PI * phase * 3),
    highs: 0.2 + 0.7 * ((index % 16) / 15),
  };
}

export function midiMessages(workload, index) {
  return workload.sources.flatMap(({ note }, i) => [
    { t: 'midi', note, velocity: 72 + ((index * 17 + i * 13) % 56), on: true, channel: workload.channel },
    { t: 'midi', note, velocity: 0, on: false, channel: workload.channel },
  ]);
}
