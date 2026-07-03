/* Toast — a tiny transient-notification store (S44). Generic UI primitive: a singleton rune
   store any feature can push into (`pushToast(...)`) and one {@link ToastHost} renders. Built
   for the clipboard paste flow's friendly errors (non-ClipDoc content ⇒ a toast, not a crash)
   but deliberately feature-agnostic — patch paste (S45) and future flows reuse it.

   Pure state + timers, no DOM: the host owns rendering, so this module stays unit-testable in
   node (auto-dismiss is opt-out via `ttl: 0`, and setTimeout is guarded for SSR). */

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastOptions {
  tone?: ToastTone;
  /** Auto-dismiss delay in ms; 0 keeps it until dismissed by hand (or `clear`). */
  ttl?: number;
}

const DEFAULT_TTL = 4200;
let seq = 0;

class ToastStore {
  /** The live stack, oldest first — the host renders newest at the bottom. */
  items = $state<ToastItem[]>([]);
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  /** Push a toast; returns its id so a caller can dismiss it early. */
  push(message: string, opts: ToastOptions = {}): number {
    const id = ++seq;
    const tone = opts.tone ?? 'info';
    this.items = [...this.items, { id, message, tone }];
    const ttl = opts.ttl ?? DEFAULT_TTL;
    if (ttl > 0 && typeof setTimeout !== 'undefined') {
      this.timers.set(id, setTimeout(() => this.dismiss(id), ttl));
    }
    return id;
  }

  /** Remove a toast (and cancel its pending auto-dismiss). No-op on an unknown id. */
  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.items = this.items.filter((t) => t.id !== id);
  }

  /** Drop every toast — used by tests and on teardown. */
  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.items = [];
  }
}

/** The one shared toast store — import + `pushToast` from anywhere; {@link ToastHost} renders it. */
export const toastStore = new ToastStore();

/** Convenience: push a message onto the shared store. */
export function pushToast(message: string, opts?: ToastOptions): number {
  return toastStore.push(message, opts);
}
