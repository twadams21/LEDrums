import { describe, expect, it } from 'vitest';
import { defaultProject, type Project } from '@ledrums/core';
import { diffPatch } from './patch-diff';
import type { PatchPayload } from './clipdoc';

function patchOf(p: Project): PatchPayload {
  return { name: p.name, kit: p.kit, inputMap: p.inputMap, output: p.output };
}

describe('diffPatch — patch confirm summary (S45)', () => {
  it('reports no changes when the patch equals the current rig', () => {
    const cur = defaultProject();
    const diff = diffPatch(cur, patchOf(cur));
    expect(diff.hasChanges).toBe(false);
    expect(diff.rows.every((r) => !r.changed)).toBe(true);
    expect(diff.rows.map((r) => r.key)).toEqual(['drums', 'pixels', 'host', 'protocol']);
  });

  it('flags host + protocol changes', () => {
    const cur = defaultProject();
    const incoming = patchOf({ ...cur, output: { ...cur.output, host: '10.9.9.9', protocol: 'sacn' } });
    const diff = diffPatch(cur, incoming);
    expect(diff.hasChanges).toBe(true);
    const host = diff.rows.find((r) => r.key === 'host')!;
    expect(host).toMatchObject({ to: '10.9.9.9', changed: true });
    const proto = diff.rows.find((r) => r.key === 'protocol')!;
    expect(proto).toMatchObject({ from: 'ARTNET', to: 'SACN', changed: true });
  });

  it('flags a drum-count change and reports total pixels', () => {
    const cur = defaultProject();
    const fewer: Project = { ...cur, kit: { ...cur.kit, drums: cur.kit.drums.slice(0, 1) } };
    const diff = diffPatch(cur, patchOf(fewer));
    const drums = diff.rows.find((r) => r.key === 'drums')!;
    expect(drums).toMatchObject({ from: String(cur.kit.drums.length), to: '1', changed: true });
    const pixels = diff.rows.find((r) => r.key === 'pixels')!;
    expect(pixels.to).not.toBe('—'); // topology built
    expect(pixels.changed).toBe(true);
  });

  it('reads every row from "—" when offline (no current project)', () => {
    const cur = defaultProject();
    const diff = diffPatch(null, patchOf(cur));
    expect(diff.hasChanges).toBe(false); // nothing to compare against → no highlighted change
    expect(diff.rows.every((r) => r.from === '—')).toBe(true);
    expect(diff.name).toBe(cur.name);
  });
});
