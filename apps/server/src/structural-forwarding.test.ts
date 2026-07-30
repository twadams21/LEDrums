import { describe, expect, it } from 'vitest';
import { defaultProject, type InputMap, type NodeLayout, type OutputConfig, type Project } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { applyStructuralMessage } from './handlers/voice-input';
import { OutputManager } from './output-manager';
import { VoiceEngineHost } from './voice-engine-host';
import type { ClientMessage } from './ws-protocol';

/**
 * INIT-01 S12 — the RETIRED PARITY HARNESS, migrated.
 *
 * engine-parity.test.ts (S2) existed because TWO reducers wrote the live Project and nothing
 * asserted they agreed: it drove every structural discriminant the shipped client sends through
 * both stacks and deep-compared the results. S8 collapsed them to one, and S12 deletes the legacy
 * arm that was the other half of the comparison — so a differential harness has nothing left to
 * differ against.
 *
 * The coverage survives here, re-pointed at the sole reducer. Every discriminant the parity harness
 * covered is covered below, and the file keeps the two properties that made that harness worth
 * having:
 *
 *   FULL-FIELD FIXTURES — every message is a full-field literal whose values all differ from the
 *   default project's, and each case asserts the resulting Project field-by-field. The historical
 *   `pixelsPerHoop` drop survived for months precisely because no fixture ever set that field; a
 *   partial fixture is how this bug class hides from its own regression test.
 *
 *   NON-VACUITY — each case asserts state actually MOVED (`not.toEqual(pristine)`), and a final
 *   guard drives every discriminant through the reducer and asserts each one reports itself
 *   structural. A silently-deleted arm returns `false`, which since S8 means "no state broadcast,
 *   no autosave" — so the return value is load-bearing and is asserted, not assumed.
 *
 * The one KNOWN DRIFT the parity harness recorded — `setKitOutputs` has no legacy arm, so a patch
 * rewire was a no-op in legacy mode while the server still broadcast `state` and marked the
 * autosaver dirty, persisting the UNCHANGED topology — is REPAIRED by this deletion rather than
 * recorded: the voice arm is now the only writer, and its case below asserts the rewire lands.
 */

/** An inert pixel sink: nothing here arms output, and a real UDP socket in a unit test is a flake. */
class NoOutput implements PixelOutput {
  nextFrame(): void {}
  send(): void {}
  close(): void {}
}

/** A host over a fresh default project, plus that project (the observable — the host mutates it). */
function store(): { host: VoiceEngineHost; project: Project; pristine: Project } {
  const project = defaultProject();
  const host = new VoiceEngineHost(project, null, new OutputManager(() => new NoOutput()));
  return { host, project, pristine: defaultProject() };
}

/** Drive one message through THE reducer and hand back the mutated project + the reducer's verdict. */
function drive(msg: ClientMessage): { project: Project; pristine: Project; structural: boolean } {
  const { host, project, pristine } = store();
  expect(project).toEqual(pristine); // precondition: the fixture starts from a known state
  const structural = applyStructuralMessage(host, msg);
  return { project, pristine, structural };
}

// --- full-field fixtures (every optional field set, every value != the default) ----------------

const FULL_TRANSFORM = {
  t: 'setKitTransform',
  drumId: 'kick',
  origin: { x: 11, y: 22, z: 33 },
  rotation: { x: 1, y: 2, z: 3 },
  localSpinDeg: 90,
  startAngleDeg: 15,
  pixelsPerHoop: 200,
  hoopSpacingMm: 45,
  diameterIn: 22,
  flip: true,
  color: '#ff8800',
} as const satisfies ClientMessage;

const FULL_KIT_GLOBAL = {
  t: 'setKitGlobal',
  expanded: true,
  ledDensityPxPerM: 72,
  hoopCount: 5,
  defaultHoopSpacingMm: 45,
  maxPixelsPerOutput: 300,
} as const satisfies ClientMessage;

const FULL_HOOP_CONFIG = {
  t: 'setHoopConfig',
  drumId: 'snare',
  hoopIndex: 2,
  pixelCount: 144,
  reverse: true,
} as const satisfies ClientMessage;

