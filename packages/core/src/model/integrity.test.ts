import { describe, expect, it } from 'vitest';
import { defaultProject } from './defaults';
import {
  assertProjectIntegrity,
  assertShowIntegrity,
  drumIdOfPadKey,
  isAuthoredGraphKey,
  kitDrumIds,
  ReferentialIntegrityError,
} from './integrity';

describe('assertProjectIntegrity', () => {
  it('passes for the canonical default project', () => {
    expect(() => assertProjectIntegrity(defaultProject())).not.toThrow();
  });

  it('exposes the kit drum id set', () => {
    expect(kitDrumIds(defaultProject().kit)).toEqual(new Set(['kick', 'snare', 'tom1', 'tom2']));
  });

  it('throws a named error when a setlist binding references a drum not in the kit', () => {
    const p = defaultProject();
    p.setlist.songs[0]!.sections[0]!.bindings.push({
      drumId: 'tom', // the classic drift: kit defines tom1, content says tom
      slot: 0,
      layerId: 'trigger',
      clipId: 'chase',
    });
    expect(() => assertProjectIntegrity(p)).toThrow(ReferentialIntegrityError);
    expect(() => assertProjectIntegrity(p)).toThrow(/drum "tom"/);
  });

  it('throws when an input map note references an unknown drum', () => {
    const p = defaultProject();
    p.inputMap.midiNotes.push({ note: 60, drumId: 'ghost', slot: 0 });
    expect(() => assertProjectIntegrity(p)).toThrow(/inputMap\.midiNotes note 60 → drum "ghost"/);
  });

  it('throws when an OSC mapping references an unknown drum', () => {
    const p = defaultProject();
    p.inputMap.oscMap.push({ address: '/sp/floor', drumId: 'floor', slot: 0 });
    expect(() => assertProjectIntegrity(p)).toThrow(/inputMap\.oscMap "\/sp\/floor" → drum "floor"/);
  });
});

describe('assertShowIntegrity', () => {
  const drumIds = ['kick', 'snare', 'tom1', 'tom2'];

  it('passes when every graph key resolves to a kit drum', () => {
    expect(() =>
      assertShowIntegrity({ drumIds, graphKeys: ['kick:0', 'snare:0', 'tom1:2'] }),
    ).not.toThrow();
  });

  it('throws naming the offending graph key when its drum is not in the kit', () => {
    expect(() => assertShowIntegrity({ drumIds, graphKeys: ['kick:0', 'tom:2'] })).toThrow(
      ReferentialIntegrityError,
    );
    expect(() => assertShowIntegrity({ drumIds, graphKeys: ['tom:2'] })).toThrow(
      /graph "tom:2" → drum "tom"/,
    );
  });

  it('passes when every setlist slot references a real graph', () => {
    expect(() =>
      assertShowIntegrity({
        drumIds,
        graphKeys: ['kick:0', 'snare:0'],
        slotRefs: ['kick:0', 'snare:0', 'kick:0'],
      }),
    ).not.toThrow();
  });

  it('throws naming a setlist slot that references a missing graph', () => {
    expect(() =>
      assertShowIntegrity({ drumIds, graphKeys: ['kick:0'], slotRefs: ['snare:9'] }),
    ).toThrow(/setlist slot → graph "snare:9"/);
  });

  it('accepts authored (non-pad) graph keys — fired by their trigger source, not a pad', () => {
    // U2/U3: store.createGraph mints `graph-<n>`; some content/docs use the `graph:<n>` form.
    // Both are standalone graphs (midi/osc-triggered), so neither resolves to a kit drum.
    expect(() =>
      assertShowIntegrity({ drumIds, graphKeys: ['graph:1', 'graph-2'] }),
    ).not.toThrow();
  });

  it('accepts authored graph keys alongside real pad graphs', () => {
    expect(() =>
      assertShowIntegrity({ drumIds, graphKeys: ['kick:0', 'graph:1', 'snare:0', 'graph-2'] }),
    ).not.toThrow();
  });

  it('still throws for a genuinely-dangling padKey even with authored graphs present', () => {
    // The authored carve-out must NOT swallow real drift: a `drumId:zone` whose drum
    // is not in the kit still fails.
    expect(() =>
      assertShowIntegrity({ drumIds, graphKeys: ['graph:1', 'unknownDrum:center'] }),
    ).toThrow(/graph "unknownDrum:center" → drum "unknownDrum"/);
  });

  it('lets a setlist slot reference an authored graph', () => {
    expect(() =>
      assertShowIntegrity({ drumIds, graphKeys: ['graph:1'], slotRefs: ['graph:1'] }),
    ).not.toThrow();
  });
});

describe('isAuthoredGraphKey', () => {
  it('matches authored graph keys in both separator forms', () => {
    expect(isAuthoredGraphKey('graph:1')).toBe(true);
    expect(isAuthoredGraphKey('graph-2')).toBe(true);
  });

  it('does not match pad keys', () => {
    expect(isAuthoredGraphKey('kick:0')).toBe(false);
    expect(isAuthoredGraphKey('unknownDrum:center')).toBe(false);
    expect(isAuthoredGraphKey('kick')).toBe(false);
  });
});

describe('drumIdOfPadKey', () => {
  it('extracts the drum id from a padKey', () => {
    expect(drumIdOfPadKey('tom1:2')).toBe('tom1');
    expect(drumIdOfPadKey('kick')).toBe('kick');
  });
});
