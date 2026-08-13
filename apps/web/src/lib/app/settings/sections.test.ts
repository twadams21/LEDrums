import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SETTINGS_PANES } from '../shell-nav';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsSection } from './sections';

/* The registry is the single source of the sidebar's identity — every route must have a
   section (a routed pane with no row would be unreachable from the sidebar) and the
   sidebar must be able to render its groups as contiguous runs.

   Colour lives beside it in section-tints.css, keyed by the same ids; it is checked here
   too, because a section whose id has no block silently loses its hue, and a raw colour
   there would fork the palette away from the tokens the gamut audit can see. */

const TINTS = readFileSync(fileURLToPath(new URL('./section-tints.css', import.meta.url)), 'utf8');

describe('settings sections', () => {
  it('has one section per route, in route order', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([...SETTINGS_PANES]);
  });

  it('resolves a section for every route', () => {
    for (const id of SETTINGS_PANES) expect(settingsSection(id).id).toBe(id);
  });

  it('groups sit in contiguous runs, so the sidebar renders each group once', () => {
    const seen: string[] = [];
    for (const s of SETTINGS_SECTIONS) if (seen.at(-1) !== s.group) seen.push(s.group);
    expect(seen).toEqual([...new Set(seen)]);
    expect(seen).toEqual(SETTINGS_GROUPS.map((g) => g.id));
  });

  it('gives every signal-flow section a colour block, and System none', () => {
    for (const id of SETTINGS_PANES) {
      const styled = TINTS.includes(`[data-settings-section='${id}']`);
      expect(styled, `${id} colour block`).toBe(id !== 'system');
    }
  });

  it('colours sections with palette tokens, never raw colours', () => {
    const values = [...TINTS.matchAll(/--sec-[\w-]+:\s*([^;]+);/g)].map((m) => m[1]!);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v).not.toMatch(/#[0-9a-f]{3,8}|\brgba?\(|\bhsla?\(/i);
  });

  it('paints the input stage with the input-stage role hues', () => {
    expect(TINTS).toMatch(/\[data-settings-section='input'\][^}]*--sec-tint:\s*var\(--role-input\)/);
    expect(TINTS).toMatch(/\[data-settings-section='zones'\][^}]*--sec-tint:\s*var\(--role-mod\)/);
  });

  it('labels every section for both the sidebar and its pane header', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.sub.length).toBeGreaterThan(0);
    }
  });
});
