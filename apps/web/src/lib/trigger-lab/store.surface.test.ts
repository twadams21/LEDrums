import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TriggerLab } from './store.svelte';
import { MemStorage } from '../test-support/mem-storage';
import { harnessClient, newHarness } from '../test-support/ws-harness';

/* INSTRUMENT (INIT-02 S1) — the store's public surface, pinned.
   Nothing else in the suite can tell you whether a refactor REMOVED a member, MOVED one, or
   quietly ADDED one; a green suite proves the members that are exercised still work, never that
   the set is the set you meant. This file is the arbiter for the whole store-decomposition
   initiative: every step that publishes a collaborator and deletes its forwarders must show up
   here as an exact removal/addition count, in the same commit as the change.

   How the inventory is taken: Svelte 5 compiles class `$state`/`$derived` fields to PROTOTYPE
   accessors, so the members do not all live on the instance — the surface is the union of
   `Object.getOwnPropertyNames(Object.getPrototypeOf(store))` (accessors + methods) and
   `Object.keys(store)` (plain own fields, including TS-`private` ones, which are private only
   at compile time). `constructor` and `_`-prefixed names are filtered out — so an added member
   that a probe wants this instrument to catch must NOT be `_`-prefixed (the plan's suggested
   `__probe` would be filtered out and prove nothing; `zzProbe` is what was used, and both the
   inventory and the LOC ratchet caught it).

   Hermetic BY ENFORCEMENT, not by hope: the default constructor builds a real WSClient and OPENS
   A SOCKET, which would make the one instrument this plan's parity evidence hangs off the
   flakiest test in the suite. So the injected harness client is not optional AND
   `globalThis.WebSocket` is poisoned to throw for the duration — if anyone ever makes the store
   dial out on construction, this file fails loudly instead of going flaky. localStorage is the
   shared MemStorage double, same beforeEach/afterEach pair as store.shows.test.ts. */

/* THE RULE (INIT-02 S23). Both caps sit at the MEASURED post-migration values with no slack, so
   the very next member or line trips them. Decomposition steps only shrink them — publishing a
   collaborator deletes forwarders — so the direction is down. That is not a law, though: NEW
   BEHAVIOUR can legitimately raise a cap, and S22 did (`saveError` + `writeLocalCaches`, the
   honest save-error state). **A commit that raises a cap must say why in its message.** A commit
   that raises one silently is the thing this instrument exists to catch.

   Where INIT-02 got to, and what it did NOT finish: 384 members / 3519 LOC before S1 (measured at
   7c16a07^) down to the values below — 64 members and 261 lines removed across five published
   collaborators. divergent-change-0002 is NOT closed by that: eight change axes still converge on
   store.svelte.ts. They are enumerated, ordered and owned in
   docs/plans/2026-07-26-deep-review/09-synthesis/INIT-02-followon-authoring-document.json —
   a real artifact rather than this comment, so a later phase can pick the work up. */

/** Ceiling on the member count — the measured value at this commit, exactly. */
const MEMBER_CAP = 320;
/** Ceiling on store.svelte.ts's line count — likewise measured, likewise exact. */
const LOC_CAP = 3258;

