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
])('$name host wall-clock FPS window', ({ create, fps }) => {
  it.each([1, 2])('reports real throughput when each tick takes %sx its simulation interval', (slowdown) => {
    vi.useFakeTimers();
    const wall = vi.spyOn(performance, 'now').mockReturnValue(60_000);
    const host = create();
    host.start();
    try {
      for (let i = 1; i <= fps / slowdown; i++) {
        wall.mockReturnValue(60_000 + i * slowdown * 1000 / fps);
        host.step(1000 / fps);
      }
      expect(host.getStats().fps).toBeCloseTo(fps / slowdown);
    } finally {
      host.stop();
    }
  });

  it('resets the partial sample window on restart', () => {
    vi.useFakeTimers();
    const wall = vi.spyOn(performance, 'now').mockReturnValue(0);
    const host = create();
    host.start();
    for (let i = 1; i <= fps / 2; i++) {
      wall.mockReturnValue(i * 1000 / fps);
      host.step(1000 / fps);
    }
    host.stop();
    wall.mockReturnValue(60_000);
    host.start();
    try {
      for (let i = 1; i <= fps; i++) {
        wall.mockReturnValue(60_000 + i * 1000 / fps);
        host.step(1000 / fps);
      }
      expect(host.getStats().fps).toBeCloseTo(fps);
    } finally {
      host.stop();
    }
  });
});
