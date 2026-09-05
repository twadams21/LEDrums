/** Session-cached code, never cached component instances. Pending callers share one
 * import; failures are handled here and retried only on explicit operator intent. */
export type LazyState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; retryable: boolean };

export interface LazyResource<T> {
  readonly state: LazyState<T>;
  load(): Promise<void>;
  retry(): Promise<void>;
}

export function lazyResource<T>(
  importer: () => Promise<T>,
  canRetry: (error: unknown) => boolean = () => true,
): LazyResource<T> {
  let state = $state.raw<LazyState<T>>({ status: 'idle' });
  let pending: Promise<void> | undefined;

  function load(): Promise<void> {
    if (pending) return pending;
    if (state.status !== 'idle') return Promise.resolve();
    state = { status: 'loading' };
    // Promise.resolve also catches a synchronous importer throw. No rejection escapes
    // an unmounted consumer; completing off-screen merely warms this resource.
    pending = Promise.resolve().then(importer).then(
      (value) => { state = { status: 'ready', value }; },
      (error: unknown) => { state = { status: 'error', retryable: canRetry(error) }; },
    ).finally(() => { pending = undefined; });
    return pending;
  }

  return {
    get state() { return state; },
    load,
    retry() {
      if (state.status === 'error' && state.retryable) state = { status: 'idle' };
      return load();
    },
  };
}