const FULL_NODE_LAYOUT: NodeLayout = {
  'output:1': { x: 40, y: 120 },
  'hoop:kick:1': { x: 360, y: 120 },
};

const FULL_OUTPUTS: OutputConfig[] = [
  {
    id: 'o1',
    startUniverse: 3,
    channelsPerPixel: 3,
    rgbOrder: 'GRB',
    segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 2 }],
  },
];

const FULL_OUTPUT_SETTINGS = {
  t: 'setOutput',
  state: 'armed',
  protocol: 'sacn',
  host: '10.0.0.5',
  rgbOrder: 'GRB',
  fps: 30,
  broadcast: true,
  priority: 120,
  port: 6454,
  iface: 'en0',
} as const satisfies ClientMessage;

const FULL_INPUT_MAP: InputMap = {
  midiChannel: 3,
  midiNotes: [{ note: 41, drumId: 'tom1', slot: 1 }],
  oscMap: [{ address: '/parity/kick', drumId: 'kick', slot: 2 }],
  zones: [{ drumId: 'tom2', slot: 3 }],
  volumeOscAddress: '/parity/volume',
};

const FULL_TRANSPORT = {
  t: 'setTransport',
  bpm: 137,
  playing: false,
  beatsPerBar: 7,
} as const satisfies ClientMessage;

/** Every discriminant the retired parity harness covered — the completeness list. */
const EVERY_DISCRIMINANT: ClientMessage[] = [
  FULL_TRANSFORM,
  FULL_KIT_GLOBAL,
  FULL_HOOP_CONFIG,
  { t: 'setKitNodeLayout', nodeLayout: FULL_NODE_LAYOUT },
  { t: 'setKitOutputs', outputs: FULL_OUTPUTS },
  FULL_OUTPUT_SETTINGS,
  { t: 'setInputMap', inputMap: FULL_INPUT_MAP },
  FULL_TRANSPORT,
];

