import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { EngineHost } from './engine-host';
import { VoiceEngineHost } from './voice-engine-host';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each([
  { name: 'legacy', create: () => new EngineHost(defaultProject()), fps: 60 },
  { name: 'voice', create: () => new VoiceEngineHost(defaultProject()), fps: 120 },
])('$name host FPS window', ({ create, fps }) => {
  it('reports tick rate in the first engine-time second, regardless of process uptime', () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(60_000);
    const host = create();
    host.start();
    try {
      for (let i = 0; i <= fps; i++) host.step(1000 / fps);
      expect(host.getStats().fps).toBeCloseTo(fps);
    } finally {
      host.stop();
    }
  });

  it('resets the partial sample window on restart', () => {
    vi.useFakeTimers();
    const wall = vi.spyOn(performance, 'now').mockReturnValue(0);
    const host = create();
    host.start();
    for (let i = 0; i < fps / 2; i++) host.step(1000 / fps);
    host.stop();
    wall.mockReturnValue(60_000);
    host.start();
    try {
      for (let i = 0; i <= fps; i++) host.step(1000 / fps);
      expect(host.getStats().fps).toBeCloseTo(fps);
    } finally {
      host.stop();
    }
  });
});
