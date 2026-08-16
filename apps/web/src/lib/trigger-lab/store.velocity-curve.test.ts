import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProject, withVelocityCurve, type CurveValue, type Project } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import type { WSCallbacks, WSClient } from '../ws/client';
import type { ClientMessage, OscListenInfo, OutputStatus, SerializedModel } from '../ws/protocol-types';

/* The CLIENT half of per-drum velocity sensitivity (S8). Two obligations, both easy to break:

   1. MUTATION PARITY with the server's `toInputEvent` seam — offline the local sim IS the
      engine, so a pad hit must be shaped by the drum's curve exactly as the server shapes a
      forwarded one. Connected, the server has already applied it and the client must NOT
      apply it twice.
   2. The live overlay's feed — recent RAW velocities per drum, recorded from the server's
      echo when connected and from the local fire path when not, never from both. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

interface Harness {
  cb: WSCallbacks | null;
  sent: ClientMessage[];
}

const harnessClient =
  (h: Harness): (() => WSClient) =>
  () =>
    ({
      on(cb: WSCallbacks) {
        h.cb = cb;
      },
      connect() {},
      close() {},
      send(m: ClientMessage) {
        h.sent.push(m);
      },
    }) as unknown as WSClient;

const MODEL: SerializedModel = {
  count: 0,
  positions: [],
  tangents: [],
  normals: [],
  segmentLengths: [],
  drums: [],
  bounds: { center: [0, 0, 0], size: 0 },
};
const OUTPUT: OutputStatus = { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 };
const OSC_LISTEN: OscListenInfo = { status: 'listening', port: 9000, hosts: [] };

/** Halves everything: out = in / 2, flat linear, so the expected number is arithmetic. */
const HALF: CurveValue = { h0: { x: 0, y: 0 }, h1: { x: 1, y: 0.5 }, profile: 'linear', strength: 0 };

const fireState = (h: Harness, project: Project): void => {
  h.cb!.onState!(project, MODEL, [], [], OUTPUT, null, null, null, OSC_LISTEN);
};

/** A project whose first drum halves every hit. */
function projectWithCurve(): { project: Project; drumId: string } {
  const base = defaultProject();
  const drumId = base.kit.drums[0]!.id;
  return { project: { ...base, inputMap: withVelocityCurve(base.inputMap, drumId, HALF) }, drumId };
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  vi.unstubAllGlobals();
});

describe('offline hit shaping (parity with the server seam)', () => {
  it('shapes a pad hit by ITS drum’s curve', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    const { project, drumId } = projectWithCurve();
    fireState(h, project);
    const pad = store.pads.find((p) => p.drumId === drumId)!;
    const trigger = vi.spyOn(store.sim, 'triggerGraph').mockReturnValue([]);

    store.velocity = 0.8;
    store.hit(pad);

    expect(trigger).toHaveBeenCalled();
    expect(trigger.mock.calls[0]![2].velocity).toBeCloseTo(0.4, 6);
  });

  it('leaves a drum with no curve exactly as it was', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    const { project, drumId } = projectWithCurve();
    fireState(h, project);
    const other = store.pads.find((p) => p.drumId !== drumId);
    expect(other).toBeDefined();
    const trigger = vi.spyOn(store.sim, 'triggerGraph').mockReturnValue([]);

    store.velocity = 0.8;
    store.hit(other!);

    expect(trigger.mock.calls[0]![2].velocity).toBeCloseTo(0.8, 6);
  });

  it('sends the RAW velocity when connected — the server applies the curve, once', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    const { project, drumId } = projectWithCurve();
    h.cb!.onConnection!('open');
    fireState(h, project);
    const pad = store.pads.find((p) => p.drumId === drumId)!;

    store.velocity = 0.8;
    store.hit(pad);

    const key = h.sent.find((m) => m.t === 'key');
    expect(key).toBeDefined();
    expect(key && 'velocity' in key ? key.velocity : null).toBe(0.8);
  });
});

describe('live hit feed', () => {
  it('records the echo’s RAW value under the drum the server resolved', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    fireState(h, projectWithCurve().project);

    h.cb!.onInput!({ kind: 'midi', label: 'note 36', value: 0.75, note: 36, drumId: 'kick' });

    expect(store.velocityHitsFor('kick').map((hit) => hit.x)).toEqual([0.75]);
    expect(store.velocityHitsFor('snare')).toEqual([]);
  });

  it('stores no y — the marker is read off whatever curve is on screen', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    fireState(h, projectWithCurve().project);

    h.cb!.onInput!({ kind: 'midi', label: 'note 36', value: 0.75, note: 36, drumId: 'kick' });

    expect(store.velocityHitsFor('kick')[0]).not.toHaveProperty('y');
  });

  it('drops an echo the zone-map claimed for nobody', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    fireState(h, projectWithCurve().project);

    h.cb!.onInput!({ kind: 'midi', label: 'note 99', value: 0.5, note: 99 });

    expect(store.velocityHits).toEqual({});
  });

  it('records an offline pad hit locally — no server, no echo', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    const { project, drumId } = projectWithCurve();
    fireState(h, project);
    const pad = store.pads.find((p) => p.drumId === drumId)!;

    store.velocity = 0.6;
    store.hit(pad);

    expect(store.velocityHitsFor(drumId).map((hit) => hit.x)).toEqual([0.6]);
  });

  it('does NOT record locally when connected — the echo would plot the same hit twice', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    const { project, drumId } = projectWithCurve();
    h.cb!.onConnection!('open');
    fireState(h, project);
    const pad = store.pads.find((p) => p.drumId === drumId)!;

    store.hit(pad);

    expect(store.velocityHitsFor(drumId)).toEqual([]);
  });
});
