/** FIFO for slow control-plane work. A failure rejects its caller, never poisons later work. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;

  run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Operation queue is closed'));
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }

  drain(): Promise<void> { return this.tail.then(() => {}); }
  close(): Promise<void> { this.closed = true; return this.drain(); }
}
