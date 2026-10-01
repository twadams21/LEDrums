import { describe, expect, it } from 'vitest';
import { defaultProject } from './defaults';
import { assertProjectIntegrity, kitDrumIds, ReferentialIntegrityError } from './integrity';

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
