import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from './boot';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('shutdown durability barrier', () => {
  it('drains an adapter reopened by an already-queued authored edit before exit', async () => {
    const operations = deferred(), finalUdp = deferred();
    const stop = vi.fn().mockResolvedValueOnce(undefined).mockImplementation(() => finalUdp.promise);
    const autosaver = { markDirty() {}, dispose() {}, flush: async () => {} };
    const exit = vi.fn();
    const shutdown = createShutdown({
      host: { stop }, voiceHost: null, clients: [],
      oscInput: { close() {} }, wss: { close() {} }, server: { close() {} },
      statsTimer: setInterval(() => {}, 1000), tunnelControl: { start() {}, stop() {} },
      drainOperations: () => operations.promise,
      autosaver, showLibraryAutosaver: autosaver, songLibraryAutosaver: autosaver,
    }, exit);
    const completion = shutdown();
    expect(stop).toHaveBeenCalledOnce();
    // A queued setOutput is allowed to persist; its newly opened adapter still needs a final close.
    operations.resolve();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
    expect(exit).not.toHaveBeenCalled();
    finalUdp.resolve(); await completion;
    expect(exit).toHaveBeenCalledWith(0);
  });
  it.each([false, true])('stops frames immediately and always awaits UDP before exit (disk failure=%s)', async (diskFailure) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const disk = deferred(), udp = deferred(), controller = deferred();
    const events: string[] = [];
    const stop = vi.fn(() => { events.push('stop-frames'); return udp.promise; });
    const autosaver = { markDirty() {}, dispose() {}, flush: vi.fn(async () => { events.push('flush'); }) };
    const exit = vi.fn();
    const shutdown = createShutdown({
      host: { stop }, voiceHost: null, clients: [{ close: () => events.push('close-client') }],
      oscInput: { close() { events.push('close-input'); } },
      wss: { close() {} }, server: { close() { events.push('stop-listening'); } },
      statsTimer: setInterval(() => {}, 1000),
      controllerMonitor: { stop: () => controller.promise },
      tunnelControl: { start() {}, stop() {} },
      beginShutdown: () => events.push('reject-new-work'), drainOperations: () => disk.promise.then(() => {
        if (diskFailure) throw new Error('injected disk failure');
      }),
      autosaver, showLibraryAutosaver: autosaver, songLibraryAutosaver: autosaver,
    }, exit);
    const completion = shutdown();
    expect(shutdown()).toBe(completion);
    expect(stop).toHaveBeenCalledOnce();
    expect(events).toEqual(['reject-new-work', 'stop-frames', 'close-input', 'stop-listening']);
    disk.resolve();
    await vi.waitFor(() => expect(autosaver.flush).toHaveBeenCalledTimes(3));
    expect(events.indexOf('close-client')).toBeGreaterThan(events.indexOf('stop-listening'));
    expect(events.filter((event) => event === 'close-client')).toHaveLength(1);
    expect(exit).not.toHaveBeenCalled();
    controller.resolve(); await Promise.resolve(); expect(exit).not.toHaveBeenCalled();
    udp.resolve(); await completion;
    expect(exit).toHaveBeenCalledWith(diskFailure ? 1 : 0);
    errorLog.mockRestore();
  });
});
