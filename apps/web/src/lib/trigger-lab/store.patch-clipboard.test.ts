import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProject, type Project } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import { parse, isClipParseError } from './clipdoc';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { ClientMessage, OutputStatus, SerializedModel } from '../ws/protocol-types';

/* Patch copy/paste store surface (group K / S45): copyPatch serializes the rig's device slices as
   a portable `patch` ClipDoc; setProjectPatch fires the bulk `setProject` re-rig WITHOUT an
   optimistic local write (the server is the authoritative validator/applier); onError surfaces a
   dismissible serverError. A capturing harness client drives the handshake and records sends. */

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

function fireOpen(h: Harness): void {
  h.cb!.onConnection!('open');
}
function fireState(h: Harness, project: Project): void {
  h.cb!.onState!(project, MODEL, [], [], OUTPUT, null, null, null);
}
function firePresence(h: Harness, youAreEditor: boolean): void {
  h.cb!.onPresence!('c1', youAreEditor, 2);
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
  // start() registers a RAF render loop; a no-op RAF keeps it from running in node.
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('setProjectPatch — bulk re-rig send (S45)', () => {
  it('sends setProject and does NOT optimistically write the local project', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    fireOpen(h);
    fireState(h, defaultProject());
    h.sent.length = 0;

    const patch = { name: 'Rig B', kit: store.project!.kit, inputMap: store.project!.inputMap, output: { ...store.project!.output, host: '10.0.0.9' } };
    store.setProjectPatch(patch);

    const msg = h.sent.find((m) => m.t === 'setProject');
    expect(msg).toEqual({ t: 'setProject', patch });
    // authoritative-server model: the local project is unchanged until the server round-trips state.
    expect(store.project!.name).not.toBe('Rig B');
    expect(store.project!.output.host).not.toBe('10.0.0.9');
    store.stop();
  });

  it('is a no-op for a read-only viewer', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    fireOpen(h);
    fireState(h, defaultProject());
    firePresence(h, false); // another client edits → we are a viewer
    h.sent.length = 0;

    store.setProjectPatch({ kit: store.project!.kit, inputMap: store.project!.inputMap, output: store.project!.output });
    expect(h.sent.some((m) => m.t === 'setProject')).toBe(false);
    store.stop();
  });
});

describe('server error surface (S45)', () => {
  it('captures a server error, clears it on a new send, and on explicit dismiss', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    fireOpen(h);
    fireState(h, defaultProject());

    h.cb!.onError!('Invalid patch: kit.drums — too small');
    expect(store.serverError).toMatch(/Invalid patch/);

    store.setProjectPatch({ kit: store.project!.kit, inputMap: store.project!.inputMap, output: store.project!.output });
    expect(store.serverError).toBeNull(); // a fresh attempt clears the stale error

    h.cb!.onError!('again');
    store.clearServerError();
    expect(store.serverError).toBeNull();
    store.stop();
  });
});

describe('copyPatch / buildPatchDoc (S45)', () => {
  it('serializes a patch ClipDoc that round-trips through parse with the device slices', () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    fireOpen(h);
    fireState(h, defaultProject());

    const text = store.buildPatchDoc()!;
    const doc = parse(text);
    expect(isClipParseError(doc)).toBe(false);
    if (isClipParseError(doc)) return;
    expect(doc.kind).toBe('patch');
    if (doc.kind !== 'patch') return;
    expect(doc.payload.patch.kit.drums.length).toBe(store.project!.kit.drums.length);
    expect(doc.payload.patch.output.host).toBe(store.project!.output.host);
    store.stop();
  });

  it('copyPatch writes the doc to the clipboard and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    fireOpen(h);
    fireState(h, defaultProject());

    const ok = await store.copyPatch();
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(String(writeText.mock.calls[0]?.[0])).toContain('"kind":"patch"');
    store.stop();
  });

  it('copyPatch returns false when offline (no project to copy)', async () => {
    const h: Harness = { cb: null, sent: [] };
    const store = new TriggerLab(harnessClient(h));
    store.start();
    expect(await store.copyPatch()).toBe(false); // no state yet → nothing to copy
    store.stop();
  });
});
