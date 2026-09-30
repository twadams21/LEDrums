// @vitest-environment jsdom
/* Effect chains S07 (wave 5b, store-mappings): the store implements MapModeApi over the show's
   InputMappings. Asserted at the store's public surface — the calls the map-mode overlay makes,
   the MIDI / OSC inputs it hears (local forward and server echo), then store state, undo,
   persistence, the messages sent and the offline Sim's fires. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, effectChain } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import type { MapModeApi, MapTarget } from './map-api';
import type { WSClient, WSCallbacks, InputEcho } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';
import type { MidiEvent } from '../midi/webmidi';

type EffectCell = effectChain.EffectCell;
type InputMappingTarget = effectChain.InputMappingTarget;

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

interface Harness {
  cb: WSCallbacks;
  sent: ClientMessage[];
}
function setup(): { store: TriggerLab; h: Harness } {
  const h: Harness = { cb: {}, sent: [] };
  const store = new TriggerLab(() => ({
    on(cb: WSCallbacks) { h.cb = cb; },
    connect() {},
    close() {},
    send(m: ClientMessage) { h.sent.push(m); },
  }) as unknown as WSClient);
  return { store, h };
}
type Internals = { forwardMidi(ev: MidiEvent): void; receiveInputEcho(input: InputEcho): void; wireClient(): void };
const internals = (store: TriggerLab): Internals => store as unknown as Internals;
const history = (store: TriggerLab): number =>
  (store as unknown as { history: { stats: { entries: number } } }).history.stats.entries;
const noteOn = (store: TriggerLab, note: number): void =>
  internals(store).forwardMidi({ kind: 'note', note, velocity: 100, on: true, channel: 0 });
const cc = (store: TriggerLab, controller: number, value: number): void =>
  internals(store).forwardMidi({ kind: 'cc', controller, value, channel: 0 });

const KICK_0: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const TOM_0: EffectCell = { row: 'tom1', column: { kind: 'zone', slot: 0 } };
const TOM_CELL: MapTarget = { kind: 'fireCell', cell: TOM_0 };
const kickId = (store: TriggerLab): string => store.cellEffects(KICK_0)[0]!.id;
const SNARE_ID = 'fx-seed-snare';
const STROBE_UID = 'mod-seed-strobe';

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('the MapModeApi contract', () => {
  it('the store is assignable to it; an editor may edit, a viewer may not', () => {
    const { store } = setup();
    const api: MapModeApi = store;
    expect(api.inputMappings).toEqual([]);
    expect(api.canEditMappings).toBe(true);
    store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
    expect(api.canEditMappings).toBe(false);
    expect(api.bindTarget(TOM_CELL, { midiNote: 60 })).toEqual({ ok: false, reason: expect.stringMatching(/Viewing/) });
    expect(api.inputMappings).toEqual([]);
  });

  it('bind → bindingFor, one undo step each; re-binding keeps the id; re-learning the same source records nothing', () => {
    const { store } = setup();
    const depth = history(store);
    expect(store.bindTarget(TOM_CELL, { midiNote: 60 })).toEqual({ ok: true });
    expect(store.bindingFor(TOM_CELL)).toEqual({ midiNote: 60 });
    expect(history(store)).toBe(depth + 1);
    const id = store.inputMappings[0]!.id;
    expect(store.bindTarget(TOM_CELL, { midiNote: 60 })).toEqual({ ok: true });
    expect(history(store)).toBe(depth + 1);
    store.bindTarget(TOM_CELL, { key: 'KeyQ' });
    expect(store.inputMappings).toEqual([{ id, source: { key: 'KeyQ' }, target: TOM_CELL }]);
    store.undo();
    expect(store.bindingFor(TOM_CELL)).toEqual({ midiNote: 60 });
    store.undo();
    expect(store.bindingFor(TOM_CELL)).toBeNull();
  });

  it('clearTarget removes the mapping in one undo step; clearing an unbound target is a no-op', () => {
    const { store } = setup();
    store.bindTarget(TOM_CELL, { midiNote: 60 });
    const depth = history(store);
    store.clearTarget(TOM_CELL);
    expect(store.inputMappings).toEqual([]);
    expect(history(store)).toBe(depth + 1);
    store.clearTarget(TOM_CELL);
    expect(history(store)).toBe(depth + 1);
  });

  it('setMappingRange edits a continuous mapping; defaultRange reads the target’s own range', () => {
    const { store } = setup();
    const opacity: InputMappingTarget = { kind: 'opacity', effectId: SNARE_ID };
    store.bindTarget(opacity, { midiCc: 21 });
    store.setMappingRange(opacity, 0.2, undefined);
    expect(store.inputMappings[0]).toMatchObject({ rangeMin: 0.2 });
    expect(store.inputMappings[0]!.rangeMax).toBeUndefined();

    expect(store.defaultRange(opacity)).toEqual({ min: 0, max: 1 });
    expect(store.defaultRange({ kind: 'modifierMix', effectId: SNARE_ID, modifierUid: STROBE_UID })).toEqual({ min: 0, max: 1 });
    const spec = effectChain.generatorParamSpec('wave', 'radial').find((p) => p.type === 'number')!;
    expect(store.defaultRange({ kind: 'param', effectId: SNARE_ID, device: 'generator', param: spec.key }))
      .toEqual({ min: spec.min ?? 0, max: spec.max ?? 1 });
    expect(store.defaultRange({ kind: 'param', effectId: 'fx-missing', device: 'generator', param: spec.key })).toBeNull();
    expect(store.defaultRange({ kind: 'fireEffect', effectId: SNARE_ID })).toBeNull();
  });
});

describe('conflict refusal (binding-claims)', () => {
  it('a zone note, another mapping or a Cue’s source is refused with its reason, changing nothing', () => {
    const { store } = setup();
    const zone = store.bindTarget(TOM_CELL, { midiNote: 36 }); // the kick's zone note
    expect(zone.ok).toBe(false);
    expect(!zone.ok && zone.reason).toMatch(/already the drum trigger/);

    store.bindTarget({ kind: 'fireEffect', effectId: SNARE_ID }, { midiNote: 60 });
    const taken = store.bindTarget(TOM_CELL, { midiNote: 60 });
    expect(!taken.ok && taken.reason).toMatch(/already the MIDI-map mapping for firing an Effect/);

    const cue = store.addEffect({ row: 'kit', column: { kind: 'cue' } }, 'solid')!;
    store.setTrigger(cue, { kind: 'cue', source: { midiNote: 70 } });
    const starved = store.bindTarget(TOM_CELL, { midiNote: 70 });
    expect(!starved.ok && starved.reason).toMatch(/Cue Effect/);
    expect(store.bindingFor(TOM_CELL)).toBeNull();
  });

  it('a key cannot drive a continuous control', () => {
    const { store } = setup();
    const result = store.bindTarget({ kind: 'opacity', effectId: SNARE_ID }, { key: 'KeyQ' });
    expect(result.ok).toBe(false);
    expect(store.inputMappings).toEqual([]);
  });

  it('a zone-map write that would take a mapped note is refused (the guard runs both ways)', () => {
    const { store } = setup();
    store.project = defaultProject();
    store.bindTarget(TOM_CELL, { midiNote: 61 });
    const inputMap = store.project.inputMap;
    const next = { ...inputMap, midiNotes: [...inputMap.midiNotes, { note: 61, drumId: 'tom2', slot: 1 }] };
    expect(store.setInputMap(next)).toBe(false);
  });
});

describe('global-control targets write inputMap.globalControls', () => {
  const NEXT: MapTarget = { kind: 'globalControl', action: 'nextSection' };

  it('bind / read / clear go through the global-control binding (Settings stays the source of truth)', () => {
    const { store } = setup();
    store.project = defaultProject();
    expect(store.mapTargetId(NEXT)).toBe('global:nextSection');
    expect(store.bindTarget(NEXT, { midiNote: 70 })).toEqual({ ok: true });
    expect(store.globalControls.nextSection).toEqual({ midiNote: 70 });
    expect(store.bindingFor(NEXT)).toEqual({ midiNote: 70 });
    store.bindTarget(NEXT, { oscAddress: '/next' }); // another field: the note is kept
    expect(store.globalControls.nextSection).toEqual({ midiNote: 70, oscAddress: '/next' });
    store.clearTarget(NEXT);
    expect(store.globalControls.nextSection).toBeUndefined();
    expect(store.inputMappings).toEqual([]);
  });

  it('a source a mapping holds is refused, and a key is refused', () => {
    const { store } = setup();
    store.project = defaultProject();
    store.bindTarget(TOM_CELL, { midiNote: 61 });
    const refused = store.bindTarget(NEXT, { midiNote: 61 });
    expect(!refused.ok && refused.reason).toMatch(/MIDI-map mapping for a grid cell/);
    expect(store.bindTarget(NEXT, { key: 'KeyN' }).ok).toBe(false);
    expect(store.globalControls.nextSection).toBeUndefined();
  });
});

describe('MIDI / OSC learn (the `map` learn target)', () => {
  it('a note binds, learn stays ARMED, and the next input re-binds', () => {
    const { store } = setup();
    store.startMapLearn(TOM_CELL);
    expect(store.mapLearnTargetId).toBe(store.mapTargetId(TOM_CELL));
    noteOn(store, 60);
    expect(store.bindingFor(TOM_CELL)).toEqual({ midiNote: 60 });
    expect(store.mapLearnTargetId).toBe(store.mapTargetId(TOM_CELL));
    cc(store, 21, 90);
    expect(store.bindingFor(TOM_CELL)).toEqual({ midiCc: 21 });
    store.cancelMapLearn();
    expect(store.mapLearnTargetId).toBeNull();
    expect(store.midiLearnTarget).toBeNull();
    expect(store.oscLearnTarget).toBeNull();
  });

  it('a refused note records the reason and stays armed; the next good input binds and clears it', () => {
    const { store } = setup();
    store.startMapLearn(TOM_CELL);
    noteOn(store, 38); // the snare's zone note
    expect(store.mapLearnRefusal).toMatch(/already the drum trigger/);
    expect(store.bindingFor(TOM_CELL)).toBeNull();
    expect(store.mapLearnTargetId).toBe(store.mapTargetId(TOM_CELL));
    noteOn(store, 62);
    expect(store.mapLearnRefusal).toBeNull();
    expect(store.bindingFor(TOM_CELL)).toEqual({ midiNote: 62 });
  });

  it('CC 0 (section recall) is never learnt; an OSC echo binds an address', () => {
    const { store } = setup();
    const fader: MapTarget = { kind: 'opacity', effectId: SNARE_ID };
    store.startMapLearn(fader);
    cc(store, 0, 64);
    expect(store.bindingFor(fader)).toBeNull();
    internals(store).receiveInputEcho({ kind: 'osc', label: '/fader/1', value: 0.3 });
    expect(store.bindingFor(fader)).toEqual({ oscAddress: '/fader/1' });
    expect(store.mapLearnTargetId).toBe(store.mapTargetId(fader));
  });

  it('a viewer cannot arm', () => {
    const { store } = setup();
    store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
    store.startMapLearn(TOM_CELL);
    expect(store.mapLearnTargetId).toBeNull();
  });
});

describe('key mappings (resolved in the web)', () => {
  it('offline: a mapped key fires its cell through the Sim; an unmapped key is not taken', () => {
    const { store } = setup();
    const tom = store.addEffect(TOM_0, 'solid')!;
    store.bindTarget(TOM_CELL, { key: 'KeyQ' });
    expect(store.performKeyMapping('KeyW')).toBe(false);
    expect(store.effectFireAt(tom)).toBe(0);
    expect(store.performKeyMapping('KeyQ')).toBe(true);
    expect(store.effectFireAt(tom)).toBeGreaterThan(0);
  });

  it('connected: a mapped key sends the fireEffect intent', () => {
    const { store, h } = setup();
    store.bindTarget({ kind: 'fireEffect', effectId: SNARE_ID }, { key: 'KeyE' });
    store.link = 'open';
    store.performKeyMapping('KeyE');
    expect(h.sent.filter((m) => m.t === 'fireEffect')).toEqual([{ t: 'fireEffect', effectId: SNARE_ID }]);
  });

  it('a recallSection key re-points the active section', () => {
    const { store } = setup();
    const first = store.activeSectionId;
    store.addSongSection('Chorus');
    const chorus = store.activeSong!.sections.at(-1)!.id;
    store.setActiveSection(first);
    store.bindTarget({ kind: 'recallSection', sectionId: chorus }, { key: 'Digit2' });
    expect(store.performKeyMapping('Digit2')).toBe(true);
    expect(store.activeSectionId).toBe(chorus);
  });

  it('a bypass key toggles the Effect’s bypass, one undo step per press', () => {
    const { store } = setup();
    const id = kickId(store);
    store.bindTarget({ kind: 'bypass', effectId: id }, { key: 'KeyB' });
    const depth = history(store);
    store.performKeyMapping('KeyB');
    expect(store.effectById(id)!.bypass).toBe(true);
    expect(history(store)).toBe(depth + 1);
    store.performKeyMapping('KeyB');
    expect(store.effectById(id)!.bypass).toBe(false);
    store.undo();
    expect(store.effectById(id)!.bypass).toBe(true);
  });
});

describe('bypass toggles from MIDI / OSC', () => {
  it('offline: local MIDI toggles on each note-on (a Modifier’s bypass here)', () => {
    const { store } = setup();
    const target: InputMappingTarget = { kind: 'bypass', effectId: SNARE_ID, modifierUid: STROBE_UID };
    store.bindTarget(target, { midiNote: 60 });
    const strobe = () => store.effectById(SNARE_ID)!.modifiers.find((m) => m.uid === STROBE_UID)!;
    noteOn(store, 60);
    expect(strobe().bypass).toBe(true);
    internals(store).forwardMidi({ kind: 'note', note: 60, velocity: 0, on: false, channel: 0 });
    expect(strobe().bypass).toBe(true);
    noteOn(store, 60);
    expect(strobe().bypass).toBe(false);
  });

  it('offline: a CC toggles once per press (a 127 / 0 button)', () => {
    const { store } = setup();
    const id = kickId(store);
    store.bindTarget({ kind: 'bypass', effectId: id }, { midiCc: 20 });
    cc(store, 20, 127);
    cc(store, 20, 0);
    expect(store.effectById(id)!.bypass).toBe(true);
    cc(store, 20, 127);
    expect(store.effectById(id)!.bypass).toBe(false);
  });

  it('linked: the local forward does not toggle; the server echo does (once per press, note / CC / OSC)', () => {
    const { store } = setup();
    const id = kickId(store);
    store.bindTarget({ kind: 'bypass', effectId: id }, { midiNote: 60 });
    store.link = 'open';
    noteOn(store, 60);
    expect(store.effectById(id)!.bypass).toBe(false);
    internals(store).receiveInputEcho({ kind: 'midi', label: 'note 60', value: 100 / 127, note: 60, channel: 0 });
    expect(store.effectById(id)!.bypass).toBe(true);

    store.bindTarget({ kind: 'bypass', effectId: id }, { midiCc: 20 });
    cc(store, 20, 127);
    expect(store.effectById(id)!.bypass).toBe(true);
    for (const value of [1, 0.8, 0]) internals(store).receiveInputEcho({ kind: 'midi', label: 'cc 20', value, controller: 20, channel: 0 });
    expect(store.effectById(id)!.bypass).toBe(false);

    store.bindTarget({ kind: 'bypass', effectId: id }, { oscAddress: '/bypass' });
    internals(store).receiveInputEcho({ kind: 'osc', label: '/bypass', value: 1 });
    internals(store).receiveInputEcho({ kind: 'osc', label: '/bypass', value: 0 });
    expect(store.effectById(id)!.bypass).toBe(true);
  });

  it('a viewer’s echo never toggles', () => {
    const { store } = setup();
    const id = kickId(store);
    store.bindTarget({ kind: 'bypass', effectId: id }, { midiNote: 60 });
    store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
    internals(store).receiveInputEcho({ kind: 'midi', label: 'note 60', value: 1, note: 60, channel: 0 });
    expect(store.effectById(id)!.bypass).toBe(false);
  });
});

describe('the engine path', () => {
  it('offline: a note no zone claims, mapped to a cell, fires that cell through the Sim engine', () => {
    const { store } = setup();
    const tom = store.addEffect(TOM_0, 'solid')!;
    store.bindTarget(TOM_CELL, { midiNote: 61 });
    noteOn(store, 61);
    expect(store.effectFireAt(tom)).toBeGreaterThan(0);
    expect(store.effectFireAt(kickId(store))).toBe(0);
    store.sim.tick(16);
    expect(store.sim.log.some((line) => line.resolved.some((r) => r.includes('audition')))).toBe(true);
  });

  it('connected: the runtime Show sent to the server carries the mappings', () => {
    const { store, h } = setup();
    internals(store).wireClient();
    h.cb.onConnection!('open');
    h.sent.length = 0;
    store.bindTarget(TOM_CELL, { midiNote: 61 });
    store.saveShow();
    const sent = h.sent.find((m) => m.t === 'setShow');
    expect(sent?.t === 'setShow' && sent.show.mappings).toEqual(store.inputMappings);
  });

  it('mappings persist with the show and reload validated', () => {
    const first = setup().store;
    first.bindTarget(TOM_CELL, { midiNote: 61 });
    first.bindTarget({ kind: 'opacity', effectId: SNARE_ID }, { midiCc: 21 });
    first.saveShow();
    const reloaded = setup().store;
    expect(reloaded.inputMappings).toEqual(first.inputMappings);
    // A fresh mapping never reuses a restored id.
    reloaded.bindTarget({ kind: 'fireEffect', effectId: SNARE_ID }, { midiNote: 62 });
    const ids = reloaded.inputMappings.map((m) => m.id);
    expect(new Set(ids).size).toBe(3);
  });
});
