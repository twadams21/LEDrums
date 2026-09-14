import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { audioMessage, buildWorkload, midiMessages } from './workload.mjs';
import { stateFixture } from './fixtures.test-support.mjs';

test('synthetic show is deterministic, bounded, kit-derived and leaves project/library bytes unchanged', () => {
  const state = stateFixture();
  const before = JSON.stringify(state);
  const a = buildWorkload(state, 8);
  assert.deepEqual(a, buildWorkload(state, 8));
  assert.equal(JSON.stringify(state), before);
  assert.equal(a.show.effects.length, 8);
  assert.equal(a.show.buses.length, 8);
  assert.ok(a.show.buses.every((bus) => bus.polyphony === 'mono' && bus.crossfadeMs === 0));
  assert.equal(Object.keys(a.show.graphs).length, 2);
  assert.deepEqual(a.sources.map((s) => s.drumId), ['kick', 'snare']);
  for (const graph of Object.values(a.show.graphs)) {
    assert.equal(graph.version, 3);
    for (const effect of graph.nodes.filter((n) => n.kind === 'effect')) {
      assert.ok(graph.edges.some((e) => e.from === effect.id && e.to === 'output'));
      assert.ok(graph.edges.some((e) => e.to === effect.id && e.toPort === 'param:brightness'));
      assert.equal(effect.mode, 'loop');
    }
  }
  assert.throws(() => buildWorkload(state, 33));
});

test('global controls are never fired, duplicate MIDI mappings preserve host first-match precedence', () => {
  const state = stateFixture();
  state.project.inputMap.globalControls = { transmitToggle: { midiNote: 36 } };
  state.project.inputMap.midiNotes.push({ note: 36, drumId: 'snare', slot: 1 });
  const workload = buildWorkload(state, 4);
  assert.deepEqual(workload.sources.map((s) => s.note), [38]);
  assert.ok(midiMessages(workload, 0).every((m) => m.note === 38));
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

test('fixture follows the real server host MIDI/audio path and renders the requested voice count without IO', async () => {
  // Existing server tsx loader, no install or server process. This is a tiny deterministic
  // behavior test (49 ticks, no wall-duration assertions), NOT a performance measurement.
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
    const forward = (message) => assert.equal(handleVoiceInput(decodeClient(JSON.stringify(message)), {
      voiceHost: host, viewer: false, broadcastJson: () => {},
    }), true);
    forward({ t: 'setShow', show: workload.show });
    for (let burst = 0; burst < 4; burst++) {
      forward(audioMessage(burst));
      for (const message of midiMessages(workload, burst)) forward(message);
      host.step(1000 / 120);
      // Core enforces a minimum release ramp even with crossfadeMs=0: previous lanes
      // overlap briefly, but retire instead of accumulating endless loops on every burst.
      assert.equal(host.getStats().engine.voiceCount, burst === 0 ? 8 : 16);
      for (let i = 0; i < 10; i++) host.step(1000 / 120);
      assert.equal(host.getStats().engine.voiceCount, 8);
      assert.ok(host.engine.frame().some((value, i) => i % 4 !== 3 && value > 0));
      assert.equal(host.getOutputStatus().state, 'disabled');
    }
    // A nonzero mapping floor could hide a dropped audio route. Remove it for this assertion:
    // default-source public audioFeatures must change actual rendered RGB from dark to lit.
    const audioOnly = structuredClone(workload.show);
    for (const graph of Object.values(audioOnly.graphs)) {
      for (const edge of graph.edges) if (edge.toPort === 'param:brightness') edge.rangeMin = 0;
    }
    forward({ t: 'setShow', show: audioOnly });
    for (const message of midiMessages(workload, 0)) forward(message);
    for (let i = 0; i < 4; i++) host.step(1000 / 120);
    assert.equal(host.engine.frame().some((value, i) => i % 4 !== 3 && value > 0), false);
    forward({ t: 'audioFeatures', level: 1, bass: 1, mids: 1, highs: 1 });
    host.step(1000 / 120);
    assert.ok(host.engine.frame().some((value, i) => i % 4 !== 3 && value > 0));
  } finally { await host.stop(); }
});
