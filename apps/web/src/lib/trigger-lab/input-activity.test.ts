import { describe, expect, it } from 'vitest';
import type { voice } from '@ledrums/core';
import {
  acceptsChannel,
  activityKey,
  bindingFromSource,
  deriveInputBadge,
  LIVE_MS,
  STALE_MS,
  type InputActivity,
  type InputBinding,
} from './input-activity';

/** InputActivity fixture — a MIDI note heard "now" by default; override per case. */
function heard(overrides: Partial<InputActivity> = {}): InputActivity {
  return { kind: 'midi', note: 60, channel: 1, value: 92, time: 1000, ...overrides };
}

/** A one-entry activity map keyed the same way the store keys it. */
function mapOf(...events: Array<[InputBinding, InputActivity]>): Map<string, InputActivity> {
  return new Map(events.map(([b, e]) => [activityKey(b), e]));
}

describe('activityKey', () => {
  it('keys MIDI by note, OSC by address, and never collides across kinds', () => {
    expect(activityKey({ kind: 'midi', note: 60 })).toBe('midi:note:60');
    expect(activityKey({ kind: 'osc', address: '/kick' })).toBe('osc:/kick');
    // A note and an address that stringify alike still get distinct keys.
    expect(activityKey({ kind: 'midi', note: 60 })).not.toBe(activityKey({ kind: 'osc', address: '60' }));
  });
});

describe('acceptsChannel (global MIDI channel filter)', () => {
  it('null filter accepts every channel', () => {
    expect(acceptsChannel(null, 1)).toBe(true);
    expect(acceptsChannel(null, 16)).toBe(true);
    expect(acceptsChannel(null, undefined)).toBe(true);
  });
  it('a set filter accepts only its channel', () => {
    expect(acceptsChannel(10, 10)).toBe(true);
    expect(acceptsChannel(10, 1)).toBe(false);
    expect(acceptsChannel(10, undefined)).toBe(false);
  });
});

describe('bindingFromSource', () => {
  const cases: Array<{ name: string; src: voice.TriggerSource | undefined; expected: InputBinding | null }> = [
    { name: 'midi note → midi binding', src: { kind: 'midi', note: 38 }, expected: { kind: 'midi', note: 38 } },
    { name: 'midi CC → null (not on the input wire)', src: { kind: 'midi', cc: 7 }, expected: null },
    { name: 'midi with no note → null', src: { kind: 'midi' }, expected: null },
    { name: 'osc address → osc binding', src: { kind: 'osc', address: '/snare' }, expected: { kind: 'osc', address: '/snare' } },
    { name: 'osc empty address → null', src: { kind: 'osc', address: '' }, expected: null },
    { name: 'drum source → null (fires via pad path)', src: { kind: 'drum', drumId: 'kick', zone: '0' }, expected: null },
    { name: 'undefined source → null', src: undefined, expected: null },
  ];
  for (const c of cases) {
    it(c.name, () => expect(bindingFromSource(c.src)).toEqual(c.expected));
  }
});

describe('deriveInputBadge', () => {
  const note60: InputBinding = { kind: 'midi', note: 60 };
  const kick: InputBinding = { kind: 'osc', address: '/kick' };

  it('null binding → null (drum/CC/empty field)', () => {
    expect(deriveInputBadge(null, mapOf([note60, heard()]), 1000)).toBeNull();
  });

  it('no matching activity → null', () => {
    expect(deriveInputBadge(note60, new Map(), 1000)).toBeNull();
  });

  it('MIDI note hit → note name, velocity, and age', () => {
    const view = deriveInputBadge(note60, mapOf([note60, heard({ value: 92, time: 1000 })]), 3500);
    expect(view).toMatchObject({ label: 'C4', value: '92', age: '2s' });
    expect(view?.title).toContain('velocity 92');
  });

  it('OSC hit → address, trimmed arg, and age', () => {
    const view = deriveInputBadge(kick, mapOf([kick, heard({ kind: 'osc', address: '/kick', value: 0.756, time: 1000 })]), 1000);
    expect(view).toMatchObject({ label: '/kick', value: '0.76', age: 'now' });
    expect(view?.title).not.toContain('velocity');
  });

  it('rounds MIDI velocity to an integer', () => {
    const view = deriveInputBadge(note60, mapOf([note60, heard({ value: 91.6 })]), 1000);
    expect(view?.value).toBe('92');
  });

  const ageCases: Array<{ ageMs: number; age: string }> = [
    { ageMs: 0, age: 'now' },
    { ageMs: 999, age: 'now' },
    { ageMs: 2500, age: '2s' },
    { ageMs: 90_000, age: '1m' },
    { ageMs: 3_700_000, age: '1h' },
  ];
  for (const { ageMs, age } of ageCases) {
    it(`age ${ageMs}ms → "${age}"`, () => {
      const view = deriveInputBadge(note60, mapOf([note60, heard({ time: 0 })]), ageMs);
      expect(view?.age).toBe(age);
    });
  }

  it('freshness + tone age out: fresh → past-live → stale', () => {
    const at = (now: number) => deriveInputBadge(note60, mapOf([note60, heard({ time: 0 })]), now);
    expect(at(LIVE_MS - 1)).toMatchObject({ fresh: true, tone: 'live' });
    expect(at(LIVE_MS + 1)).toMatchObject({ fresh: false, tone: 'live' });
    expect(at(STALE_MS + 1)).toMatchObject({ fresh: false, tone: 'muted' });
  });

  it('no churn: unrelated traffic leaves a binding’s badge identical', () => {
    const before = deriveInputBadge(note60, mapOf([note60, heard({ time: 1000 })]), 2000);
    // A different note arrives — same `now`, our note untouched.
    const withOther = mapOf(
      [note60, heard({ time: 1000 })],
      [{ kind: 'midi', note: 38 }, heard({ note: 38, value: 10, time: 1900 })],
    );
    const after = deriveInputBadge(note60, withOther, 2000);
    expect(after).toEqual(before);
  });
});
