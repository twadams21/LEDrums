import { describe, expect, it } from 'vitest';
import { shareVisible } from './share-gating';
import type { BootStage } from '../boot-reducer';

const STAGES: BootStage[] = ['starting', 'running', 'no-tunnel', 'updating', 'error'];

describe('shareVisible', () => {
  it('never shows without a tunnel surface, whatever the stage', () => {
    for (const stage of STAGES) {
      expect(shareVisible(false, true, stage)).toBe(false);
      expect(shareVisible(false, false, stage)).toBe(false);
    }
  });

  it('in a plain browser (not desktop) shows whenever a tunnel exists — never gates on stage', () => {
    for (const stage of STAGES) {
      expect(shareVisible(true, false, stage)).toBe(true);
    }
  });

  it('on desktop shows ONLY while running', () => {
    expect(shareVisible(true, true, 'running')).toBe(true);
  });

  it('on desktop hides during starting / updating / error / no-tunnel (dead URL/PIN)', () => {
    expect(shareVisible(true, true, 'starting')).toBe(false);
    expect(shareVisible(true, true, 'updating')).toBe(false);
    expect(shareVisible(true, true, 'error')).toBe(false);
    expect(shareVisible(true, true, 'no-tunnel')).toBe(false);
  });
});
