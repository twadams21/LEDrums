/**
 * Serial request queue.
 *
 * The controller forbids concurrent requests — a client must wait for each
 * response before sending the next (doc §4, "sequential requests only"). This
 * queue funnels every call through a single promise chain so a later call
 * cannot start until the prior one has settled (resolved OR rejected). A hung
 * request is bounded by the caller's per-request timeout, so a failure never
 * wedges the queue.
 */
export class SequentialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  /** Enqueue `task`; it runs only after all previously-enqueued tasks settle. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // The chain must not break on rejection: swallow the settled result so the
    // next task still runs. The caller keeps the real (possibly rejected) promise.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
