// @vitest-environment jsdom
/* Cell play at the store's public surface (Tim, 2026-10-01): the setting survives the section's
   other edits and the save, the server's fire report is what flashes a sequenced cell's step (a
   local hit can't know which step the engine played), and auditioning such a cell plays one step. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectChain } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';

type EffectCell = effectChain.EffectCell;
const KICK_0: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

function setup() {
  const h: { cb: WSCallbacks; sent: ClientMessage[] } = { cb: {}, sent: [] };
  const store = new TriggerLab(() => ({ on(cb: WSCallbacks) { h.cb = cb; }, connect() {}, close() {}, send(m: ClientMessage) { h.sent.push(m); } }) as unknown as WSClient);
  return { store, h };
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

function sequencedKick() {
  const { store, h } = setup();
  store.addEffect(KICK_0, 'solid');
  store.addEffect(KICK_0, 'wave');
  store.setCellPlayMode(KICK_0, 'sequence');
  return { store, h, ids: store.cellEffects(KICK_0).map((e) => e.id) };
}

describe('the store keeps cell play', () => {
  it('across the section’s other edits (an Effect added, renamed, bypassed)', () => {
    const { store, ids } = sequencedKick();
    store.setCellReset(KICK_0, { kind: 'midiNote', note: 30 });
    store.renameEffect(ids[0]!, 'Renamed');
    store.setEffectBypass(ids[1]!, true);
    store.addEffect(KICK_0, 'noise');
    expect(store.cellPlay(KICK_0)).toEqual({ cell: KICK_0, mode: 'sequence', reset: { kind: 'midiNote', note: 30 } });
  });

  it('in the setShow the engine receives', () => {
    const { store, h } = sequencedKick();
    (store as unknown as { wireClient(): void }).wireClient();
    h.cb.onConnection!('open');
    store.setCellReset(KICK_0, { kind: 'zone', drumId: 'snare', slot: 0 });
    store.saveShow();
    const sent = [...h.sent].reverse().find((m) => m.t === 'setShow');
    const section = sent?.t === 'setShow' ? sent.show.songs?.[0]?.sections[0] : undefined;
    expect((section as { cellPlay?: unknown } | undefined)?.cellPlay).toEqual([
      { cell: KICK_0, mode: 'sequence', reset: { kind: 'zone', drumId: 'snare', slot: 0 } },
    ]);
  });
});

describe('fire flashes on a sequenced cell', () => {
  it('a local hit does not flash every step — the engine’s fire report flashes the one it played', () => {
    const { store, h, ids } = sequencedKick();
    (store as unknown as { wireClient(): void }).wireClient();
    store.hit(store.pads.find((p) => p.drumId === 'kick' && p.zone === 0)!);
    // Offline the Sim reports the step it played; connected the server's Monitor line does.
    h.cb.onMonitor?.({ type: 'effect', direction: 'local', source: 'server/voice', destination: `effect:${ids[1]}`, label: 'Effect fired', detail: '' } as never);
    expect(store.effectFireAt(ids[1]!)).toBeGreaterThan(0);
    expect(store.lastPlayedStep(KICK_0)).toBe(1);
  });

  it('auditioning the cell offline plays ONE step through the Sim, and the next audition the next one', () => {
    const { store, ids } = sequencedKick();
    // The Sim plays an input on its next tick, and the poll stamps the flash at the next snapshot.
    const sim = (store as unknown as { sim: { tick(dtMs: number): void } }).sim;
    const press = () => {
      store.fireCell(KICK_0);
      sim.tick(16);
      (store as unknown as { snapshot(): void }).snapshot();
    };
    sim.tick(16);
    press();
    expect(store.lastPlayedStep(KICK_0)).toBe(0);
    expect(store.effectFireAt(ids[1]!)).toBe(0);
    press();
    expect(store.lastPlayedStep(KICK_0)).toBe(1);
  });
});

describe('a reset-only input', () => {
  it('a pad that plays no Effect still reaches the engine when it is a cell’s reset', () => {
    const { store, h } = sequencedKick();
    (store as unknown as { wireClient(): void }).wireClient();
    h.cb.onConnection!('open');
    // A pad whose own cell is empty, so the hit plays nothing.
    const quiet = store.pads.find((p) => p.drumId !== 'kick' && store.cellEffects({ row: p.drumId, column: { kind: 'zone', slot: p.zone } }).length === 0)!;
    const keys = () => h.sent.filter((m) => m.t === 'key' && m.drumId === quiet.drumId).length;
    store.hit(quiet);
    expect(keys()).toBe(0); // routes nowhere: not sent
    store.setCellReset(KICK_0, { kind: 'zone', drumId: quiet.drumId, slot: quiet.zone });
    store.hit(quiet);
    expect(keys()).toBe(1); // the kick sequence's reset: sent, so the engine rewinds it
  });
});

describe('the number key of a sequenced zone cell', () => {
  it('is a real hit on the zone, so the engine steps it like the drum would', () => {
    const { store, h } = sequencedKick();
    (store as unknown as { wireClient(): void }).wireClient();
    h.cb.onConnection!('open');
    const before = h.sent.length;
    store.fireCell(KICK_0);
    const sent = h.sent.slice(before);
    expect(sent.some((m) => m.t === 'key' && m.drumId === 'kick' && m.zone === '0')).toBe(true);
    expect(sent.some((m) => m.t === 'fireEffect')).toBe(false); // not a client-side guess at the step
  });
});
