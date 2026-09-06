// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { TriggerLab } from './store.svelte';
import { SHOWS_STORAGE_KEY, SONGS_STORAGE_KEY } from './persistence';
import { ShowsController } from './shows-controller.svelte';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';
import { defaultProject } from '@ledrums/core';
import type { GraphNode, NodeKind } from './sim';

/* Repro: a node move (a DEEP graph mutation) MUST be autosaved. The existing persistence
   tests only cover hydration (construction) and never arm the autosave, so the save-on-edit
   path is untested. jsdom gives an effect scheduler flushSync can drive; we install a full
   localStorage mock (jsdom's stub here lacks removeItem/clear). */

class MemStorage {
  m = new Map<string, string>();
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

const fakeClient = (): WSClient =>
  ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, 'localStorage', { value: new MemStorage(), configurable: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function savedNode(key: string, nodeId: string): { x: number; y: number } | undefined {
  const raw = localStorage.getItem(SHOWS_STORAGE_KEY);
  if (!raw) return undefined;
  const lib = JSON.parse(raw);
  const show = lib.data.shows[lib.data.activeShowId];
  return show?.authored?.graphs?.[key]?.nodes?.find((n: { id: string }) => n.id === nodeId);
}

describe('TriggerLab autosave (save on edit)', () => {
  it('serializes a node move into the saved blob (synchronous flush)', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    const key = store.selectedPadKey!;
    const node = store.graphs[key]!.nodes[0]!;
    store.moveNode(node, 1234, 5678);
    ax.stopAutosave(); // synchronous flush of currentLibrary()
    expect(savedNode(key, node.id)).toMatchObject({ x: 1234, y: 5678 });
  });

  it('reactively autosaves a node move (deep-mutation tracking)', () => {
    const store = new TriggerLab(fakeClient);
    (store as unknown as { startAutosave(): void }).startAutosave();
    flushSync();
    vi.advanceTimersByTime(500);

    const key = store.selectedPadKey!;
    const node = store.graphs[key]!.nodes[0]!;
    store.moveNode(node, 4321, 8765);
    flushSync();
    vi.advanceTimersByTime(500);

    expect(savedNode(key, node.id)).toMatchObject({ x: 4321, y: 8765 });
    (store as unknown as { stopAutosave(): void }).stopAutosave();
  });

  it('materializes neither library during a drag, and only once each at flush', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const shows = vi.spyOn(ShowsController.prototype, 'currentLibrary');
      const songs = vi.spyOn(ShowsController.prototype, 'currentSongLibrary');
      const node = store.graphs[store.selectedPadKey!]!.nodes[0]!;
      store.beginGesture();
      for (let x = 1; x <= 30; x++) {
        store.moveNode(node, x, 42);
        flushSync();
      }
      store.endGesture();
      expect(store.saveStatus).toBe('saving');
      expect(shows).not.toHaveBeenCalled();
      expect(songs).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(shows).toHaveBeenCalledTimes(1);
      expect(songs).toHaveBeenCalledTimes(1);
      expect(store.saveStatus).toBe('saved');
      expect(savedNode(store.selectedPadKey!, node.id)).toMatchObject({ x: 30, y: 42 });
    } finally { ax.stopAutosave(); }
  });

