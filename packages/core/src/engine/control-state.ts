/**
 * Live control values updated from input + clock and read by the modulation resolver.
 * Per-drum velocity decays over time so a hit produces an envelope, not a step.
 */
export class ControlState {
  private velocity = new Map<string, number>();
  /** Master volume, 0..1 (driven by OSC). */
  volume = 0.7;
  /** Arbitrary OSC-addressed values, 0..1. */
  readonly osc = new Map<string, number>();
  /** Velocity envelope decay time, ms. */
  velocityDecayMs = 250;

  setVelocity(drumId: string, v: number): void {
    this.velocity.set(drumId, Math.max(0, Math.min(1, v)));
  }

  getVelocity(drumId: string): number {
    return this.velocity.get(drumId) ?? 0;
  }

  maxVelocity(): number {
    let m = 0;
    for (const v of this.velocity.values()) if (v > m) m = v;
    return m;
  }

  setOsc(address: string, value: number): void {
    this.osc.set(address, value);
  }

  getOsc(address: string): number {
    return this.osc.get(address) ?? 0;
  }

  /** Decay all velocity envelopes by dt. */
  decay(dtMs: number): void {
    const factor = Math.exp(-dtMs / this.velocityDecayMs);
    for (const [k, v] of this.velocity) {
      const nv = v * factor;
      this.velocity.set(k, nv < 0.0005 ? 0 : nv);
    }
  }

  reset(): void {
    this.velocity.clear();
    this.osc.clear();
    this.volume = 0.7;
  }
}
