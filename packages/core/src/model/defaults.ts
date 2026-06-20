import { parseProject, type Layer, type Project } from './project-schema';

/**
 * A compact, always-valid default project used as a programmatic fallback (the
 * full hardware kit + topology ships as `apps/server/projects/default.json`, U11).
 * Density is modest and the DMX map is left flat so this never depends on a wiring
 * topology; the starter composition exercises base / trigger / effect layers.
 */
export function defaultProject(): Project {
  const drum = (
    id: string,
    label: string,
    color: string,
    diameterIn: number,
    origin: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number },
  ) => ({
    id,
    label,
    color,
    diameterIn,
    hoopSpacingMm: 60,
    localSpinDeg: 270,
    startAngleDeg: 0,
    origin,
    rotation,
  });

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

  return parseProject({
    name: 'LEDrums Default',
    kit: {
      version: 1,
      units: 'mm',
      global: { ledDensityPxPerM: 30, hoopCount: 4, defaultHoopSpacingMm: 60, maxPixelsPerOutput: 4096 },
      drums: [
        drum('kick', 'Kick', '#5bbcff', 21, { x: 0, y: 0, z: 0 }, { x: 90, y: 0, z: 0 }),
        drum('snare', 'Snare', '#72d572', 12, { x: -200, y: 400, z: 250 }, { x: 180, y: 0, z: 0 }),
        drum('tom1', 'Tom 1', '#ff8e72', 12, { x: -100, y: 50, z: 400 }, { x: 165, y: 0, z: 4 }),
        drum('tom2', 'Tom 2', '#d69cff', 15, { x: 350, y: 400, z: 150 }, { x: 180, y: 0, z: 0 }),
      ],
      outputs: [],
    },
    composition: {
      layers,
      transport: { bpm: 120, playing: true, beatsPerBar: 4 },
    },
    inputMap: {
      midiNotes: [
        { note: 36, drumId: 'kick', trigger: { layerId: 'trigger', clipId: 'whole-drum' } },
        { note: 38, drumId: 'snare', trigger: { layerId: 'trigger', clipId: 'chase' } },
        { note: 48, drumId: 'tom1' },
        { note: 45, drumId: 'tom2' },
      ],
      volumeOscAddress: '/ledrums/volume',
      oscTriggers: [],
    },
    output: { state: 'disabled', protocol: 'artnet', host: '255.255.255.255', rgbOrder: 'RGB', fps: 44 },
  });
}
