import { describe, expect, it } from 'vitest';
import { defaultProject, Engine, type InputMap, type NodeLayout, type OutputConfig, type Project } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { applyStructuralMessage } from './handlers/voice-input';
import { applyClientMessage } from './input-router';
import { OutputManager } from './output-manager';
import { VoiceEngineHost } from './voice-engine-host';
import type { ClientMessage } from './ws-protocol';

/**
 * INIT-01 S2 — the DIFFERENTIAL PARITY HARNESS.
 *
 * Two reducers write the live Project today: the legacy `applyClientMessage(engine, …)` and the
 * voice-side reducer `applyStructuralMessage(voiceHost, …)` (named `propagateToVoiceHost` until S8 made it the only one). Every structural client edit runs through
 * BOTH (divergent-change-0001), and where their arms disagree the live state silently splits —
 * exactly how `pixelsPerHoop` was dropped on one path for months.
 *
 * This file drives every structural discriminant the SHIPPED CLIENT actually sends through both
 * stacks against two independent `defaultProject()` clones and asserts the resulting Projects are
 * deep-equal. Where they disagree TODAY the divergence is asserted EXPLICITLY under a
 * `KNOWN DRIFT` comment, so the harness lands green while recording the truth instead of hiding
 * it. It is the evidence gate that licenses the later deletions (S8/S11/S12/S13): no arm may be
 * removed until its behaviour is pinned here.
 *
 * Discriminant list verified by grep against apps/web/src (`t: 'set…'` sends), NOT by reading the
 * protocol union. (The union USED to carry fourteen further structural messages no client sent;
 * S11 deleted them and their reducer arms together.) The set driven here:
 *   setKitTransform · setKitGlobal · setHoopConfig · setKitNodeLayout · setKitOutputs ·
 *   setOutput · setInputMap · setTransport
 *
 * FIXTURE RULE: every message is built from a FULL-FIELD literal with values that differ from the
 * default project's, and each case asserts the fixture actually MOVED state. The historical
 * `pixelsPerHoop` drop survived precisely because no fixture ever set that field — a partial
 * fixture is how this class of bug hides from its own regression test.
 *
 * TEMPORARY SCAFFOLDING: S12 retires this file, migrating the per-discriminant assertions onto
 * the sole surviving reducer (structural-forwarding.test.ts). Named here so that deletion step
 * can be edit-free.
 */

/** An inert pixel sink: the harness never arms output, and a real UDP socket inside a unit test
 *  is a flake waiting to happen. */
class NoOutput implements PixelOutput {
  nextFrame(): void {}
  send(): void {}
  close(): void {}
}

/** Two INDEPENDENT clones of the same project, one behind each stack. Both hosts mutate the
 *  project object they were handed, so the two clones are the observable under test. */
function bothStacks(): { pA: Project; pB: Project; legacy: Engine; voiceHost: VoiceEngineHost } {
  const pA = defaultProject();
  const pB = defaultProject();
  const legacy = new Engine(pA);
  const voiceHost = new VoiceEngineHost(pB, null, new OutputManager(() => new NoOutput()));
  return { pA, pB, legacy, voiceHost };
}

/**
 * Drive one message through both reducers and hand back the two Projects. Asserts the clones are
 * identical BEFORE the message: without that precondition a later "they agree" assertion could be
 * passing on state the two CONSTRUCTORS happened to write, not on reducer parity.
 */
function drive(msg: ClientMessage): { pA: Project; pB: Project; pristine: Project } {
  const { pA, pB, legacy, voiceHost } = bothStacks();
  expect(pA).toEqual(pB);
  applyClientMessage(legacy, msg, 0);
  applyStructuralMessage(voiceHost, msg);
  return { pA, pB, pristine: defaultProject() };
}

// --- full-field fixtures (every optional field set, every value != the default) --------------

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

// --- discriminants that agree today ---------------------------------------------------------

