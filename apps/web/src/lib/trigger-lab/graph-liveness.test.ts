import { describe, it, expect } from 'vitest';
import { graphKeyOfVoice, isSustained, playingGraphKeys } from './graph-liveness';
import type { DockVoice } from './dock-voices';

function dv(over: Partial<DockVoice> = {}): DockVoice {
  return {
    id: 'v1',
    busId: 'base',
    effectId: 'aurora',
    mode: 'loop',
    level: 1,
    hue: 0,
    releasing: false,
    via: 'test',
    pad: 'graph:1',
    ...over,
  };
}

describe('graphKeyOfVoice', () => {
  it('passes a bare graph key through', () => {
    expect(graphKeyOfVoice('graph:1')).toBe('graph:1');
  });

  it('strips the section-slot suffix', () => {
    expect(graphKeyOfVoice('graph:1#2')).toBe('graph:1');
  });

  it('keeps a padKey fallback prefix intact (padKeys use `:`, never `#`)', () => {
    expect(graphKeyOfVoice('kick:center')).toBe('kick:center');
  });

  it('yields empty for a voice spawned with no prefix', () => {
    expect(graphKeyOfVoice('')).toBe('');
  });
});

describe('isSustained', () => {
  it('counts loop and hold', () => {
    expect(isSustained(dv({ mode: 'loop' }))).toBe(true);
    expect(isSustained(dv({ mode: 'hold' }))).toBe(true);
  });

  it('does not count a oneshot — the fire marker owns that', () => {
    expect(isSustained(dv({ mode: 'oneshot' }))).toBe(false);
  });

  it('still counts a releasing voice — it is still lighting the kit', () => {
    expect(isSustained(dv({ mode: 'loop', releasing: true }))).toBe(true);
  });
});

describe('playingGraphKeys', () => {
  it('attributes server-shaped voices, slot suffix and all', () => {
    const keys = playingGraphKeys([
      dv({ id: 'a', pad: 'graph:1#0' }),
      dv({ id: 'b', pad: 'graph:1#1' }),
      dv({ id: 'c', pad: 'graph:2' }),
    ]);
    expect([...keys].sort()).toEqual(['graph:1', 'graph:2']);
  });

  it('attributes sim-shaped voices (bare graph key, no suffix)', () => {
    expect([...playingGraphKeys([dv({ pad: 'graph:7' })])]).toEqual(['graph:7']);
  });

  it('ignores oneshots', () => {
    const keys = playingGraphKeys([dv({ pad: 'graph:1', mode: 'oneshot' }), dv({ id: 'b', pad: 'graph:2' })]);
    expect([...keys]).toEqual(['graph:2']);
  });

  it('ignores a voice with no attribution rather than inventing a key', () => {
    expect(playingGraphKeys([dv({ pad: '' })]).size).toBe(0);
  });

  it('is empty on a link drop (the store clears the voice list)', () => {
    expect(playingGraphKeys([]).size).toBe(0);
  });
});
