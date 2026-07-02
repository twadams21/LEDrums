// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import EnvelopeEditor from './EnvelopeEditor.svelte';
import { TriggerLab } from './store.svelte';
import { adsrToPoints, type AdsrShape } from './sim';
import type { WSClient } from '../ws/client';

/* S24 — EnvelopeEditor rework. The pure handle↔shape geometry is covered in
   envelope-editor-geom.test.ts; here we prove the v2 model round-trips through the
   store, and that the reworked component drops the Curve slider, exposes the
   per-segment ease controls, and is keyboard-operable. */

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

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

/** A play node on a real store with an envable param the editor can target. */
function storeWithTarget(): { store: TriggerLab; nodeKey: string } {
  const store = new TriggerLab(fakeClient);
  store.createGraph('t');
  const node = store.addNode('play', 0, 0)!;
  store.pickEffect(node, 'gen:radial-wash');
  store.openEnv(node, 'hue');
  return { store, nodeKey: 'hue' };
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
  // bits-ui Dialog/Select probe these in the browser; jsdom lacks them.
  if (!globalThis.matchMedia) {
    (globalThis as { matchMedia?: unknown }).matchMedia = () => ({
      matches: false,
      media: '',
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    });
  }
  if (!globalThis.ResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  document.body.innerHTML = '';
});

describe('EnvelopeEditor — v2 model round-trips through the store', () => {
  it('persists attackLevel + per-segment eases and regenerates the render points', () => {
    const { store } = storeWithTarget();
    const node = store.envTarget!.block;
    // attack/decay/release chosen so the segment boundaries land on the 48-sample
    // grid (tA=0.25=12/48), so the peak sample equals attackLevel exactly.
    const shape: AdsrShape = {
      attack: 0.25,
      decay: 0.25,
      sustain: 0.5,
      release: 0.25,
      attackLevel: 0.7,
      attackEase: { fn: 'cubic', dir: 'in' },
      decayEase: { fn: 'bounce', dir: 'out' },
      releaseEase: { fn: 'expo', dir: 'out' },
    };
    store.setEnvAdsr(node, 'hue', shape);

    const env = store.getEnvelope(node, 'hue');
    // The authored shape survives verbatim…
    expect(env?.adsr).toEqual(shape);
    // …and the persisted render curve is regenerated from it (single source).
    expect(env?.points).toEqual(adsrToPoints(shape));
    // attackLevel is honoured — the peak is the level, not 1.
    expect(Math.max(...env!.points.map((p) => p.v))).toBeCloseTo(0.7, 12);
  });
});

describe('EnvelopeEditor — component (jsdom)', () => {
  it('drops the single Curve slider', () => {
    const { store } = storeWithTarget();
    render(EnvelopeEditor, { props: { store } });
    // The v1 editor had exactly one Slider labelled "Segment curve"; it is gone.
    expect(document.body.querySelector('[aria-label="Segment curve"]')).toBeNull();
  });

  it('renders per-segment ease controls (segment selector + EasePicker)', () => {
    const { store } = storeWithTarget();
    render(EnvelopeEditor, { props: { store } });
    expect(document.body.querySelector('[aria-label="Easing segment"]')).not.toBeNull();
    // EasePicker for the default (attack) segment: a family Select + direction control.
    expect(document.body.querySelector('[aria-label="attack easing — family"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="attack easing — direction"]')).not.toBeNull();
  });

  it('exposes keyboard-operable stage handles with slider semantics', () => {
    const { store } = storeWithTarget();
    render(EnvelopeEditor, { props: { store } });
    const attack = document.body.querySelector('[aria-label="Attack handle"]')!;
    expect(attack.getAttribute('role')).toBe('slider');
    expect(attack.getAttribute('tabindex')).toBe('0');
    expect(attack.getAttribute('aria-valuetext')).toContain('peak level');
    // All three handles are present + focusable.
    expect(document.body.querySelector('[aria-label="Decay and sustain handle"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Release handle"]')).not.toBeNull();
  });

  it('edits attackLevel by keyboard and round-trips through the model', async () => {
    const { store } = storeWithTarget();
    const node = store.envTarget!.block;
    render(EnvelopeEditor, { props: { store } });
    const attack = document.body.querySelector('[aria-label="Attack handle"]')!;
    // Default attackLevel is 1 (top); ArrowDown lowers the peak and creates/persists the env.
    await fireEvent.keyDown(attack, { key: 'ArrowDown' });
    const level = store.getEnvelope(node, 'hue')?.adsr?.attackLevel;
    expect(level).toBeGreaterThan(0.9);
    expect(level).toBeLessThan(1);
  });

  it('clicking a segment retargets the ease controls to that segment', async () => {
    const { store } = storeWithTarget();
    render(EnvelopeEditor, { props: { store } });
    // Segment bands render in attack/decay/release order; click the decay band.
    const bandsEls = document.body.querySelectorAll('.seg-band');
    expect(bandsEls.length).toBe(3);
    await fireEvent.click(bandsEls[1]!);
    // The EasePicker now labels itself for the decay segment.
    expect(document.body.querySelector('[aria-label="decay easing — family"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="attack easing — family"]')).toBeNull();
  });
});