describe('structural forwarding — every live discriminant lands on the sole store', () => {
  it('setKitTransform: all NINE transform fields land (S5 closed the hoopSpacingMm + diameterIn drop)', () => {
    const { project, pristine } = drive(FULL_TRANSFORM);

    expect(project).not.toEqual(pristine);
    const kick = project.kit.drums.find((d) => d.id === 'kick')!;
    expect(kick.origin).toEqual({ x: 11, y: 22, z: 33 });
    expect(kick.rotation).toEqual({ x: 1, y: 2, z: 3 });
    expect(kick.localSpinDeg).toBe(90);
    expect(kick.startAngleDeg).toBe(15);
    // The field whose months-long drop is the reason this fixture is full-field.
    expect(kick.pixelsPerHoop).toBe(200);
    expect(kick.hoopSpacingMm).toBe(45);
    expect(kick.diameterIn).toBe(22);
    expect(kick.flip).toBe(true);
    expect(kick.color).toBe('#ff8800');
  });

  it('setKitGlobal: the kit-global fields land AND the expanded-mode output reconcile runs', () => {
    const { project, pristine } = drive(FULL_KIT_GLOBAL);

    expect(project).not.toEqual(pristine);
    expect(project.kit.global).toMatchObject({
      expanded: true, ledDensityPxPerM: 72, hoopCount: 5, defaultHoopSpacingMm: 45, maxPixelsPerOutput: 300,
    });
    // `expanded: true` also reconciles the port set from 0 to the expanded count — so this fixture
    // proves a derived rebuild, not just a field write.
    expect(project.kit.outputs.length).toBeGreaterThan(0);
  });

  it('setHoopConfig: the per-hoop pixel count + reverse flag land at hoops[hoopIndex-1] (1-based)', () => {
    const { project, pristine } = drive(FULL_HOOP_CONFIG);

    expect(project).not.toEqual(pristine);
    expect(project.kit.drums.find((d) => d.id === 'snare')!.hoops![1]).toEqual({ pixelCount: 144, reverse: true });
  });

  it('setKitNodeLayout: the patch-graph canvas layout lands', () => {
    const { project, pristine } = drive({ t: 'setKitNodeLayout', nodeLayout: FULL_NODE_LAYOUT });

    expect(project).not.toEqual(pristine);
    expect(project.kit.nodeLayout).toEqual(FULL_NODE_LAYOUT);
  });

  it('setKitOutputs: the rewire lands — the KNOWN DRIFT the parity harness recorded is now repaired', () => {
    const { project, pristine } = drive({ t: 'setKitOutputs', outputs: FULL_OUTPUTS });

    // Under the two-reducer shape the legacy arm did NOT exist (no `Engine.setKitOutputs` to call),
    // so in legacy mode a rewire changed nothing while the server still broadcast `state` and
    // persisted the UNCHANGED topology. One writer, one outcome.
    expect(project).not.toEqual(pristine);
    expect(project.kit.outputs.length).toBeGreaterThan(0);
    expect(project.kit.outputs[0]).toMatchObject({ id: 'o1', startUniverse: 3, rgbOrder: 'GRB', segments: FULL_OUTPUTS[0]!.segments });
  });

  it('setOutput: all nine output settings land, including the protocol flip', () => {
    const { project, pristine } = drive(FULL_OUTPUT_SETTINGS);

    expect(project).not.toEqual(pristine);
    expect(project.output).toEqual({
      state: 'armed',
      protocol: 'sacn',
      host: '10.0.0.5',
      rgbOrder: 'GRB',
      fps: 30,
      broadcast: true,
      priority: 120,
      port: 6454,
      iface: 'en0',
    });
  });

  it('setInputMap: the whole input map lands (incl. declared zones + volume address)', () => {
    const { project, pristine } = drive({ t: 'setInputMap', inputMap: FULL_INPUT_MAP });

    expect(project).not.toEqual(pristine);
    expect(project.inputMap).toEqual(FULL_INPUT_MAP);
  });

  it('setTransport: the transport edit lands (S5 gave the voice host its transport writer)', () => {
    const { project, pristine } = drive(FULL_TRANSPORT);

    expect(project).not.toEqual(pristine);
    expect(project.composition.transport).toEqual({ bpm: 137, playing: false, beatsPerBar: 7 });
  });
});

describe('structural forwarding — the suite is not vacuous', () => {
  /**
   * The permanent form of "delete an arm, confirm red". Since S8 the reducer's boolean return IS the
   * broadcast-and-persist signal, so a silently-removed arm degrades to a no-op that neither reaches
   * the wire nor the disk. Both halves are asserted per discriminant: the verdict is `true`, and the
   * project actually moved.
   */
  it.each(EVERY_DISCRIMINANT.map((m) => [m.t, m] as const))('%s reports itself structural AND moves state', (_t, msg) => {
    const { project, pristine, structural } = drive(msg);
    expect(structural).toBe(true);
    expect(project).not.toEqual(pristine);
  });

  it('covers every discriminant the retired parity harness covered — no silent narrowing', () => {
    // The completeness gate for the migration: engine-parity.test.ts drove exactly these eight
    // (seven agreeing + setKitOutputs as recorded drift). A narrowed suite is how coverage is lost
    // during a deletion, so the count is asserted rather than eyeballed in review.
    expect(new Set(EVERY_DISCRIMINANT.map((m) => m.t))).toEqual(new Set([
      'setKitTransform', 'setKitGlobal', 'setHoopConfig', 'setKitNodeLayout',
      'setKitOutputs', 'setOutput', 'setInputMap', 'setTransport',
    ]));
  });

  it('a non-structural message is NOT reported structural (the default arm still means no-op)', () => {
    const { host } = store();
    for (const msg of [
      { t: 'listProjects' },
      { t: 'takeover' },
      { t: 'midi', note: 38, velocity: 100, on: true },
    ] as ClientMessage[]) {
      expect(applyStructuralMessage(host, msg), `${msg.t} must not be structural`).toBe(false);
    }
  });
});
