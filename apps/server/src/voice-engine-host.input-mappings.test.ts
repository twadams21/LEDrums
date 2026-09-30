import { describe, expect, it } from 'vitest';
import { defaultProject, effectChain, voice, withGlobalControlBinding } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { OutputManager } from './output-manager';
import { VoiceEngineHost } from './voice-engine-host';

/* MIDI-map InputMappings through the server host (effect chains wave 5): the host hands the
   runtime Show — mappings included — to the real engine, and the input precedence is
   global control > mapping > zone. Asserted on the live voices each input leaves playing
   (a chain voice's `pad` is `effect:<effectId>`). */

class FakeOutput implements PixelOutput {
  nextFrame(): void {}
  send(): void {}
  close(): void {}
}

const STEP = 1000 / 120;

function makeHost() {
  const project = defaultProject(); // note 36 is zone-mapped to kick / slot 0
  const host = new VoiceEngineHost(project, null, new OutputManager(() => new FakeOutput()));
  return { host, project };
}

const zone = (row: string) => ({ row, column: { kind: 'zone' as const, slot: 0 } });

const solid = (id: string, cell: effectChain.EffectCell): effectChain.Effect => effectChain.parseEffect({
  id, cell,
  generator: { kind: 'solid', style: 'solid', params: { color: '#ffffff' } },
  amp: { attackMs: 0, length: { ms: 2000 }, releaseMs: 10 },
});

function show(mappings: effectChain.InputMapping[]): voice.Show {
  const effects = [solid('kick-zone', zone('kick')), solid('snare-cell', zone('snare'))];
  return {
    ...voice.emptyShow(),
    songs: [{ id: 'song', name: 'Song', sections: [
      { id: 'A', name: 'A', slots: {}, effects },
      { id: 'B', name: 'B', slots: {}, effects },
    ] }],
    mappings,
  };
}

const MAP_36_TO_SNARE: effectChain.InputMapping = {
  id: 'm1', source: { midiNote: 36 }, target: { kind: 'fireCell', cell: zone('snare') },
};

function playing(host: VoiceEngineHost): string[] {
  for (let i = 0; i < 4; i++) host.step(STEP);
  return host.getStats().engine.voices.map((v) => v.pad).sort();
}

describe('VoiceEngineHost — InputMapping precedence (global control > mapping > zone)', () => {
  it('passes the show mappings to the engine: a zone-mapped note bound to a mapping fires the mapping, not the zone', () => {
    const { host } = makeHost();
    host.setShow(show([MAP_36_TO_SNARE]));
    host.applyInput({ kind: 'noteOn', note: 36, velocity: 1 });
    expect(playing(host)).toEqual(['effect:snare-cell']);
  });

  it('without the mapping the same note fires its zone Effect', () => {
    const { host } = makeHost();
    host.setShow(show([]));
    host.applyInput({ kind: 'noteOn', note: 36, velocity: 1 });
    expect(playing(host)).toEqual(['effect:kick-zone']);
  });

  it('a global control on the same note wins over the mapping', () => {
    const { host, project } = makeHost();
    host.setShow(show([MAP_36_TO_SNARE]));
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'nextSection', { midiNote: 36 }),
    });
    expect(host.getActiveSelection().activeSectionId).toBe('A');
    host.applyInput({ kind: 'noteOn', note: 36, velocity: 1 });
    expect(playing(host)).toEqual([]);
    expect(host.getActiveSelection().activeSectionId).toBe('B');
  });

  it('a mapped CC is consumed from CC Cues, and an OSC mapping beats the OSC zone-map', () => {
    const { host, project } = makeHost();
    const cue = effectChain.parseEffect({
      id: 'cc-cue', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiCc: 20 } },
      generator: { kind: 'solid', style: 'solid', params: { color: '#ffffff' } }, amp: { attackMs: 0, length: { ms: 2000 }, releaseMs: 10 },
    });
    const withCue = (mappings: effectChain.InputMapping[]): voice.Show => {
      const s = show(mappings);
      s.songs![0]!.sections[0]!.effects!.push(cue);
      return s;
    };
    // Control: unmapped, the CC's rising edge fires its Cue.
    host.setShow(withCue([]));
    host.applyInput({ kind: 'cc', controller: 20, value: 127 });
    expect(playing(host)).toEqual(['effect:cc-cue']);

    host.setShow(withCue([
      { id: 'cc', source: { midiCc: 20 }, target: { kind: 'opacity', effectId: 'kick-zone' } },
      { id: 'osc', source: { oscAddress: '/kick' }, target: { kind: 'fireEffect', effectId: 'snare-cell' } },
    ]));
    host.setInputMap({ ...project.inputMap, oscMap: [{ address: '/kick', drumId: 'kick', slot: 0 }] });
    host.applyInput({ kind: 'cc', controller: 20, value: 127 });
    expect(playing(host)).toEqual([]);
    host.applyInput({ kind: 'osc', address: '/kick', value: 1 });
    expect(playing(host)).toEqual(['effect:snare-cell']);
  });
});
