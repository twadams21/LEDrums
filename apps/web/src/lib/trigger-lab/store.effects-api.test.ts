// @vitest-environment jsdom
/* Effect chains (S05, wave-4 store-wire): the store implements the Effects authoring contract by
   delegating to EffectsController. Asserted at the store's public surface — the API calls the UI
   makes, then store state, undo, persistence, the messages sent and the offline Sim's frame. The
   pure ops themselves are covered in effects-doc / effects-controller tests. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, effectChain } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import { MASTER_CELL, type EffectsAuthoringApi } from './effects-api';
import { cellFile, deviceFile, effectFile } from './effects-files';
import {
  SHOWS_STORAGE_KEY,
  serializeShowLibrary,
  type AuthoredState,
  type ShowLibrary,
} from './persistence';
import type { WSClient, WSCallbacks, InputEcho } from '../ws/client';
import type { ClientMessage, SerializedModel } from '../ws/protocol-types';
import type { MidiEvent } from '../midi/webmidi';

type EffectCell = effectChain.EffectCell;

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

const KICK_0: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const SNARE_0: EffectCell = { row: 'snare', column: { kind: 'zone', slot: 0 } };
const TOM_0: EffectCell = { row: 'tom1', column: { kind: 'zone', slot: 0 } };
const KIT_ALWAYS: EffectCell = { row: 'kit', column: { kind: 'always' } };
const KIT_CUE: EffectCell = { row: 'kit', column: { kind: 'cue' } };
const MODEL: SerializedModel = { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } };

function history(store: TriggerLab): number {
  return (store as unknown as { history: { stats: { entries: number } } }).history.stats.entries;
}
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const kickEffect = (store: TriggerLab) => store.cellEffects(KICK_0)[0]!;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('the store implements EffectsAuthoringApi', () => {
  it('is assignable to the contract and reads the active section', () => {
    const { store } = setup();
    const api: EffectsAuthoringApi = store;
    expect(api.activeSectionId).toBe('intro');
    expect(api.gridRows.map((r) => r.id)).toEqual(['kit', ...defaultProject().kit.drums.map((d) => d.id)]);
    expect(api.cellSummary(KICK_0)).toMatchObject({ enabled: true, count: 1 });
    expect(api.selectedEffectId).toBe(kickEffect(store).id);
  });
});

describe('every mutator is one undo step on the active section', () => {
  const cases: Array<{ name: string; run: (store: TriggerLab, id: string) => unknown; check: (store: TriggerLab, id: string) => boolean }> = [
    { name: 'renameEffect', run: (s, id) => s.renameEffect(id, 'Renamed'), check: (s, id) => s.effectById(id)!.name === 'Renamed' },
    { name: 'setEffectBypass', run: (s, id) => s.setEffectBypass(id, true), check: (s, id) => s.effectById(id)!.bypass },
    { name: 'setEffectBlend', run: (s, id) => s.setEffectBlend(id, 'screen'), check: (s, id) => s.effectById(id)!.blend === 'screen' },
    { name: 'setEffectOpacity', run: (s, id) => s.setEffectOpacity(id, 0.3), check: (s, id) => s.effectById(id)!.opacity === 0.3 },
    { name: 'setRetrigger', run: (s, id) => s.setRetrigger(id, 'restart'), check: (s, id) => s.effectById(id)!.retrigger === 'restart' },
    { name: 'setAmp', run: (s, id) => s.setAmp(id, { attackMs: 77 }), check: (s, id) => s.effectById(id)!.amp.attackMs === 77 },
    { name: 'setTarget', run: (s, id) => s.setTarget(id, { kind: 'kit' }), check: (s, id) => s.effectById(id)!.target.kind === 'kit' },
    { name: 'setGeneratorParam', run: (s, id) => s.setGeneratorParam(id, 'color', '#010203'), check: (s, id) => s.effectById(id)!.generator.params.color === '#010203' },
    { name: 'setGenerator', run: (s, id) => s.setGenerator(id, 'wave', 'radial'), check: (s, id) => s.effectById(id)!.generator.kind === 'wave' },
    { name: 'addModifier', run: (s, id) => s.addModifier(id, 'strobe'), check: (s, id) => s.effectById(id)!.modifiers.length === 1 },
    { name: 'addControl', run: (s, id) => s.addControl(id, 'lfo'), check: (s, id) => s.effectById(id)!.controls.length === 1 },
    { name: 'removeEffect', run: (s, id) => s.removeEffect(id), check: (s, id) => s.effectById(id) === undefined },
    { name: 'duplicateEffect', run: (s, id) => s.duplicateEffect(id), check: (s) => s.cellEffects(KICK_0).length === 2 },
    { name: 'moveEffect', run: (s, id) => s.moveEffect(id, TOM_0, 0), check: (s, id) => s.effectById(id)!.cell.row === 'tom1' },
    { name: 'addEffect', run: (s) => s.addEffect(TOM_0, 'noise'), check: (s) => s.cellEffects(TOM_0).length === 1 },
    { name: 'clearCell', run: (s) => s.clearCell(KICK_0), check: (s) => s.cellEffects(KICK_0).length === 0 },
    { name: 'addModifier (master)', run: (s) => s.addModifier(MASTER_CELL, 'strobe'), check: (s) => s.masterChain.length === 1 },
  ];

  it.each(cases)('$name', ({ run, check }) => {
    const { store } = setup();
    const id = kickEffect(store).id;
    const before = plain(store.activeSection);
    const depth = history(store);
    run(store, id);
    expect(check(store, id)).toBe(true);
    expect(history(store)).toBe(depth + 1);
    expect(store.undo()).toBe(true);
    expect(plain(store.activeSection)).toEqual(before);
  });

  it('device edits (params, mix, envelope, bypass, move, remove; control settings and mappings) each take one step', () => {
    const { store } = setup();
    const id = kickEffect(store).id;
    const a = store.addModifier(id, 'strobe')!;
    const b = store.addModifier(id, 'strobe')!;
    const ctl = store.addControl(id, 'lfo')!;
    const edits: Array<() => void> = [
      () => store.setModifierMix(id, a, 0.5),
      () => store.setModifierBypass(id, a, true),
      () => store.moveModifier(id, b, 0),
      () => store.setModifierEnvelope(id, a, { attackMs: 10, decayMs: 10, sustainLevel: 1, releaseMs: 10 } as effectChain.ModifierEnvelopeSpec),
      () => store.setControlSettings(id, ctl, { rateHz: 3 } as Partial<effectChain.ControlDevice['settings']>),
      () => store.addMapping(id, ctl, { device: 'effect', param: 'opacity', amount: 1 } as effectChain.ControlMapping),
      () => store.setMapping(id, ctl, 0, { amount: 0.5 }),
      () => store.removeMapping(id, ctl, 0),
      () => store.removeControl(id, ctl),
      () => store.removeModifier(id, b),
    ];
    for (const edit of edits) {
      const depth = history(store);
      const before = JSON.stringify(store.effectById(id));
      edit();
      expect(JSON.stringify(store.effectById(id)), edit.toString()).not.toBe(before);
      expect(history(store), edit.toString()).toBe(depth + 1);
    }
  });

  it('a drag folds into one undo step (beginGesture / endGesture)', () => {
    const { store } = setup();
    const id = kickEffect(store).id;
    const before = store.effectById(id)!.opacity;
    const depth = history(store);
    store.beginGesture();
    for (let i = 1; i <= 20; i++) store.setEffectOpacity(id, i / 40);
    store.endGesture();
    expect(history(store)).toBe(depth + 1);
    expect(store.effectById(id)!.opacity).toBe(0.5);
    store.undo();
    expect(store.effectById(id)!.opacity).toBe(before);
  });

  it('a no-op edit records nothing', () => {
    const { store } = setup();
    const id = kickEffect(store).id;
    const depth = history(store);
    store.setEffectOpacity(id, store.effectById(id)!.opacity);
    store.renameEffect('no-such-effect', 'x');
    expect(history(store)).toBe(depth);
  });
});

describe('semantics the UI relies on', () => {
  it('setTrigger to another kind moves the Effect to that column of its row', () => {
    const { store } = setup();
    const id = store.addEffect(KIT_ALWAYS, 'solid')!;
    store.setTrigger(id, { kind: 'cue', source: { midiNote: 40 } });
    expect(store.effectById(id)!.cell).toEqual(KIT_CUE);
    expect(store.cellEffects(KIT_ALWAYS).some((e) => e.id === id)).toBe(false);
    expect(store.selectedCell).toEqual(KIT_CUE); // the selection follows
  });

  it('setGenerator keeps the modifiers, controls and target', () => {
    const { store } = setup();
    const id = kickEffect(store).id;
    const uid = store.addModifier(id, 'strobe')!;
    store.addControl(id, 'lfo');
    const target = plain(store.effectById(id)!.target);
    store.setGenerator(id, 'noise');
    const effect = store.effectById(id)!;
    expect(effect.generator.kind).toBe('noise');
    expect(effect.modifiers.map((m) => m.uid)).toEqual([uid]);
    expect(effect.controls).toHaveLength(1);
    expect(effect.target).toEqual(target);
  });

  it('copy / paste / clear cells (fresh ids on paste)', () => {
    const { store } = setup();
    const source = plain(store.cellEffects(KICK_0));
    store.copyCell(KICK_0);
    expect(store.canPasteCell).toBe(true);
    expect(store.pasteCell(TOM_0)).toEqual({ ok: true });
    const pasted = store.cellEffects(TOM_0);
    expect(pasted.map((e) => e.generator)).toEqual(source.map((e) => e.generator));
    expect(pasted.every((e) => source.every((s) => s.id !== e.id))).toBe(true);
    store.clearCell(KICK_0);
    expect(store.cellEffects(KICK_0)).toHaveLength(0);
    expect(store.cellEffects(TOM_0)).toHaveLength(source.length);
  });

  it('fireEffectAt auditions the section’s nth Effect in grid order', () => {
    const { store } = setup();
    store.fireEffectAt(0); // the Kit row comes first: the Always bed
    const bed = store.cellEffects(KIT_ALWAYS)[0]!;
    expect(store.effectFireAt(bed.id)).toBeGreaterThan(0);
  });

  it('a section switch keeps the selected cell and re-selects its Effect in the new section', () => {
    const { store } = setup();
    store.selectCell(KICK_0);
    store.setActiveSection('verse');
    expect(store.selectedCell).toEqual(KICK_0);
    expect(store.selectedEffectId).toBeNull(); // Verse's kick cell is empty
    const id = store.addEffect(KICK_0, 'solid')!;
    store.setActiveSection('intro');
    store.setActiveSection('verse');
    expect(store.selectedEffectId).toBe(id);
  });
});

describe('viewer and read-only guards', () => {
  it('a viewer cannot author; audition and selection still work', () => {
    const { store } = setup();
    const id = kickEffect(store).id;
    const before = plain(store.activeSection);
    store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
    expect(store.addEffect(TOM_0, 'solid')).toBeNull();
    store.setEffectOpacity(id, 0.1);
    store.removeEffect(id);
    store.addModifier(MASTER_CELL, 'strobe');
    store.copyCell(KICK_0);
    expect(store.pasteCell(TOM_0).ok).toBe(false);
    expect(store.applyEffectsFileToCell(TOM_0, 'x')).toEqual({ ok: false, reason: 'This section is read-only.' });
    expect(plain(store.activeSection)).toEqual(before);
    store.selectCell(SNARE_0);
    expect(store.selectedCell).toEqual(SNARE_0);
    store.fireEffect(id);
    expect(store.effectFireAt(id)).toBeGreaterThan(0);
  });
});

describe('audition + fire flashes', () => {
  it('offline: fireEffect plays through the Sim and the offline frame lights', () => {
    const { store } = setup();
    store.clearCell(KIT_ALWAYS);
    store.clearCell(SNARE_0);
    const id = store.addEffect(TOM_0, 'solid')!;
    store.setAmp(id, { length: { ms: 5000 } });
    store.fireEffect(id);
    store.sim.tick(16); // the audition lands on this tick (attack starts)
    store.sim.tick(16);
    const frame = store.sim.render(store.labModel.pm);
    const tom = store.labModel.pm.drumById.get('tom1')!;
    let lit = 0;
    for (let i = tom.pixelStart; i < tom.pixelStart + tom.pixelCount; i++) lit += frame[i * 4]!;
    expect(lit).toBeGreaterThan(0);
    expect(store.effectFireAt(id)).toBeGreaterThan(0);
    expect(store.cellFireAt(TOM_0)).toBe(store.effectFireAt(id));
  });

  it('connected: fireEffect / fireCell send the fireEffect intent and never fire the Sim', () => {
    const { store, h } = setup();
    store.link = 'open';
    const id = kickEffect(store).id;
    store.fireEffect(id);
    store.duplicateEffect(id);
    store.fireCell(KICK_0);
    const fires = h.sent.filter((m) => m.t === 'fireEffect');
    expect(fires.map((m) => (m.t === 'fireEffect' ? m.effectId : ''))).toEqual([id, ...store.cellEffects(KICK_0).map((e) => e.id)]);
    expect(store.monitorEvents.filter((e) => e.type === 'effect')).toHaveLength(0);
  });

  it('a pad hit stamps the zone Effect’s fire time (online and offline)', () => {
    const { store } = setup();
    const id = kickEffect(store).id;
    expect(store.effectFireAt(id)).toBe(0);
    store.hit(store.pads.find((p) => p.drumId === 'kick' && p.zone === 0)!);
    expect(store.effectFireAt(id)).toBeGreaterThan(0);
  });
});

describe('the runtime Show', () => {
  it('connected: an Effect edit re-sends setShow carrying the edited section', () => {
    const { store, h } = setup();
    internals(store).wireClient();
    h.cb.onConnection!('open');
    const first = h.sent.find((m) => m.t === 'setShow');
    expect(first?.t === 'setShow' && first.show.songs?.[0]?.sections[0]?.effects?.length).toBe(3);
    h.sent.length = 0;
    store.addEffect(TOM_0, 'noise');
    store.saveShow(); // the autosave flush path
    const next = h.sent.find((m) => m.t === 'setShow');
    expect(next?.t === 'setShow' && next.show.songs?.[0]?.sections[0]?.effects?.length).toBe(4);
  });
});

describe('cue learn (MIDI / OSC) and its binding guard', () => {
  function withCue(store: TriggerLab): string {
    store.project = defaultProject();
    const id = store.addEffect(KIT_CUE, 'solid')!;
    store.setTrigger(id, { kind: 'cue', source: { midiNote: 1 } });
    return id;
  }

  it('MIDI: the next note binds the Cue source (one undo step) and disarms', () => {
    const { store } = setup();
    const id = withCue(store);
    store.startCueLearn(id, 'midi');
    expect(store.cueLearnEffectId).toBe(id);
    const depth = history(store);
    internals(store).forwardMidi({ kind: 'note', note: 61, velocity: 100, on: true, channel: 0 });
    expect(store.effectById(id)!.trigger).toEqual({ kind: 'cue', source: { midiNote: 61 } });
    expect(store.cueLearnEffectId).toBeNull();
    expect(history(store)).toBe(depth + 1);
  });

  it('MIDI: a note owned by a global control is refused and the learn stays armed', () => {
    const { store } = setup();
    const id = withCue(store);
    expect(store.setGlobalControlBinding('nextSection', { midiNote: 70 })).toBe(true);
    store.startCueLearn(id, 'midi');
    internals(store).forwardMidi({ kind: 'note', note: 70, velocity: 100, on: true, channel: 0 });
    expect(store.effectById(id)!.trigger).toEqual({ kind: 'cue', source: { midiNote: 1 } });
    expect(store.cueLearnEffectId).toBe(id);
  });

  it('MIDI: a controller binds too (CC 0 stays reserved)', () => {
    const { store } = setup();
    const id = withCue(store);
    store.startCueLearn(id, 'midi');
    internals(store).forwardMidi({ kind: 'cc', controller: 0, value: 64, channel: 0 });
    expect(store.cueLearnEffectId).toBe(id);
    internals(store).forwardMidi({ kind: 'cc', controller: 21, value: 64, channel: 0 });
    expect(store.effectById(id)!.trigger).toEqual({ kind: 'cue', source: { midiCc: 21 } });
  });

  it('OSC: the next heard address binds the Cue source', () => {
    const { store } = setup();
    const id = withCue(store);
    store.startCueLearn(id, 'osc');
    expect(store.cueLearnEffectId).toBe(id);
    internals(store).receiveInputEcho({ kind: 'osc', label: '/cue/go', value: 1 });
    expect(store.effectById(id)!.trigger).toEqual({ kind: 'cue', source: { oscAddress: '/cue/go' } });
    expect(store.cueLearnEffectId).toBeNull();
  });

  it('cancelCueLearn disarms; only a Cue Effect can arm', () => {
    const { store } = setup();
    const id = withCue(store);
    store.startCueLearn(kickEffect(store).id, 'midi'); // a zone Effect: refused
    expect(store.cueLearnEffectId).toBeNull();
    store.startCueLearn(id, 'osc');
    store.cancelCueLearn();
    expect(store.cueLearnEffectId).toBeNull();
    expect(store.oscLearnTarget).toBeNull();
  });

  it('offline: a Cue fires from its note (and a zone-mapped note fires both, once each)', () => {
    const { store } = setup();
    const cue = withCue(store);
    store.setTrigger(cue, { kind: 'cue', source: { midiNote: 36 } }); // 36 is the kick's zone note
    internals(store).forwardMidi({ kind: 'note', note: 36, velocity: 127, on: true, channel: 0 });
    expect(store.effectFireAt(cue)).toBeGreaterThan(0);
    expect(store.effectFireAt(kickEffect(store).id)).toBeGreaterThan(0);
    const local = store.monitorEvents.filter((e) => e.type === 'effect');
    expect(local).toHaveLength(1);
    expect(local[0]!.detail?.split(' | ')).toHaveLength(2);
  });
});

describe('files (IO-free apply cores)', () => {
  it('an Effect file loads into a cell with a fresh id, selected, in one undo step', () => {
    const { store } = setup();
    const text = effectFile(plain(kickEffect(store)), {}).text;
    const depth = history(store);
    expect(store.applyEffectsFileToCell(TOM_0, text)).toEqual({ ok: true });
    const placed = store.cellEffects(TOM_0)[0]!;
    expect(placed.id).not.toBe(kickEffect(store).id);
    expect(placed.generator).toEqual(kickEffect(store).generator);
    expect(store.selectedEffectId).toBe(placed.id);
    expect(history(store)).toBe(depth + 1);
    store.undo();
    expect(store.cellEffects(TOM_0)).toHaveLength(0);
  });

  it('a cell file loads the whole stack; a bad file changes nothing', () => {
    const { store } = setup();
    store.duplicateEffect(kickEffect(store).id);
    const text = cellFile(KICK_0, plain(store.cellEffects(KICK_0)), {}).text;
    expect(store.applyEffectsFileToCell(TOM_0, text)).toEqual({ ok: true });
    expect(store.cellEffects(TOM_0)).toHaveLength(2);
    const before = plain(store.activeSection);
    expect(store.applyEffectsFileToCell(TOM_0, 'not json').ok).toBe(false);
    expect(plain(store.activeSection)).toEqual(before);
  });

  it('a device file loads onto an Effect, and a modifier file onto the Master chain', () => {
    const { store } = setup();
    const id = kickEffect(store).id;
    const modifier = effectChain.modifierDeviceSchema.parse({ uid: 'mod-x', modifierId: 'strobe' });
    const text = deviceFile({ device: 'modifier', modifier }, {}).text;
    expect(store.applyEffectsFileToEffect(id, text)).toEqual({ ok: true });
    expect(store.effectById(id)!.modifiers.map((m) => m.modifierId)).toEqual(['strobe']);
    expect(store.applyDeviceFileToMaster(text)).toEqual({ ok: true });
    expect(store.masterChain.map((m) => m.modifierId)).toEqual(['strobe']);
  });

  it('a file’s canvas scene comes into the show with the Effect, in the same undo step', () => {
    const source = setup().store;
    const sceneId = source.createCanvasScene('Carried');
    const id = source.addEffect(TOM_0, 'scene')!;
    source.setGeneratorParam(id, 'sceneId', sceneId);
    const text = effectFile(plain(source.effectById(id)!), { canvasScenes: plain(source.canvasScenes) }).text;

    const { store } = setup();
    expect(store.canvasScenes).toHaveLength(0);
    expect(store.applyEffectsFileToCell(TOM_0, text)).toEqual({ ok: true });
    expect(store.canvasScenes.map((s) => s.name)).toEqual(['Carried']);
    const placed = store.cellEffects(TOM_0)[0]!;
    expect(placed.generator.params.sceneId).toBe(store.canvasScenes[0]!.id);
    store.undo();
    expect(store.canvasScenes).toHaveLength(0);
    expect(store.cellEffects(TOM_0)).toHaveLength(0);
  });
});

describe('legacy import (old v1 / v2 libraries)', () => {
  function legacyServerLibrary(): unknown {
    const lib: ShowLibrary = {
      activeShowId: 'old-show',
      shows: {
        'old-show': {
          id: 'old-show',
          name: 'Old Gig',
          authored: {
            songs: [{ id: 'old-song', name: 'Opener', sections: [{ id: 'old-sec', name: 'Verse', graphs: [], looks: {} }] }],
            activeSongId: 'old-song',
            activeSectionId: 'old-sec',
            bpm: 133,
          } as unknown as AuthoredState,
        },
      },
    };
    return serializeShowLibrary(lib);
  }

  it('a server v2 blob on the first state is offered for import, never adopted; the server is seeded with v3', () => {
    const { store, h } = setup();
    internals(store).wireClient();
    h.cb.onConnection!('open');
    h.cb.onState!(defaultProject(), MODEL, [], [], { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 }, legacyServerLibrary() as never, null, null, { status: 'listening', port: 9000, hosts: [] });
    expect(store.shows.map((s) => s.name)).toEqual(['Untitled Show']);
    expect(store.legacyImportAvailable).toBe(true);
    expect(store.legacyShowNames).toEqual(['Old Gig']);
    const pushed = h.sent.find((m) => m.t === 'setShowLibrary');
    expect(pushed?.t === 'setShowLibrary' && (pushed.library as { version: number }).version).toBe(3);

    expect(store.importLegacyShows()).toEqual({ ok: true });
    expect(store.shows.map((s) => s.name)).toEqual(['Untitled Show', 'Old Gig']);
    expect(store.legacyImportAvailable).toBe(false);
    expect(store.importLegacyShows().ok).toBe(false); // idempotent
    store.openShow(store.shows[1]!.id);
    expect(store.bpm).toBe(133);
    expect(store.activeSong!.sections.map((s) => [s.id, s.name, s.effects])).toEqual([['old-sec', 'Verse', []]]);
  });

  it('the local old library is detected at boot; dismissing hides the offer for this browser', () => {
    localStorage.setItem(SHOWS_STORAGE_KEY, JSON.stringify(legacyServerLibrary()));
    const { store } = setup();
    expect(store.legacyImportAvailable).toBe(true);
    store.dismissLegacyImport();
    expect(store.legacyImportAvailable).toBe(false);
    expect(setup().store.legacyImportAvailable).toBe(false);
    expect(localStorage.getItem(SHOWS_STORAGE_KEY)).toBe(JSON.stringify(legacyServerLibrary())); // old data untouched
  });

  it('a viewer is never offered the import', () => {
    localStorage.setItem(SHOWS_STORAGE_KEY, JSON.stringify(legacyServerLibrary()));
    const { store } = setup();
    store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
    expect(store.legacyImportAvailable).toBe(false);
    expect(store.importLegacyShows().ok).toBe(false);
  });
});
