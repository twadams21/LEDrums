import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import StatusPill from './StatusPill.svelte';
import StatusDot, { type StatusTone } from './StatusDot.svelte';

const TONES: StatusTone[] = ['ok', 'warn', 'live', 'accent', 'muted'];

describe('StatusPill', () => {
  it('renders the label and a tone class for every tone', () => {
    for (const tone of TONES) {
      const label = tone.toUpperCase();
      const { body } = render(StatusPill, { props: { tone, label } });
      expect(body).toContain(`pill-${tone}`);
      expect(body).toContain(label);
    }
  });

  it('renders a default StatusDot (matching the tone) when no leading snippet is given', () => {
    const { body } = render(StatusPill, { props: { tone: 'live', label: 'LIVE' } });
    expect(body).toContain('dot-live');
  });

  it('toggles the pulse animation class on the dot', () => {
    const on = render(StatusPill, { props: { tone: 'warn', label: 'SYNC', pulse: true } }).body;
    const off = render(StatusPill, { props: { tone: 'warn', label: 'SYNC', pulse: false } }).body;
    expect(on).toContain('pulse');
    expect(off).not.toContain('pulse');
  });
});

describe('StatusDot', () => {
  it('applies the tone class and is aria-hidden (decorative)', () => {
    const { body } = render(StatusDot, { props: { tone: 'ok' } });
    expect(body).toContain('dot-ok');
    expect(body).toContain('aria-hidden');
  });

  it('adds the pulse class only when pulse is set', () => {
    expect(render(StatusDot, { props: { tone: 'warn', pulse: true } }).body).toContain('pulse');
    expect(render(StatusDot, { props: { tone: 'warn', pulse: false } }).body).not.toContain('pulse');
  });

  // Media queries can't be observed from SSR HTML, so assert the source carries
  // the reduced-motion guard that drops the pulse animation.
  it('disables the pulse animation under prefers-reduced-motion', () => {
    const src = readFileSync(fileURLToPath(new URL('./StatusDot.svelte', import.meta.url)), 'utf8');
    expect(src).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(src).toMatch(/prefers-reduced-motion[\s\S]*?animation:\s*none/);
  });
});
