import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { audioMessage, buildWorkload, emptyShow, fingerprint, midiMessages, workloadEffects, WORKLOAD_VERSION } from './workload.mjs';
import { stateFixture } from './fixtures.test-support.mjs';

test('synthetic Effect-model show is deterministic, bounded, kit-derived and leaves project/library bytes unchanged', () => {
  const state = stateFixture();
  const before = JSON.stringify(state);
  const a = buildWorkload(state, 8);
  assert.deepEqual(a, buildWorkload(state, 8));
  assert.equal(JSON.stringify(state), before);
  assert.equal(a.show.songs.length, 1);
  assert.equal(a.show.songs[0].sections.length, 1);
  assert.deepEqual(a.show.songs[0].sections[0].master, []);
  const effects = workloadEffects(a.show);
  assert.equal(effects.length, 8);
  assert.equal(new Set(effects.map((e) => e.id)).size, 8);
  assert.deepEqual(a.sources.map((s) => s.drumId), ['kick', 'snare']);
  // Lanes round-robin over the kit sources: each lives in its source drum's zone cell.
  assert.deepEqual(effects.map((e) => e.cell), effects.map((_, i) => ({
    row: ['kick', 'snare'][i % 2], column: { kind: 'zone', slot: 0 },
  })));
  assert.deepEqual(effects.map((e) => e.controls[0].settings.band),
    ['level', 'bass', 'mids', 'highs', 'level', 'bass', 'mids', 'highs']);
  for (const [i, effect] of effects.entries()) {
    assert.deepEqual(effect.trigger, { kind: 'zone' });
    assert.equal(effect.retrigger, 'restart');
    assert.equal(effect.amp.length, 'loop');
    assert.deepEqual(effect.target, { kind: 'kit' });
    assert.equal(effect.generator.kind, 'wave');
    assert.equal(effect.generator.style, 'field');
    assert.equal(effect.generator.params.hue, (i * 47) % 360);
    assert.equal(effect.generator.params.brightness, 0.7);
    assert.equal(effect.generator.params.disturbance, 1);
    assert.equal(effect.generator.params.lifeMs, 1500);
    assert.equal(effect.generator.params.scale, 1.4, 'unlisted params keep the advertised defaults');
    assert.equal(effect.controls.length, 1);
    assert.equal(effect.controls[0].kind, 'audio');
    assert.deepEqual(effect.controls[0].mappings, [
      { device: 'generator', param: 'brightness', amount: 1, invert: false, rangeMin: 0.25, rangeMax: 0.9 },
    ]);
  }
  assert.equal(a.metadata.version, WORKLOAD_VERSION);
  assert.equal(a.metadata.showSha256, fingerprint(a.show));
  assert.equal(a.metadata.kitSha256, fingerprint(state.project.kit));
  assert.equal(a.metadata.inputMapSha256, fingerprint(state.project.inputMap));
  assert.equal(workloadEffects(buildWorkload(state, 1).show).length, 1);
  assert.equal(workloadEffects(buildWorkload(state, 32).show).length, 32);
  assert.throws(() => buildWorkload(state, 0));
  assert.throws(() => buildWorkload(state, 33));
});

test('global controls are never fired, duplicate MIDI mappings preserve host first-match precedence', () => {
  const state = stateFixture();
  state.project.inputMap.globalControls = { transmitToggle: { midiNote: 36 } };
  state.project.inputMap.midiNotes.push({ note: 36, drumId: 'snare', slot: 1 });
  const workload = buildWorkload(state, 4);
  assert.deepEqual(workload.sources.map((s) => s.note), [38]);
  assert.ok(midiMessages(workload, 0).every((m) => m.note === 38));
  assert.ok(workloadEffects(workload.show).every((e) => e.cell.row === 'snare' && e.cell.column.slot === 0));
  state.project.inputMap.globalControls.tapTempo = { midiNote: 38 };
  assert.throws(() => buildWorkload(state), /not reserved/);
});

test('selected MIDI channel is respected; sequence-indexed messages are deterministic, bounded and synthetic', () => {
  const state = stateFixture();
  state.project.inputMap.midiChannel = 7;
  const workload = buildWorkload(state, 3);
  for (let i = 0; i < 240; i++) {
    assert.deepEqual(audioMessage(i), audioMessage(i + 240));
    for (const [key, value] of Object.entries(audioMessage(i))) {
      if (key !== 't') assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
    }
    for (const m of midiMessages(workload, i)) {
      assert.equal(m.channel, 7);
      assert.ok(m.velocity >= 0 && m.velocity <= 127);
      assert.equal(m.on, m.velocity > 0);
    }
  }
});

