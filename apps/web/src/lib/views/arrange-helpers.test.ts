import { describe, expect, it } from 'vitest';
import type { Layer, Section, TriggerBinding } from '@ledrums/core';
import { bindingFor, describeBinding, selectedLayerClip } from './arrange-helpers';

const bindings: TriggerBinding[] = [
  { drumId: 'kick', slot: 0, layerId: 'base', clipId: 'pulse' },
  { drumId: 'snare', slot: 2, layerId: 'hits', clipId: 'spark' },
];

const layers: Layer[] = [
  {
    id: 'base',
    name: 'Base',
    role: 'base',
    blendMode: 'normal',
    opacity: 1,
    activeClipId: 'pulse',
    clips: [{ id: 'pulse', name: 'Pulse', effectId: 'solid-base', params: {}, modulations: [] }],
  },
];

describe('arrange helpers', () => {
  it('resolves a binding by drum and slot', () => {
    expect(bindingFor(bindings, 'snare', 2)).toEqual(bindings[1]);
    expect(bindingFor(bindings, 'snare', 3)).toBeNull();
  });

  it('describes known and unknown bindings', () => {
    expect(describeBinding(bindings[0]!, layers)).toBe('Base -> Pulse');
    expect(describeBinding(bindings[1]!, layers)).toBe('hits -> spark');
    expect(describeBinding(null, layers)).toBe('Empty');
  });

  it('reads a section layer look as a select value', () => {
    const section: Section = {
      id: 'verse',
      name: 'Verse',
      layerClips: [{ layerId: 'base', clipId: 'pulse' }],
      bindings: [],
    };
    expect(selectedLayerClip(section, 'base')).toBe('pulse');
    expect(selectedLayerClip(section, 'missing')).toBe('');
  });
});
