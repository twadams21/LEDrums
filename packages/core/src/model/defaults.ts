import { parseKit, type KitConfig } from '../geometry/kit-schema';
import { CURRENT_KIT_VERSION } from '../geometry/kit-migrations';
import { assertProjectIntegrity } from './integrity';
import { parseProject, type Project } from './project-schema';

const HOOP_COUNT = 4;

const drum = (
  id: string,
  label: string,
  color: string,
  diameterIn: number,
  /** Literal LED count per hoop — the authoritative count for the physical rig
      (docs/kit-hoop-pixel-counts.md); every hoop on a drum shares it. */
  pixelsPerHoop: number,
  /** The drum's GEOMETRIC CENTRE (B3) — the midpoint of the hoop stack, NOT the first hoop. */
  origin: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number },
) => ({
  id,
  label,
  color,
  diameterIn,
  hoopSpacingMm: 60,
  pixelsPerHoop,
  /** First-class hoops (B4): every hoop on this drum carries the same literal count. */
  hoops: Array.from({ length: HOOP_COUNT }, () => ({ pixelCount: pixelsPerHoop, reverse: false })),
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
 *
 * Authored at {@link CURRENT_KIT_VERSION} in fully-resolved form: origins are geometric
 * centres (B3) and hoops are explicit (B4). It used to be authored at v3 and reach that form
 * through the migration ladder on every import; the ladder was deleted (Decision 6), so the
 * resolved values are now written here directly — byte-identical to what the ladder produced.
 */
export const DEFAULT_KIT: KitConfig = parseKit({
  version: CURRENT_KIT_VERSION,
  units: 'mm',
  global: { ledDensityPxPerM: 30, hoopCount: HOOP_COUNT, defaultHoopSpacingMm: 60, maxPixelsPerOutput: 4096, expanded: false },
  drums: [
    drum('kick', 'Kick', '#5bbcff', 21, 196, { x: 0, y: 340, z: 330 }, { x: 90, y: 0, z: 0 }),
    drum('snare', 'Snare', '#72d572', 12, 108, { x: -230, y: 0, z: 740 }, { x: 0, y: 0, z: 0 }),
    // The rotated drum's centre is irrational in y/z — these are the exact values the v3→v4
    // origin migrator produced from the historical first-hoop anchor (-120, 300, 840) at
    // rotation (18, 0, 4), preserved to the last bit so the kit's geometry did not move when
    // the ladder was deleted. Verified by DMX byte-parity against the pre-collapse build.
    drum('tom1', 'Tom 1', '#ff8e72', 12, 108, { x: -120, y: 272.18847050625476, z: 925.5950864665638 }, { x: 18, y: 0, z: 4 }),
    drum('tom2', 'Tom 2', '#d69cff', 15, 136, { x: 360, y: 40, z: 710 }, { x: 0, y: 0, z: 0 }),
  ],
  outputs: [],
});

/**
 * A compact, always-valid default project used as a programmatic fallback (the
 * full hardware kit + topology ships as `apps/server/projects/default.json`, U11).
 * Density is modest and the DMX map is left flat so this never depends on a wiring topology.
 *
 * Decision 2 (11-decisions.md) removed the `composition` + `setlist` slices from the Project, so
 * this no longer seeds a starter layer stack or a demo setlist — building them here would be
 * constructing objects `parseProject` strips on the way in. Authored content lives in the voice-bus
 * Show, seeded separately.
 */
export function defaultProject(): Project {
  const project = parseProject({
    name: 'LEDrums Default',
    kit: DEFAULT_KIT,
    transport: { bpm: 120, playing: true, beatsPerBar: 4 },
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
    output: { state: 'disabled', protocol: 'artnet', host: '255.255.255.255', rgbOrder: 'RGB', fps: 44 },
  });
  // Fail loudly if the canonical default ever references a drum its kit doesn't define.
  assertProjectIntegrity(project);
  return project;
}