const EXPECTED_MEMBERS: string[] = [
  'acceptsMidiChannel',
  'addBand',
  'addModInput',
  'addModifierNode',
  'addMonitor',
  'addNode',
  'addPlayNode',
  'allCanvasScenes',
  'allPresets',
  'applyAuthored',
  'applyPreset',
  'applyRemapResult',
  'applyShow',
  'arrangement',
  'authFailCount',
  'authRequired',
  'autoWireEffectToOutput',
  'autosaveArmed',
  'availableModParams',
  'backups',
  'batchIntoCurrentUndo',
  'beat',
  'beatsPerBar',
  'blankFrame',
  'bootRecovery',
  'bpm',
  'buildPatchDoc',
  'busLevels',
  'busLevelsDisplay',
  'busOf',
  'buses',
  'canEdit',
  'canSplice',
  'canTakeover',
  'cancelPasteFallback',
  'canvasEffects',
  'canvasSceneJson',
  'canvasScenes',
  'ccNodeChannel',
  'ccNodeController',
  'ccNodeLiveValue',
  'ccNodeSource',
  'changeKind',
  'clearMonitor',
  'clearServerError',
  'client',
  'clipMeta',
  'clipSources',
  'closeEnv',
  'closeGallery',
  'closeSettings',
  'closeSongPaste',
  'connect',
  'controllerMonitor',
  'controllerTest',
  'copyGraphToClipboard',
  'copyNode',
  'copyPatch',
  'copySectionToClipboard',
  'copySongToClipboard',
  'createCanvasScene',
  'createGraph',
  'deleteCanvasScene',
  'deleteGraph',
  'deletePreset',
  'disconnect',
  'dockVoices',
  'dockVoicesDisplay',
  'drums',
  'duplicateCanvasScene',
  'duplicateEffect',
  'duplicateGraph',
  'duplicateNode',
  'duplicatePreset',
  'editEdge',
  'editorLabel',
  'effectName',
  'effectOf',
  'effects',
  'effectsForScope',
  'enginePreviewLive',
  'engineSync',
  'engineTransportLive',
  'ensureValueDefaults',
  'envKind',
  'envTarget',
  'envelopeNodeAdsr',
  'envelopeNodeEnvelope',
  'errorCaptureUninstall',
  'findResolvedSection',
  'finishPaste',
  'fireSectionGraph',
  'fireSeq',
  'flushOnUnload',
  'forwardMidi',
  'fps',
  'fpsLast',
  'freshEdgeId',
  'freshNodeId',
  'galleryBlock',
  'getEnvelope',
  'graphFireAt',
  'graphLabel',
  'graphLibrary',
  'graphNames',
  'graphs',
  'hit',
  'identifyHoop',
  'inputActivity',
  'inputBadge',
  'isBindableCcController',
  'isBuiltinCanvasScene',
  'isEnveloped',
  'isViewer',
  'kitDrumInfos',
  'labModel',
  'last',
  'lastOscHeard',
  'lastSectionFire',
  'latencyMs',
  'lfoSettings',
  'library',
  'link',
  'liveCcTable',
  'liveInput',
  'liveNodePositions',
  'liveNodeY',
  'liveOscTable',
  'liveParams',
  'mappedDrumIdForMidiNote',
  'mappingsFor',
  'markGraphFire',
  'materializePaste',
  'midi',
  'midiChannel',
  'modInputsOf',
  'modSourcesFor',
  'modTargetSpecs',
  'model',
  'monitorDestinationFilter',
  'monitorEvents',
  'monitorForClientMessage',
  'monitorSeq',
  'monitorSourceFilter',
  'monitorTextFilter',
  'monitorTypeFilter',
  'moveNode',
  'nodeClipboard',
  'normalizeGraphs',
  'noteNodeChannel',
  'noteNodeLiveValue',
  'noteNodeMode',
  'noteNodeNumber',
  'noteNodeReleaseMs',
  'nowTick',
  'openEnv',
  'openGallery',
  'openSettings',
  'openSongPaste',
  'oscHeardBadge',
  'oscListen',
  'oscNodeAddress',
  'oscNodeLiveValue',
  'output',
  'outputPacketsPerSec',
  'pads',
  'paneSizes',
  'pasteFallback',
  'pasteGraphFromClipboard',
  'pasteNode',
  'pasteSectionFromClipboard',
  'pasteSong',
  'pasteSongText',
  'patchLabels',
  'persistDispose',
  'pickEffect',
  'placeClone',
  'playing',
  'presence',
  'presetById',
  'presetUsageCount',
  'presets',
  'presetsForEffect',
  'prevPacketSample',
  'previewFrame',
  'project',
  'pushUndoSnapshot',
  'raf',
  'randomDistribution',
  'randomSteps',
  'receiveInputEcho',
  'reconnect',
  'recordInputActivity',
  'refreshBackups',
  'remapBandPorts',
  'remapCtx',
  'removeBand',
  'removeModInput',
  'removeNode',
  'renameCanvasScene',
  'renameEffect',
  'renameGraph',
  'renamePreset',
  'reportError',
  'resetAuthoredToSeed',
  'resetMonitorFilters',
  'resolveHitGraphsLocal',
  'restoreBackup',
  'restoringUndo',
  'role',
  'runUndoable',
  'saveError',
  'saveNodeAsPreset',
  'saveStatus',
  'saveStatusCtl',
  'saveTimer',
  'scheduleSave',
  'selectGraphInSection',
  'selectPreset',
  'selectableEffects',
  'selectedGraph',
  'selectedGraphFireAt',
  'selectedPad',
  'selectedPadKey',
  'serverError',
  'serverFrame',
  'serverModel',
  'serverVoices',
  'setActiveSection',
  'setBandCutoff',
  'setBus',
  'setCanvasScene',
  'setCcChannel',
  'setCcController',
  'setCcNodeSource',
  'setChance',
  'setCrossfade',
  'setDelayMode',
  'setDelayMs',
  'setDivision',
  'setDrumTransform',
  'setEnvAdsr',
  'setEnvAmount',
  'setEnvKind',
  'setEnvPoints',
  'setEnvelopeNodeAdsr',
  'setHoopConfig',
  'setInputMap',
  'setInvert',
  'setKitGlobal',
  'setLfo',
  'setLiveNodePosition',
  'setMappingAmount',
  'setMappingInvert',
  'setMappingRange',
  'setMidiChannel',
  'setMixBlendMode',
  'setMixEdgeOpacity',
  'setMode',
  'setModifierBypass',
  'setModifierId',
  'setMonitorDestinationFilter',
  'setMonitorSourceFilter',
  'setMonitorTextFilter',
  'setMonitorTypeFilter',
  'setNoRepeat',
  'setNodeLayout',
  'setNoteNodeChannel',
  'setNoteNodeMode',
  'setNoteNodeNumber',
  'setNoteNodeReleaseMs',
  'setOscNodeAddress',
  'setOutput',
  'setParam',
  'setPatchLabel',
  'setPolyphony',
  'setProjectPatch',
  'setRandomDistribution',
  'setRandomSteps',
  'setRouting',
  'setScope',
  'setSharing',
  'setSwitchOn',
  'setTargetId',
  'setThreshold',
  'setTriggerSource',
  'setValueMode',
  'settingsBlock',
  'showSource',
  'songPasteOpen',
  'sourceDrumIdForTriggerSource',
  'spliceOnDrop',
  'start',
  'startAutosave',
  'stop',
  'stopAutosave',
  'stripBandPorts',
  'submitPasteFallback',
  'submitPin',
  'suppressUndoSnapshot',
  'syncShowToServer',
  'syncTransport',
  'takeover',
  'tickDockDisplay',
  'timeMs',
  'toAuthored',
  'togglePlay',
  'triggerSource',
  'tunnel',
  'undo',
  'undoLimit',
  'undoStack',
  'updateCanvasSceneJson',
  'useServer',
  'velocity',
  'visibleMonitorEvents',
  'voiceLevelDisplay',
  'wireClient',
  'writeClip',
  'writeLocalCaches',
];

function surfaceOf(o: object): string[] {
  return [
    ...new Set([...Object.getOwnPropertyNames(Object.getPrototypeOf(o)), ...Object.keys(o)]),
  ]
    .filter((n) => n !== 'constructor' && !n.startsWith('_'))
    .sort();
}

function newStore(): TriggerLab {
  return new TriggerLab(harnessClient(newHarness()));
}

let realWebSocket: unknown;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
  realWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = function poisoned(): never {
    throw new Error('store.surface.test.ts must not open a socket — the fake client is not optional');
  };
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { WebSocket?: unknown }).WebSocket = realWebSocket;
});

describe('store public surface', () => {
  it('is exactly the checked-in member inventory', () => {
    expect(surfaceOf(newStore())).toEqual(EXPECTED_MEMBERS);
  });

  it('stays under the member ratchet', () => {
    expect(EXPECTED_MEMBERS.length).toBeLessThanOrEqual(MEMBER_CAP);
  });

  it('keeps store.svelte.ts under the LOC ratchet', () => {
    const loc = readFileSync(new URL('./store.svelte.ts', import.meta.url), 'utf8').split('\n')
      .length;
    expect(loc).toBeLessThanOrEqual(LOC_CAP);
  });
});