test('fixture passes the protocol Show gate, follows the real host MIDI/audio path and renders the requested voice count without IO', async () => {
  // Existing server tsx loader, no install or server process. This is a tiny deterministic
  // behavior test (fixed ticks, no wall-duration assertions), NOT a performance measurement.
  const serverRequire = createRequire(new URL('../../apps/server/package.json', import.meta.url));
  const { tsImport } = await import(pathToFileURL(serverRequire.resolve('tsx/esm/api')).href);
  const { defaultProject } = await tsImport('../../packages/core/src/index.ts', import.meta.url);
  const { VoiceEngineHost } = await tsImport('../../apps/server/src/voice-engine-host.ts', import.meta.url);
  const { OutputManager } = await tsImport('../../apps/server/src/output-manager.ts', import.meta.url);
  const { effectSpecs, serializeModel, decodeClient } = await tsImport('../../apps/server/src/ws-protocol.ts', import.meta.url);
  const { handleVoiceInput } = await tsImport('../../apps/server/src/handlers/voice-input.ts', import.meta.url);
  const project = defaultProject();
  project.output.state = 'disabled';
  const host = new VoiceEngineHost(project, null, new OutputManager(() => { throw new Error('No physical output in unit tests'); }));
  try {
    const state = { project, model: serializeModel(host.getModel()), effects: effectSpecs() };
    const workload = buildWorkload(state, 8);
    const pads = new Set(workloadEffects(workload.show).map((e) => `effect:${e.id}`));
    // decodeClient is the protocol gate: it refuses a non-canonical Effect, so this throws if
    // the workload drifts from core's effectSchema.
    const forward = (message) => assert.equal(handleVoiceInput(decodeClient(JSON.stringify(message)), {
      voiceHost: host, viewer: false, broadcastJson: () => {},
    }), true);
    const drifted = structuredClone(workload.show);
    delete workloadEffects(drifted)[0].blend;
    assert.throws(() => decodeClient(JSON.stringify({ t: 'setShow', show: drifted })), /Invalid setShow/);
    const lit = () => host.engine.frame().some((value, i) => i % 4 !== 3 && value > 0);
    forward({ t: 'setShow', show: workload.show });
    for (let burst = 0; burst < 4; burst++) {
      forward(audioMessage(burst));
      for (const message of midiMessages(workload, burst)) forward(message);
      host.step(1000 / 120);
      const stats = host.getStats().engine;
      // Retrigger `restart` releases each lane's previous voice, and core enforces a minimum
      // release ramp even with releaseMs 0: the outgoing lanes overlap briefly, then retire
      // instead of accumulating endless loops on every burst.
      assert.equal(stats.voiceCount, burst === 0 ? 8 : 16);
      assert.equal(stats.voices.filter((v) => v.releasing).length, burst === 0 ? 0 : 8);
      assert.ok(stats.voices.every((v) => pads.has(v.pad)), 'every live voice belongs to a workload Effect');
      for (let i = 0; i < 10; i++) host.step(1000 / 120);
      assert.equal(host.getStats().engine.voiceCount, 8);
      assert.ok(lit());
      assert.equal(host.getOutputStatus().state, 'disabled');
    }
    // A nonzero mapping floor could hide a dropped audio route. Remove it for this assertion:
    // default-source public audioFeatures must change actual rendered RGB from dark to lit.
    const audioOnly = structuredClone(workload.show);
    for (const effect of workloadEffects(audioOnly)) {
      for (const control of effect.controls) for (const mapping of control.mappings) mapping.rangeMin = 0;
    }
    forward({ t: 'setShow', show: audioOnly });
    for (const message of midiMessages(workload, 0)) forward(message);
    for (let i = 0; i < 4; i++) host.step(1000 / 120);
    assert.equal(host.getStats().engine.voiceCount, 8, 'the audio-only lanes are playing');
    assert.equal(lit(), false);
    forward({ t: 'audioFeatures', level: 1, bass: 1, mids: 1, highs: 1 });
    host.step(1000 / 120);
    assert.ok(lit());
    // The driver's cleanup Show passes the same gate and silences the workload.
    forward({ t: 'setShow', show: emptyShow() });
    for (let i = 0; i < 10; i++) host.step(1000 / 120);
    assert.equal(host.getStats().engine.voiceCount, 0);
  } finally { await host.stop(); }
});
