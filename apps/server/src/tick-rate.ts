/** Measures completed ticks against wall time, including pauses the simulation clamps away. */
export class TickRate {
  private windowStart = 0;
  private ticks = 0;
  rate = 0;

  reset(wallMs: number): void {
    this.windowStart = wallMs;
    this.ticks = 0;
    this.rate = 0;
  }

  tick(wallMs: number): void {
    this.ticks++;
    const elapsed = wallMs - this.windowStart;
    if (elapsed < 1000) return;
    this.rate = this.ticks * 1000 / elapsed;
    this.windowStart = wallMs;
    this.ticks = 0;
  }
}