describe('engine parity — structural discriminants both reducers agree on', () => {
  it('setKitGlobal: kit-global fields + the expanded-mode output reconcile land identically', () => {
    const { pA, pB, pristine } = drive(FULL_KIT_GLOBAL);

    // Non-vacuity: the fixture moved real state on BOTH paths (expanded:true also reconciles the
    // port set from 0 to the expanded count, so this is not a single-field write).
    expect(pA).not.toEqual(pristine);
    expect(pB).not.toEqual(pristine);
    expect(pA.kit.global).toMatchObject({ expanded: true, ledDensityPxPerM: 72, hoopCount: 5, defaultHoopSpacingMm: 45, maxPixelsPerOutput: 300 });
    expect(pA.kit.outputs.length).toBeGreaterThan(0);

    expect(pA).toEqual(pB);
  });

  it('setHoopConfig: the per-hoop pixel count + reverse flag land identically', () => {
    const { pA, pB, pristine } = drive(FULL_HOOP_CONFIG);

    expect(pA).not.toEqual(pristine);
    expect(pB).not.toEqual(pristine);
    expect(pA.kit.drums.find((d) => d.id === 'snare')!.hoops![1]).toEqual({ pixelCount: 144, reverse: true });

    expect(pA).toEqual(pB);
  });

  it('setKitNodeLayout: the patch-graph canvas layout lands identically', () => {
    const { pA, pB, pristine } = drive({ t: 'setKitNodeLayout', nodeLayout: FULL_NODE_LAYOUT });

    expect(pA).not.toEqual(pristine);
    expect(pB).not.toEqual(pristine);
    expect(pA.kit.nodeLayout).toEqual(FULL_NODE_LAYOUT);

    expect(pA).toEqual(pB);
  });

  it('setOutput: all nine output settings (incl. the protocol flip) land identically', () => {
    const { pA, pB, pristine } = drive(FULL_OUTPUT_SETTINGS);

    expect(pA).not.toEqual(pristine);
    expect(pB).not.toEqual(pristine);
    expect(pA.output).toEqual({
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

    expect(pA).toEqual(pB);
  });

  it('setInputMap: the whole input map (incl. declared zones + volume address) lands identically', () => {
    const { pA, pB, pristine } = drive({ t: 'setInputMap', inputMap: FULL_INPUT_MAP });

    expect(pA).not.toEqual(pristine);
    expect(pB).not.toEqual(pristine);
    expect(pA.inputMap).toEqual(FULL_INPUT_MAP);

    expect(pA).toEqual(pB);
  });

  it('setKitTransform: all NINE transform fields land identically (S5 closed the hoopSpacingMm + diameterIn drop)', () => {
    const { pA, pB, pristine } = drive(FULL_TRANSFORM);

    expect(pA).not.toEqual(pristine);
    expect(pB).not.toEqual(pristine);

    // The two fields the voice arm used to drop, now asserted on BOTH sides by name — a re-drop
    // would fail here as well as in the whole-Project comparison below.
    const drumB = pB.kit.drums.find((d) => d.id === 'kick')!;
    expect(drumB.hoopSpacingMm).toBe(FULL_TRANSFORM.hoopSpacingMm);
    expect(drumB.diameterIn).toBe(FULL_TRANSFORM.diameterIn);

    expect(pA).toEqual(pB);
  });

  it('setTransport: the transport edit lands identically (S5 gave the voice host a transport writer)', () => {
    const { pA, pB, pristine } = drive(FULL_TRANSPORT);

    expect(pA).not.toEqual(pristine);
    expect(pB).not.toEqual(pristine);
    expect(pB.composition.transport).toEqual({ bpm: 137, playing: false, beatsPerBar: 7 });

    expect(pA).toEqual(pB);
  });
});

// --- the drift that survives this chunk ------------------------------------------------------

describe('engine parity — KNOWN DRIFT (recorded, not hidden)', () => {
  it('setKitOutputs: the LEGACY reducer has no arm — output rewiring is a no-op in legacy mode', () => {
    const { pA, pB, pristine } = drive({ t: 'setKitOutputs', outputs: FULL_OUTPUTS });

    // KNOWN DRIFT — this one drifts the OTHER way, and S5 does NOT close it. `applyClientMessage`
    // has no `setKitOutputs` case (there is no `Engine.setKitOutputs` to call), so in legacy mode a
    // patch rewire changes nothing at all: the server still broadcasts `state` and marks the
    // autosaver dirty, persisting the UNCHANGED topology. Only the voice host applies it. Recorded
    // here rather than repaired because the fix is the initiative itself — S12 deletes the legacy
    // reducer, leaving the voice arm as the sole writer.
    expect(pA.kit.outputs).toEqual(pristine.kit.outputs);
    expect(pB.kit.outputs.length).toBeGreaterThan(0);
    expect(pB.kit.outputs[0]).toMatchObject({ id: 'o1', startUniverse: 3, rgbOrder: 'GRB', segments: FULL_OUTPUTS[0]!.segments });

    pA.kit.outputs = pB.kit.outputs;
    expect(pA).toEqual(pB);
  });
});

// --- anti-vacuity: the comparison must be able to FAIL ---------------------------------------

describe('engine parity — the harness is not vacuous', () => {
  /**
   * A harness that passes against a gutted arm proves nothing. The manual form of this check is
   * "delete a case from the voice reducer, confirm red, restore" (done at S2, recorded in the
   * commit body). This is its PERMANENT form: drive each agreeing discriminant through the legacy
   * stack ONLY and assert the projects diverge — i.e. every fixture moves state the deep-equal
   * comparison can see, so a silently-missing voice arm cannot pass.
   */
  const agreeing: ClientMessage[] = [
    FULL_KIT_GLOBAL,
    FULL_HOOP_CONFIG,
    { t: 'setKitNodeLayout', nodeLayout: FULL_NODE_LAYOUT },
    FULL_OUTPUT_SETTINGS,
    { t: 'setInputMap', inputMap: FULL_INPUT_MAP },
    FULL_TRANSFORM,
    FULL_TRANSPORT,
  ];

  for (const msg of agreeing) {
    it(`${msg.t}: skipping the voice arm makes the Projects diverge`, () => {
      const { pA, pB, legacy } = bothStacks();
      applyClientMessage(legacy, msg, 0);
      // The voice reducer deliberately NOT called — this is the gutted-arm simulation.
      expect(pA).not.toEqual(pB);
    });
  }
});