  it('unload captures the latest deep edit even before its effect schedules a timer', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500); // no timer pending
      const node = store.graphs[store.selectedPadKey!]!.nodes[0]!;
      node.x = 999; // intentionally no flushSync
      window.dispatchEvent(new Event('beforeunload'));
      expect(savedNode(store.selectedPadKey!, node.id)?.x).toBe(999);
    } finally { ax.stopAutosave(); }
  });

  it('does not autosave or add history for canonical graph mutation attempts', () => {
    const store = new TriggerLab(fakeClient);
    const libraryId = store.exportSongToLibrary('set-1')!;
    store.importSongReference(libraryId);
    store.setActiveSong(libraryId);
    const section = store.activeSong!.sections[0]!;
    const graphKey = section.graphs.find((key) => store.resolvedView.graphs[key])!;
    store.selectGraphInSection(section.id, graphKey);
    const node = store.selectedGraph!.nodes.find((candidate) => candidate.kind === 'effect')!;

    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const before = localStorage.getItem(SONGS_STORAGE_KEY);
      const beforeNodeCount = store.selectedGraph!.nodes.length;
      const beforeEdgeCount = store.selectedGraph!.edges.length;
      const beforeParams = { ...node.params };

      expect(store.canEditSelectedGraph).toBe(false);
      expect(store.addNode('effect', 100, 100)).toBeNull();
      store.setParam(node, 'hue', 0.12);
      store.removeNode(node);
      store.connect('trigger', node.id);
      flushSync();
      vi.advanceTimersByTime(500);

      expect(localStorage.getItem(SONGS_STORAGE_KEY)).toBe(before);
      expect(store.selectedGraph!.nodes).toHaveLength(beforeNodeCount);
      expect(store.selectedGraph!.edges).toHaveLength(beforeEdgeCount);
      expect(node.params).toEqual(beforeParams);
      expect(store.undo()).toBe(false);
    } finally {
      ax.stopAutosave();
    }
  });

  it('keeps every public graph mutator read-only for a canonical selection', () => {
    const store = new TriggerLab(fakeClient);
    const localSectionId = store.activeSectionId!;
    const probeKey = store.createGraphInSection(localSectionId, 'Canonical mutator probe');
    expect(probeKey).toBeTruthy();

    // Export a graph containing one real node for every node-specific mutator. The graph is
    // created before the baseline; every action below then targets the resolved canonical copy.
    const kinds: NodeKind[] = [
      'effect', 'modifier', 'envelope', 'lfo', 'cc', 'note', 'osc', 'randomMod', 'delay',
      'splice', 'sequence', 'switch', 'chance', 'random', 'toggle', 'all', 'scope', 'mix',
    ];
    for (const [index, kind] of kinds.entries()) store.addNode(kind, 200 + index * 20, 120 + index * 10);
    const libraryId = store.exportSongToLibrary(store.activeSongId)!;
    store.importSongReference(libraryId);
    store.setActiveSong(libraryId);
    const libraryGraphs = store.songLibrary.songs[libraryId]!.graphs;
    const canonicalKey = Object.keys(libraryGraphs).find((key) => libraryGraphs[key]!.nodes.some((node) => node.kind === 'note'))!;
    const section = store.activeSong!.sections.find((candidate) => candidate.graphs.includes(canonicalKey))!;
    store.selectGraphInSection(section.id, canonicalKey);

    const node = (kind: NodeKind): GraphNode => store.selectedGraph!.nodes.find((candidate) => candidate.kind === kind)!;
    const edgeId = store.selectedGraph!.edges[0]?.id ?? 'missing-edge';
    const graphKey = store.selectedPadKey!;
    const actions: Array<{ name: string; run: () => unknown }> = [
      { name: 'addGraphToSection', run: () => store.addGraphToSection(section.id, graphKey) },
      { name: 'createGraphInSection', run: () => store.createGraphInSection(section.id, 'blocked') },
      { name: 'copyGraphToSection', run: () => store.copyGraphToSection(section.id, graphKey, 'blocked') },
      { name: 'linkGraphPlacement', run: () => store.linkGraphPlacement(libraryId, section.id, graphKey, libraryId, section.id, graphKey) },
      { name: 'unlinkGraphPlacement', run: () => store.unlinkGraphPlacement(libraryId, section.id, graphKey) },
      { name: 'removeGraphFromSection', run: () => store.removeGraphFromSection(section.id, graphKey) },
      { name: 'setSectionGraphs', run: () => store.setSectionGraphs(section.id, [graphKey]) },
      { name: 'moveGraphPlacement', run: () => store.moveGraphPlacement(section.id, graphKey, section.id, 0) },
      { name: 'renameGraph', run: () => store.renameGraph(graphKey, 'blocked') },
      { name: 'deleteGraph', run: () => store.deleteGraph(graphKey) },
      { name: 'setTriggerSource', run: () => store.setTriggerSource(graphKey, { kind: 'midi', note: 42 }) },
      { name: 'copyNode', run: () => store.copyNode(node('note')) },
      { name: 'pasteNode', run: () => store.pasteNode() },
      { name: 'duplicateNode', run: () => store.duplicateNode(node('note')) },
      { name: 'addNode', run: () => store.addNode('effect', 500, 500) },
      { name: 'addNodeWired', run: () => store.addNodeWired('effect', 500, 500, () => {}) },
      { name: 'addModifierNode', run: () => store.addModifierNode('trail', 500, 500) },
      { name: 'moveNode', run: () => store.moveNode(node('note'), 900, 900) },
      { name: 'setLiveNodePosition', run: () => store.setLiveNodePosition(node('note').id, 900, 900) },
      { name: 'removeNode', run: () => store.removeNode(node('note')) },
      { name: 'connect', run: () => store.connect(node('trigger').id, node('note').id) },
      { name: 'disconnect', run: () => store.disconnect(edgeId) },
      { name: 'reconnect', run: () => store.reconnect(edgeId, node('trigger').id, node('note').id) },
      { name: 'spliceOnDrop', run: () => store.spliceOnDrop(edgeId, node('note').id) },
      { name: 'setMixEdgeOpacity', run: () => store.setMixEdgeOpacity(edgeId, 0.2) },
      { name: 'setMixBlendMode', run: () => store.setMixBlendMode(node('mix'), 'screen') },
      { name: 'changeKind', run: () => store.changeKind(node('note'), 'lfo') },
      { name: 'setMode', run: () => store.setMode(node('effect'), 'loop') },
      { name: 'setScope', run: () => store.setScope(node('effect'), 'kit') },
      { name: 'setTargetId', run: () => store.setTargetId(node('effect'), 'kick') },
      { name: 'setNoRepeat', run: () => store.setNoRepeat(node('random'), true) },
      { name: 'setChance', run: () => store.setChance(node('chance'), 0.2) },
      { name: 'setSwitchOn', run: () => store.setSwitchOn(node('switch'), 'value') },
      { name: 'setValueMode', run: () => store.setValueMode(node('switch'), 'bands') },
      { name: 'setThreshold', run: () => store.setThreshold(node('switch'), 0.2) },
      { name: 'setInvert', run: () => store.setInvert(node('switch'), true) },
      { name: 'setDelayMode', run: () => store.setDelayMode(node('delay'), 'beats') },
      { name: 'setDelayMs', run: () => store.setDelayMs(node('delay'), 200) },
      { name: 'setDivision', run: () => store.setDivision(node('delay'), '1/8') },
      { name: 'setSpliceSetting', run: () => store.setSpliceSetting(node('splice'), { spliceJitter: 2 }) },
      { name: 'setSpliceCount', run: () => store.setSpliceCount(node('splice'), 3) },
      { name: 'setSpliceAt', run: () => store.setSpliceAt(node('splice'), 0, { muted: true }) },
      { name: 'addSplice', run: () => store.addSplice(node('splice')) },
      { name: 'removeSplice', run: () => store.removeSplice(node('splice'), 0) },
      { name: 'setSequenceResetSource', run: () => store.setSequenceResetSource(node('sequence'), { kind: 'midi', note: 42 }) },
      { name: 'addBand', run: () => store.addBand(node('switch')) },
      { name: 'removeBand', run: () => store.removeBand(node('switch'), 0) },
      { name: 'setBandCutoff', run: () => store.setBandCutoff(node('switch'), 0, 0.2) },
      { name: 'pickEffect', run: () => store.pickEffect(node('effect'), store.effects[0]!.id) },
      { name: 'setPlayCollection', run: () => store.setPlayCollection(node('effect'), 'ambient') },
      { name: 'setCanvasScene', run: () => store.setCanvasScene(node('effect'), store.allCanvasScenes[0]!.id) },
      { name: 'setBus', run: () => store.setBus(node('effect'), store.buses[0]!.id) },
      { name: 'selectPreset', run: () => store.selectPreset(node('effect'), node('effect').presetId) },
      { name: 'applyPreset', run: () => store.applyPreset(node('effect')) },
      { name: 'saveNodeAsPreset', run: () => store.saveNodeAsPreset(node('effect'), 'blocked') },
      { name: 'setParam', run: () => store.setParam(node('effect'), 'hue', 0.2) },
      { name: 'setLifeEnvelope', run: () => store.setLifeEnvelope(node('effect'), null) },
      { name: 'updateLifeEnvelope', run: () => store.updateLifeEnvelope(node('effect'), { h0: { x: 0, y: 0 }, h1: { x: 1, y: 1 }, profile: 'bend', strength: 0 }) },
      { name: 'setModifierId', run: () => store.setModifierId(node('modifier'), 'trail') },
      { name: 'setModifierBypass', run: () => store.setModifierBypass(node('modifier'), true) },
      { name: 'setEnvKind', run: () => store.setEnvKind(node('effect'), 'hue', 'custom') },
      { name: 'setEnvAmount', run: () => store.setEnvAmount(node('effect'), 'hue', 0.5) },
      { name: 'setEnvPoints', run: () => store.setEnvPoints(node('effect'), 'hue', []) },
      { name: 'setEnvAdsr', run: () => store.setEnvAdsr(node('effect'), 'hue', { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 }) },
      { name: 'addModInput', run: () => store.addModInput(node('effect'), 'hue') },
      { name: 'addFaceParam', run: () => store.addFaceParam(node('effect'), 'hue') },
      { name: 'removeFaceParam', run: () => store.removeFaceParam(node('effect'), 'hue') },
      { name: 'removeModInput', run: () => store.removeModInput(node('effect'), 'hue') },
      { name: 'setMappingAmount', run: () => store.setMappingAmount(edgeId, 0.2) },
      { name: 'setMappingInvert', run: () => store.setMappingInvert(edgeId, true) },
      { name: 'setMappingRange', run: () => store.setMappingRange(edgeId, 0, 0.2) },
      { name: 'setEnvelopeNodeAdsr', run: () => store.setEnvelopeNodeAdsr(node('envelope'), { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 }) },
      { name: 'setLfo', run: () => store.setLfo(node('lfo'), { rateHz: 2 }) },
      { name: 'setCcController', run: () => store.setCcController(node('cc'), 2) },
      { name: 'setCcChannel', run: () => store.setCcChannel(node('cc'), 2) },
      { name: 'setCcNodeSource', run: () => store.setCcNodeSource(node('cc'), 'osc') },
      { name: 'setOscNodeAddress', run: () => store.setOscNodeAddress(node('osc'), '/blocked') },
      { name: 'setNoteNodeNumber', run: () => store.setNoteNodeNumber(node('note'), 62) },
      { name: 'setNoteNodeChannel', run: () => store.setNoteNodeChannel(node('note'), 2) },
      { name: 'setNoteNodeMode', run: () => store.setNoteNodeMode(node('note'), 'velocity') },
      { name: 'setNoteNodeReleaseMs', run: () => store.setNoteNodeReleaseMs(node('note'), 200) },
      { name: 'setRandomDistribution', run: () => store.setRandomDistribution(node('randomMod'), 'stepped') },
      { name: 'setRandomSteps', run: () => store.setRandomSteps(node('randomMod'), 8) },
    ];

    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void; history: { stats: { entries: number; bytes: number } } };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const beforeLibrary = JSON.stringify(store.songLibrary.songs[libraryId]);
      const beforeShows = localStorage.getItem(SHOWS_STORAGE_KEY);
      const beforeSongs = localStorage.getItem(SONGS_STORAGE_KEY);
      const beforeHistory = { ...ax.history.stats };
      const beforeClipboard = JSON.stringify(store.nodeClipboard);
      expect(store.canMutateGraph(graphKey)).toBe(false);

      for (const action of actions) {
        action.run();
        flushSync();
        vi.advanceTimersByTime(500);
        expect(JSON.stringify(store.songLibrary.songs[libraryId]), action.name).toBe(beforeLibrary);
        expect(localStorage.getItem(SHOWS_STORAGE_KEY), action.name).toBe(beforeShows);
        expect(localStorage.getItem(SONGS_STORAGE_KEY), action.name).toBe(beforeSongs);
        expect(ax.history.stats, action.name).toEqual(beforeHistory);
        expect(JSON.stringify(store.nodeClipboard), action.name).toBe(beforeClipboard);
      }
    } finally {
      ax.stopAutosave();
    }
  });

  it('tracks optional field add/delete and array changes, and disposes outgoing graph subscriptions', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const key = store.selectedPadKey!;
      const graph = store.graphs[key]!;
      const node = graph.nodes[0]!;
      node.params.newValue = 23;
      graph.edges.push({ id: 'probe', from: node.id, to: 'output' });
      flushSync();
      vi.advanceTimersByTime(500);
      let saved = JSON.parse(localStorage.getItem(SHOWS_STORAGE_KEY)!).data.shows[store.activeShowId].authored.graphs[key];
      expect(saved.nodes[0].params.newValue).toBe(23);
      expect(saved.edges.at(-1).id).toBe('probe');
      delete node.params.newValue;
      graph.edges.pop();
      flushSync();
      vi.advanceTimersByTime(500);
      saved = JSON.parse(localStorage.getItem(SHOWS_STORAGE_KEY)!).data.shows[store.activeShowId].authored.graphs[key];
      expect(saved.nodes[0].params).not.toHaveProperty('newValue');
      expect(saved.edges.some((e: { id: string }) => e.id === 'probe')).toBe(false);
      store.newShow();
      flushSync();
      vi.advanceTimersByTime(500);
      const snapshots = vi.spyOn(ShowsController.prototype, 'currentLibrary');
      node.x = 9999; // stale UI reference, its subscription must have been disposed
      flushSync();
      vi.advanceTimersByTime(500);
      expect(snapshots).not.toHaveBeenCalled();
    } finally { ax.stopAutosave(); }
  });

  it('flushes current and outgoing shows, never a captured pre-switch library', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const a = store.activeShowId;
      store.bpm = 177;
      flushSync();
      const b = store.newShow('B');
      store.bpm = 99;
      flushSync();
      vi.advanceTimersByTime(500);
      const saved = JSON.parse(localStorage.getItem(SHOWS_STORAGE_KEY)!).data;
      expect(saved.activeShowId).toBe(b);
      expect(saved.shows[a].authored.bpm).toBe(177);
      expect(saved.shows[b].authored.bpm).toBe(99);
    } finally { ax.stopAutosave(); }
  });

  it('explicit Save flushes the latest revision immediately and observes the indicator floor', () => {
    const store = new TriggerLab(fakeClient);
    store.bpm = 143;
    const shows = vi.spyOn(ShowsController.prototype, 'currentLibrary');
    store.saveShow();
    expect(shows).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(SHOWS_STORAGE_KEY)!).data.shows[store.activeShowId].authored.bpm).toBe(143);
    expect(store.saveStatus).toBe('saving');
    vi.advanceTimersByTime(149);
    expect(store.saveStatus).toBe('saving');
    vi.advanceTimersByTime(1);
    expect(store.saveStatus).toBe('saved');
    store.bpm = 144;
    store.saveShow();
    expect(store.saveStatus).toBe('saving');
  });

  it('does not claim Saved on a cache failure, and a later successful save recovers', () => {
    const store = new TriggerLab(fakeClient);
    store.saveShow(); // a successful flush still waiting on its 150 ms indicator floor
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    store.saveShow();
    vi.advanceTimersByTime(500);
    expect(store.saveStatus).toBe('idle');
    write.mockRestore();
    store.saveShow();
    expect(store.saveStatus).toBe('saving');
    vi.advanceTimersByTime(500);
    expect(store.saveStatus).toBe('saved');
  });

  it('materializes once when connected, omits cached recall, and signature-skips no-ops', () => {
    let cb: WSCallbacks = {};
    const sent: ClientMessage[] = [];
    const store = new TriggerLab(() => ({ on(callbacks: WSCallbacks) { cb = callbacks; }, connect() {}, close() {}, send(m: ClientMessage) { sent.push(m); } }) as unknown as WSClient);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    store.start();
    try {
      cb.onConnection!('open');
      cb.onState!(defaultProject(), { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } }, [], [], { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 }, null, null, null, { status: 'listening', port: 9000, hosts: [] });
      flushSync();
      vi.advanceTimersByTime(500);
      expect(store.saveStatus).toBe('idle'); // no initial mount blip
      sent.length = 0;
      const shows = vi.spyOn(ShowsController.prototype, 'currentLibrary');
      const songs = vi.spyOn(ShowsController.prototype, 'currentSongLibrary');
      store.graphs[store.selectedPadKey!]!.nodes[0]!.source = { kind: 'midi', note: 99 };
      flushSync();
      expect(shows).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(shows).toHaveBeenCalledTimes(1);
      expect(songs).toHaveBeenCalledTimes(1);
      const pushed = sent.find((m) => m.t === 'setShowLibrary');
      expect(pushed?.t === 'setShowLibrary' && JSON.stringify(pushed.library)).toBe(localStorage.getItem(SHOWS_STORAGE_KEY));
      expect(sent.map((m) => m.t)).toEqual(['setShow', 'setShowLibrary']);
      sent.length = 0;
      store.saveShow();
      expect(sent).toEqual([]); // no-op signature guards still hold
      const previousPayload = JSON.stringify(pushed);
      store.newShow();
      store.bpm = 87;
      store.saveShow();
      expect(JSON.stringify(pushed)).toBe(previousPayload); // shared inactive slots never mutate
    } finally { store.stop(); vi.unstubAllGlobals(); }
  });

  it('tracks canonical song-library deep edits independently of the active show', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.exportSongToLibrary(store.activeSongId)!;
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    try {
      flushSync();
      vi.advanceTimersByTime(500);
      const song = store.songLibrary.songs[id]!;
      const key = Object.keys(song.graphs)[0]!;
      song.graphs[key]!.nodes[0]!.x = 2468;
      flushSync();
      vi.advanceTimersByTime(500);
      expect(JSON.parse(localStorage.getItem(SONGS_STORAGE_KEY)!).data.songs[id].graphs[key].nodes[0].x).toBe(2468);
    } finally { ax.stopAutosave(); }
  });
});
