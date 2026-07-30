/* INIT-02 S14 — the five `*ControllerHost` seams are REAL, not hypothetical.

   speculative-generality-0001's charge was that the five Host interfaces are one-adapter seams
   invented for a split that never grew a second implementation. Publishing the controllers
   (S3–S13) answered the forwarder half; this file answers the Host half with evidence: every
   controller is constructed here against a PLAIN OBJECT LITERAL host and asserted on, with the
   store nowhere in the file.

   The grep is the proof, and it is part of the step's verification: searching this file for the
   store class's name must print NOTHING (which is why that name is not spelled out even in this
   comment — a mention would defeat the gate).

       rg -n '<store-class-name>' apps/web/src/lib/trigger-lab/controller-seams.test.ts

   Keep it that way. If a future host change makes a controller un-stubbable without dragging the
   store in, that is the seam leaking — narrow the Host rather than importing the store here.

   Findings recorded while stubbing (per controller, the declared Host surface was SUFFICIENT —
   no controller needed more than its interface declares):
     - ControllerTestHost      3 members — send / isViewer / currentTestPattern
     - ControllerMonitorHost   3 members — send / isViewer / setOutput
     - SectionsControllerHost  5 members — isViewer / activeSong / activeSongId / songs / setSongs
     - MidiControllerHost      5 members — isViewer / getInputMap / setInputMap / setTriggerSource /
                                           selectedGraphNodes
     - ShowsControllerHost    12 members — the widest seam, but still satisfiable from literals;
                                           only the graph-model reads and authored-swap hooks are
                                           needed for the behaviour asserted here. */

import { describe, expect, it } from 'vitest';
import { ControllerTest, type ControllerTestHost } from './controller-test.svelte';
import { ControllerMonitor, type ControllerMonitorHost } from './controller-monitor.svelte';
import { SectionsController, type SectionsControllerHost } from './sections-controller.svelte';
import { MidiController, type MidiControllerHost } from './midi-controller.svelte';
import { ShowsController, type ShowsControllerHost } from './shows-controller.svelte';
import { makeSection, makeSong, type Song } from '../app/setlist';
import type { ClientMessage, ControllerTestPattern, DiscoveredController } from '../ws/protocol-types';
import type { AuthoredState } from './persistence';
import type { GraphNode } from './sim';
import type { InputMap } from '@ledrums/core';

describe('ControllerTestHost — stubbable without the store', () => {
  it('reads takeover from the host and sends the takeover message when not a viewer', () => {
    const sent: ClientMessage[] = [];
    const rgbwCycle: ControllerTestPattern = { op: 'rgbwCycle' };
    let pattern: ControllerTestPattern | null = null;
    const host: ControllerTestHost = {
      send: (msg) => sent.push(msg),
      isViewer: () => false,
      currentTestPattern: () => pattern,
    };
    const ctl = new ControllerTest(host);

    expect(ctl.takeover).toBeNull();
    ctl.setTestData(rgbwCycle);
    expect(sent).toEqual([{ t: 'controllerTestData', pattern: rgbwCycle }]);

    // The server echoes the active pattern back on status — the host is the one source of truth.
    pattern = rgbwCycle;
    expect(ctl.takeover).toEqual(rgbwCycle);
  });

  it('no-ops the LOUD takeover for a read-only viewer (S2)', () => {
    const sent: ClientMessage[] = [];
    const ctl = new ControllerTest({
      send: (msg) => sent.push(msg),
      isViewer: () => true,
      currentTestPattern: () => null,
    });
    ctl.setTestData({ op: 'rgbwCycle' });
    ctl.backToLive();
    expect(sent).toEqual([]);
  });
});

describe('ControllerMonitorHost — stubbable without the store', () => {
  const candidate = (host: string): DiscoveredController => ({
    host,
    prodName: 'PixLite A16-S Mk3',
    nickname: host,
    fwVer: '1.4.2',
    authReqd: false,
    score: 10,
  });

  it('clearOnLinkDrop empties status + candidates (a dropped socket cannot confirm rx truth)', () => {
    const ctl = new ControllerMonitor({
      send: () => {},
      isViewer: () => false,
      setOutput: () => {},
    });
    ctl.ingestDiscovery([candidate('192.168.1.50'), candidate('192.168.1.51')]);
    expect(ctl.candidates).toHaveLength(2);
    expect(ctl.scanning).toBe(false);

    ctl.clearOnLinkDrop();
    expect(ctl.candidates).toEqual([]);
    expect(ctl.status).toBeNull();
  });

  it('adopt re-points the output transport through the host in the same click', () => {
    const sent: ClientMessage[] = [];
    const outputs: { host: string }[] = [];
    const ctl = new ControllerMonitor({
      send: (msg) => sent.push(msg),
      isViewer: () => false,
      setOutput: (patch) => outputs.push(patch),
    });
    ctl.adopt('192.168.1.50');
    expect(sent).toEqual([{ t: 'adoptController', host: '192.168.1.50' }]);
    expect(outputs).toEqual([{ host: '192.168.1.50' }]);
  });
});

