import { describe, expect, it } from 'vitest';
import { defaultProject } from './defaults';
import { parseProject, projectSchema } from './project-schema';

describe('project schema', () => {
  it('round-trips the default project through serialize -> parse', () => {
    const p = defaultProject();
    const round = parseProject(JSON.parse(JSON.stringify(p)));
    expect(round).toEqual(p);
  });

  it('default project has a base layer, a trigger layer, and a valid transport', () => {
    const p = defaultProject();
    const roles = p.composition.layers.map((l) => l.role);
    expect(roles).toContain('base');
    expect(roles).toContain('trigger');
    expect(p.composition.transport.bpm).toBeGreaterThan(0);
    expect(p.composition.transport.beatsPerBar).toBeGreaterThan(0);
  });

  it('rejects an unknown blend mode', () => {
    const p = JSON.parse(JSON.stringify(defaultProject()));
    p.composition.layers[0].blendMode = 'glow';
    expect(() => parseProject(p)).toThrow();
  });

  it('rejects out-of-range opacity', () => {
    const p = JSON.parse(JSON.stringify(defaultProject()));
    p.composition.layers[0].opacity = 1.7;
    expect(() => parseProject(p)).toThrow();
  });

  it('accepts a clip with zero modulations', () => {
    const result = projectSchema.safeParse({
      kit: defaultProject().kit,
      composition: {
        layers: [{ id: 'l1', clips: [{ id: 'c1', effectId: 'solid-base' }], activeClipId: 'c1' }],
      },
    });
    expect(result.success).toBe(true);
  });
});
