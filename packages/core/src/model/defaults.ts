import { parseKit, type KitConfig } from '../geometry/kit-schema';
import { assertProjectIntegrity } from './integrity';
import { parseProject, type Layer, type Project } from './project-schema';

const drum = (
  id: string,
  label: string,
  color: string,
  diameterIn: number,
  /** Literal LED count per hoop — the authoritative count for the physical rig
      (docs/kit-hoop-pixel-counts.md); every hoop on a drum shares it. */
  pixelsPerHoop: number,
  origin: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number },
) => ({
  id,
  label,
  color,
  diameterIn,
  hoopSpacingMm: 60,
  pixelsPerHoop,
  localSpinDeg: 270,
  startAngleDeg: 0,
  origin,
  rotation,
});

/**
 * The single canonical drum kit — the ONE in-code definition of the kit's drums +
 * geometry. `defaultProject()` builds its `.kit` from this, and the web's offline
 * lab model (`buildLabModel`) derives from it too, so drum ids / geometry can't
 * drift between the engine and the lab preview (the prior `tom` vs `tom1` bug class).
 * Parsed once so it's a validated {@link KitConfig} with all schema defaults applied.
 * (The full hardware topology ships separately as `apps/server/projects/default.json`.)
 */
export const DEFAULT_KIT: KitConfig = parseKit({
  version: 3, // A1 1-based hoop indexing + B2 expanded flag; a NEW kit → expanded defaults OFF
  units: 'mm',
  global: { ledDensityPxPerM: 30, hoopCount: 4, defaultHoopSpacingMm: 60, maxPixelsPerOutput: 4096 },
  drums: [
    drum('kick', 'Kick', '#5bbcff', 21, 196, { x: 0, y: 430, z: 330 }, { x: 90, y: 0, z: 0 }),
    drum('snare', 'Snare', '#72d572', 12, 108, { x: -230, y: 0, z: 650 }, { x: 0, y: 0, z: 0 }),
    drum('tom1', 'Tom 1', '#ff8e72', 12, 108, { x: -120, y: 300, z: 840 }, { x: 18, y: 0, z: 4 }),
    drum('tom2', 'Tom 2', '#d69cff', 15, 136, { x: 360, y: 40, z: 620 }, { x: 0, y: 0, z: 0 }),
  ],
  outputs: [],
});

/**
 * A compact, always-valid default project used as a programmatic fallback (the
 * full hardware kit + topology ships as `apps/server/projects/default.json`, U11).
 * Density is modest and the DMX map is left flat so this never depends on a wiring
 * topology; the starter composition exercises base / trigger / effect layers.
 */
export function defaultProject(): Project {
  const layers: Layer[] = [
    {
      id: 'base',
      name: 'Base',
      role: 'base',
      blendMode: 'normal',
      opacity: 1,
      activeClipId: 'base-swirl',
      clips: [
        {
          id: 'base-swirl',
          name: 'Swirl',
          effectId: 'solid-base',
          params: { hue: 210, saturation: 0.7, brightness: 0.4, speed: 0.3, noise: 0.4 },
          modulations: [{ source: { type: 'volume' }, param: 'saturation', min: 0.4, max: 1, curve: 'linear' }],
        },
      ],
    },
    {
      id: 'trigger',
      name: 'Trigger',
      role: 'trigger',
      blendMode: 'add',
      opacity: 1,
      activeClipId: 'chase',
      clips: [
        {
          id: 'chase',
          name: 'Chase',
          effectId: 'chase',
          params: { hue: 30, brightness: 1, subdivision: 4 },
          modulations: [{ source: { type: 'velocity' }, param: 'brightness', min: 0.3, max: 1, curve: 'linear' }],
        },
        {
          id: 'whole-drum',
          name: 'Whole Drum',
          effectId: 'whole-drum',
          params: { hue: 0, brightness: 1, decayMs: 220 },
          modulations: [],
        },
      ],
    },
    {
      id: 'effect',
      name: 'Effect',
      role: 'effect',
      blendMode: 'screen',
      opacity: 0.8,
      activeClipId: 'wash',
      clips: [
        {
          id: 'wash',
          name: 'Radial Wash',
          effectId: 'radial-wash',
          params: { hue: 280, brightness: 0.9, mode: 'out', speed: 1.2, width: 180, decayMs: 500 },
          modulations: [],
        },
      ],
    },
  ];

  const project = parseProject({
    name: 'LEDrums Default',
    kit: DEFAULT_KIT,
    composition: {
      layers,
      transport: { bpm: 120, playing: true, beatsPerBar: 4 },
    },
    inputMap: {
      midiChannel: null,
      midiNotes: [
        { note: 36, drumId: 'kick', slot: 0 },
        { note: 38, drumId: 'snare', slot: 0 },
        { note: 48, drumId: 'tom1', slot: 0 },
        { note: 45, drumId: 'tom2', slot: 0 },
      ],
      oscMap: [
        { address: '/sp/kick', drumId: 'kick', slot: 0 },
        { address: '/sp/snare', drumId: 'snare', slot: 0 },
      ],
      volumeOscAddress: '/ledrums/volume',
    },
    setlist: {
      activeSongId: 'song1',
      activeSectionId: 'verse',
      songs: [
        {
          id: 'song1',
          name: 'Demo Song',
          bpm: 120,
          sections: [
            {
              id: 'verse',
              name: 'Verse',
              layerClips: [
                { layerId: 'base', clipId: 'base-swirl' },
                { layerId: 'trigger', clipId: 'chase' },
                { layerId: 'effect', clipId: 'wash' },
              ],
              bindings: [
                { drumId: 'kick', slot: 0, layerId: 'trigger', clipId: 'whole-drum' },
                { drumId: 'snare', slot: 0, layerId: 'trigger', clipId: 'chase' },
              ],
            },
            {
              id: 'chorus',
              name: 'Chorus',
              layerClips: [
                { layerId: 'base', clipId: 'base-swirl' },
                { layerId: 'effect', clipId: 'wash' },
              ],
              bindings: [
                { drumId: 'kick', slot: 0, layerId: 'trigger', clipId: 'chase' },
                { drumId: 'snare', slot: 0, layerId: 'trigger', clipId: 'whole-drum' },
              ],
            },
          ],
        },
      ],
    },
    output: { state: 'disabled', protocol: 'artnet', host: '255.255.255.255', rgbOrder: 'RGB', fps: 44 },
  });
  // Fail loudly if the canonical default ever references a drum its kit doesn't define.
  assertProjectIntegrity(project);
  return project;
}