describe('SectionsControllerHost — stubbable without the store', () => {
  /** A host over a mutable local `songs` array — the whole seam is "read the songs rune, write it back". */
  function stubHost(initial: Song[]): { host: SectionsControllerHost; read: () => Song[] } {
    let songs = initial;
    return {
      host: {
        isViewer: () => false,
        activeSong: () => songs.find((s) => s.id === 'song-1') ?? null,
        activeSongId: () => 'song-1',
        songs: () => songs,
        setSongs: (next) => (songs = next),
      },
      read: () => songs,
    };
  }

  it('moveSection reorders the active song in place, leaving every other song untouched', () => {
    const song = makeSong('song-1', 'Song 1', [
      makeSection('sec-a', 'A'),
      makeSection('sec-b', 'B'),
      makeSection('sec-c', 'C'),
    ]);
    const other = makeSong('song-2', 'Song 2', [makeSection('sec-z', 'Z')]);
    const { host, read } = stubHost([song, other]);
    const ctl = new SectionsController(host);

    ctl.moveSection('sec-c', 0);

    expect(read()[0]?.sections.map((s) => s.id)).toEqual(['sec-c', 'sec-a', 'sec-b']);
    expect(read()[1]).toBe(other); // untouched by identity — the edit is immutable + targeted
  });

  it('the viewer guard covers the whole section-edit chokepoint (S2)', () => {
    const song = makeSong('song-1', 'Song 1', [makeSection('sec-a', 'A'), makeSection('sec-b', 'B')]);
    let songs: Song[] = [song];
    const ctl = new SectionsController({
      isViewer: () => true,
      activeSong: () => songs[0] ?? null,
      activeSongId: () => 'song-1',
      songs: () => songs,
      setSongs: (next) => (songs = next),
    });
    ctl.moveSection('sec-b', 0);
    ctl.renameSection('sec-a', 'renamed');
    expect(songs[0]).toBe(song); // nothing written back at all
  });
});

describe('MidiControllerHost — stubbable without the store', () => {
  const emptyInputMap = (): InputMap => ({ midiNotes: [], midiChannel: null, oscMap: [], zones: [] });

  it('a zone note-learn binds through the host input map and disarms', () => {
    let inputMap: InputMap | null = emptyInputMap();
    const ctl = new MidiController({
      isViewer: () => false,
      getInputMap: () => inputMap,
      setInputMap: (next) => (inputMap = next),
      setTriggerSource: () => {},
      selectedGraphNodes: () => undefined,
    });

    ctl.startLearn({ kind: 'zone', drumId: 'snare', slot: 0 });
    expect(ctl.learnTarget).toEqual({ kind: 'zone', drumId: 'snare', slot: 0 });

    ctl.applyNoteLearn(38);
    expect(inputMap?.midiNotes).toEqual([{ note: 38, drumId: 'snare', slot: 0 }]);
    expect(ctl.learnTarget).toBeNull();
  });

  it('a cc-node learn skips the reserved controller 0 and stays armed for a real CC', () => {
    const node = { id: 'n1', kind: 'cc', ccController: 7 } as unknown as GraphNode;
    const ctl = new MidiController({
      isViewer: () => false,
      getInputMap: () => null,
      setInputMap: () => {},
      setTriggerSource: () => {},
      selectedGraphNodes: () => [node],
    });

    ctl.startLearn({ kind: 'cc-node', nodeId: 'n1' });
    ctl.applyCcLearn(0); // reserved for section recall — never learned
    expect(ctl.learnTarget).toEqual({ kind: 'cc-node', nodeId: 'n1' });

    ctl.applyCcLearn(21);
    expect((node as unknown as { ccController: number }).ccController).toBe(21);
    expect(ctl.learnTarget).toBeNull();
  });
});

describe('ShowsControllerHost — stubbable without the store', () => {
  /** The widest of the five seams; still a plain literal. Authored reads/writes are no-ops here
      because the behaviour asserted below never swaps the authored document. */
  function stubHost(overrides: Partial<ShowsControllerHost> = {}): ShowsControllerHost {
    return {
      graphs: () => ({}),
      graphNames: () => ({}),
      effects: () => [],
      presets: () => [],
      mergeGraphModel: () => {},
      toAuthored: () => ({}) as AuthoredState,
      applyShow: () => {},
      resetAuthoredToSeed: () => {},
      normalizeGraphs: () => {},
      setActiveSectionId: () => {},
      isViewer: () => false,
      linkOpen: () => false,
      send: () => {},
      ...overrides,
    };
  }

  it('renameShow rewrites only the named show in the library', () => {
    const ctl = new ShowsController(stubHost());
    ctl.showLibrary = {
      's-1': { id: 's-1', name: 'One', authored: {} as AuthoredState },
      's-2': { id: 's-2', name: 'Two', authored: {} as AuthoredState },
    };

    ctl.renameShow('s-1', 'Renamed');

    expect(ctl.showLibrary['s-1']?.name).toBe('Renamed');
    expect(ctl.showLibrary['s-2']?.name).toBe('Two');
  });

  it('renameShow no-ops for a read-only viewer (S2)', () => {
    const ctl = new ShowsController(stubHost({ isViewer: () => true }));
    ctl.showLibrary = { 's-1': { id: 's-1', name: 'One', authored: {} as AuthoredState } };

    ctl.renameShow('s-1', 'Renamed');

    expect(ctl.showLibrary['s-1']?.name).toBe('One');
  });
});
