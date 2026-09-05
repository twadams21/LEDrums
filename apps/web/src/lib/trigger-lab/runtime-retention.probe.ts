/** Opt-in real-source ownership regression; NOT a default GC-timing test.
 * From repo root, with the already-installed tsx loader:
 * node --expose-gc --import ./apps/server/node_modules/tsx/dist/loader.mjs apps/web/src/lib/trigger-lab/runtime-retention.probe.ts
 * No presentation runs after the tested retirement/model/generation boundary. Hosts and
 * slab slots stay strongly reachable across explicit GC turns; only obsolete data may die.
 */
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { registerCanvasScene, unregisterCanvasScene } from '../../../../../packages/core/src/canvas/registry';
import type { CanvasScene } from '../../../../../packages/core/src/canvas/types';
import { Framebuffer } from '../../../../../packages/core/src/engine/framebuffer';
import { createDefaultCompositor } from '../../../../../packages/core/src/voice/compositor';
import { deactivateVoice } from '../../../../../packages/core/src/voice/voice-pool';
import { runtimeAction, runtimeFrame, runtimeModel, runtimeVoice } from '../../../../../packages/core/src/voice/runtime-test-fixtures';
import { fireOwnershipVoice, ownershipSim } from './runtime-ownership-fixtures';

type Probe = { label: string; owners: unknown[]; collected: WeakRef<object>[]; retained?: WeakRef<object>[] };
const weak = (value: object): WeakRef<object> => new WeakRef(value);
function scene(id: string): CanvasScene {
  const value: CanvasScene = { id: `ownership-gc-${id}`, name: 'Ownership GC', sampler: { kind: 'strip' }, elements: [] };
  registerCanvasScene(value);
  return value;
}
function ring(state: unknown[] | undefined): ArrayBufferLike {
  return (state![0] as { buf: Float32Array }).buf.buffer;
}

function simRetirement(): Probe {
  const doc = scene('sim-retirement');
  const sim = ownershipSim(`canvas:${doc.id}`);
  const v = sim.voices[0]!;
  assert.equal(ring(v.modState).byteLength, 4_194_304);
  const collected = [weak(ring(v.modState)), weak(v.genState as object), weak(v.renderGenerator!), weak(doc)];
  unregisterCanvasScene(doc.id);
  sim.stopAll(); sim.tick(1000);
  assert.equal(sim.voices.length, 0);
  return { label: 'Sim stopAll + tick: 4 MiB Echo ring, Canvas state/adapter/document', owners: [sim, v], collected };
}

function simModel(count: number | null): Probe {
  const doc = scene(`sim-model-${count}`);
  const sim = ownershipSim(`canvas:${doc.id}`, 16);
  const v = sim.voices[0]!;
  const identity = [v.id, v.seed, v.bornAtMs];
  const collected = [weak(sim.pixelModel!), weak(ring(v.modState)), weak(v.genState as object), weak(v.renderGenerator!), weak(doc)];
  unregisterCanvasScene(doc.id);
  sim.pixelModel = count === null ? null : runtimeModel([count]);
  assert.deepEqual([v.id, v.seed, v.bornAtMs], identity);
  assert.equal(v.active, true);
  return { label: `Sim model ${count}: old model/Echo/Canvas, equal voice id/seed/birth`, owners: [sim, v], collected };
}

function simSteal(): Probe {
  const doc = scene('sim-steal');
  const sim = ownershipSim(`canvas:${doc.id}`, 16);
  const v = sim.voices[0]!;
  const oldId = v.id;
  const collected = [weak(ring(v.modState)), weak(v.genState as object), weak(v.renderGenerator!), weak(doc)];
  unregisterCanvasScene(doc.id);
  for (let i = 0; i < 256; i++) fireOwnershipVoice(sim);
  assert.equal(sim.voices[0], v);
  assert.notEqual(v.id, oldId);
  return { label: 'Sim saturated spawn: predecessor collected before tick/render', owners: [sim, v], collected };
}

function coreGeneration(change: 'id' | 'seed' | 'birth' | 'equal-identity'): Probe {
  const model = runtimeModel([16]);
  const v = runtimeVoice({ modifiers: [{ modifierId: 'echo', params: {} }] }, runtimeAction(), 'solid-colour');
  const compositor = createDefaultCompositor();
  const dst = new Framebuffer(model.pixelCount);
  compositor.renderPresentation([v], model, runtimeFrame(16), dst, 1);
  compositor.renderPresentation([v], model, runtimeFrame(32), dst, 2);
  const collected = [weak(ring(v.modState))];
  const identity = [v.id, v.seed, v.bornAtMs];
  deactivateVoice(v); v.active = true;
  if (change === 'id') v.id += '-new';
  if (change === 'seed') v.seed++;
  if (change === 'birth') v.bornAtMs++;
  if (change === 'equal-identity') assert.deepEqual([v.id, v.seed, v.bornAtMs], identity);
  compositor.prunePresentation([v], model);
  return { label: `Core reset generation ${change}: old journal/ring`, owners: [compositor, v], collected };
}

function plainCoreCanvas(): Probe {
  const doc = scene('plain-core');
  const model = runtimeModel([16]);
  const v = runtimeVoice({}, runtimeAction(), `canvas:${doc.id}`);
  const compositor = createDefaultCompositor();
  compositor.render([v], model, runtimeFrame(16), new Framebuffer(model.pixelCount));
  const collected = [weak(v.renderGenerator!), weak(v.genState as object), weak(doc)];
  unregisterCanvasScene(doc.id);
  deactivateVoice(v);
  return { label: 'Plain core deactivate: Canvas adapter/state/document (no checkpoints)', owners: [compositor, v], collected };
}

function activeSurvivor(): Probe {
  const sim = ownershipSim('solid-colour', 16);
  const v = sim.voices[0]!;
  const retained = [weak(ring(v.modState))];
  // No local render: pruning a still-active voice must NOT drop its ring or checkpoint.
  sim.tick(16);
  return { label: 'Unchanged active Echo survives non-rendering prune', owners: [sim, v], collected: [], retained };
}

assert.equal(typeof globalThis.gc, 'function', 'This opt-in probe requires node --expose-gc');
const probes: Probe[] = [simRetirement(), ...[32, 4, 16, null].map(simModel), simSteal(),
  ...(['id', 'seed', 'birth', 'equal-identity'] as const).map(coreGeneration), plainCoreCanvas(), activeSurvivor()];
// A WeakRef target remains live for the current job. Yield before each explicit major GC;
// never poll deref inside the collection loop (that would keep targets live artificially).
for (let i = 0; i < 8; i++) { await setImmediate(); globalThis.gc!(); }
for (const probe of probes) {
  for (const ref of probe.collected) assert.equal(ref.deref(), undefined, `${probe.label}: obsolete owner retained`);
  for (const ref of probe.retained ?? []) assert.notEqual(ref.deref(), undefined, `${probe.label}: active owner lost`);
  console.log(`PASS ${probe.label}`);
}
// Access every host AFTER the assertions, so an optimizer cannot collect the hosts too.
assert.ok(probes.every((probe) => probe.owners.every((owner) => owner != null)));
console.log(`${probes.length} ownership cases passed; no post-boundary presentation`);
