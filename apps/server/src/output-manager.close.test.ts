import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject, type DmxMap } from '@ledrums/core';
import type { PixelOutput, PixelSendCallback } from '@ledrums/io';
import { OutputManager } from './output-manager';
import { EngineHost } from './engine-host';
import { VoiceEngineHost } from './voice-engine-host';

const map: DmxMap = { perPixel: [], universes: [] };
afterEach(() => vi.useRealTimers());

describe('awaitable output shutdown', () => {
  it('awaits every retired adapter and shares completion for repeated closes', async () => {
    const callbacks: PixelSendCallback[] = [];
    const output: PixelOutput = { nextFrame() {}, send() {}, close(done) { callbacks.push(done!); } };
    const manager = new OutputManager(() => output);
    const settings = { ...defaultProject().output, state: 'armed' as const, broadcast: false, host: '127.0.0.1' };
    manager.applySettings(settings, map);
    manager.applySettings({ ...settings, host: '127.0.0.2' }, map);
    const closed = manager.close();
    expect(manager.close()).toBe(closed);
    const settled = vi.fn(); void closed.then(settled);
    callbacks[1]!(null); await Promise.resolve(); expect(settled).not.toHaveBeenCalled();
    callbacks[0]!(null); await closed;
    expect(settled).toHaveBeenCalledOnce();
  });
  it('bounds missing callbacks and records timeout; late callbacks cannot resettle', async () => {
    vi.useFakeTimers();
    let done: PixelSendCallback | undefined;
    const manager = new OutputManager(() => ({ nextFrame() {}, send() {}, close(cb) { done = cb; } }));
    manager.applySettings({ ...defaultProject().output, state: 'armed', broadcast: false, host: '127.0.0.1' }, map);
    const closed = manager.close();
    await vi.advanceTimersByTimeAsync(500); await closed;
    expect(manager.status().lastError).toContain('timed out');
    done?.(null);
    expect(manager.status().lastError).toContain('timed out');
  });
  for (const mode of ['legacy', 'voice'] as const) it(`${mode} repeated stop stops frames immediately but awaits drain`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let done: PixelSendCallback | undefined;
    const manager = new OutputManager(() => ({ nextFrame() {}, send() {}, close(cb) { done = cb; } }));
    const project = defaultProject(); project.output.state = 'armed'; project.output.broadcast = false; project.output.host = '127.0.0.1';
    const host = mode === 'legacy' ? new EngineHost(project, manager) : new VoiceEngineHost(project, null, manager);
    host.start(); await vi.advanceTimersByTimeAsync(100);
    const time = host.engineTimeMs;
    const stop = host.stop(); expect(host.stop()).toBe(stop);
    await vi.advanceTimersByTimeAsync(100);
    expect(host.engineTimeMs).toBe(time);
    done?.(null); await stop;
    host.start(); await vi.advanceTimersByTimeAsync(50);
    expect(host.engineTimeMs).toBeGreaterThan(time);
    const again = host.stop(); done?.(null); await again;
  });
});
