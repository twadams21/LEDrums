import { describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { EngineHost } from './engine-host';
import { OutputManager } from './output-manager';

class FakeOutput implements PixelOutput {
  sends = 0;
  closed = false;
  nextFrame(): void {}
  send(): void {
    this.sends++;
  }
  close(): void {
    this.closed = true;
  }
}

/** A host whose OutputManager is backed by a fake transport (no sockets). */
function makeHost() {
  const fake = new FakeOutput();
  const project = defaultProject();
  // Arm output with a high transmit rate so a few steps definitely transmit.
  project.output.state = 'armed';
  project.output.fps = 60;
  const host = new EngineHost(project, new OutputManager(() => fake));
  host.reloadOutputSettings();
  return { host, fake };
}

const STEP = 1000 / 60;

describe('EngineHost step loop', () => {
  it('ticks the engine and advances engineTimeMs', () => {
    const { host } = makeHost();
    host.step(STEP);
    host.step(STEP);
    expect(host.engineTimeMs).toBeCloseTo(STEP * 2);
    expect(host.engine.getStats().tickCount).toBe(2);
  });

  it('emits preview frames through onFrame at the model pixel count', () => {
    const { host } = makeHost();
    let received: Uint8Array | null = null;
    host.onFrame = (rgb) => {
      received = rgb;
    };
    // Preview throttled to ~30fps → at least one frame within a handful of 60fps steps.
    for (let i = 0; i < 4; i++) host.step(STEP);
    expect(received).not.toBeNull();
    expect(received!.length).toBe(host.engine.getModel().pixelCount * 3);
  });

  it('transmits frames to the output transport when armed', () => {
    const { host, fake } = makeHost();
    for (let i = 0; i < 4; i++) host.step(STEP);
    expect(fake.sends).toBeGreaterThan(0);
  });

  it('populates latency after an input is followed by an emitted frame', () => {
    const { host } = makeHost();
    host.onFrame = () => {};
    host.applyInput({ kind: 'noteOn', note: 36, velocity: 100 });
    // Step enough for a preview frame to be emitted (closing the latency loop).
    for (let i = 0; i < 4; i++) host.step(STEP);
    expect(host.lastLatencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(host.lastLatencyMs)).toBe(true);
  });

  it('stamps inputs at the current engine time (drained next tick)', () => {
    const { host } = makeHost();
    host.step(STEP); // engineTimeMs advances first
    const before = host.engine.getStats().activeTriggers;
    host.applyInput({ kind: 'noteOn', note: 999, velocity: 64 }); // unmapped → generic trigger
    host.step(STEP); // input stamped at prior engineTimeMs <= now, so it drains
    expect(host.engine.getStats().activeTriggers).toBeGreaterThan(before);
  });

  it('blacks out and closes the transport on stop', () => {
    const { host, fake } = makeHost();
    host.step(STEP);
    host.stop();
    expect(fake.closed).toBe(true);
  });
});
