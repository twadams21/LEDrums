import type { TriggerLab } from '../trigger-lab/store.svelte';

/** The slice of {@link TriggerLab} the PIN-entry gate reads, as standalone reactive state, so a
 * component test can drive a refusal without booting the whole store and its WS client.
 *
 * It lives here (and as a `.svelte.ts` module) because runes are only available in Svelte files —
 * a plain object in a `.test.ts` cannot be reactive, and the gate's whole behaviour is reactive.
 * Kept to exactly the three fields the gate reads: widening it would let a test assert on state
 * the component cannot actually see. */
export interface AuthGateStoreDouble {
  /** The store double, shaped for the component's `store` prop. */
  store: TriggerLab;
  /** PINs passed to `submitPin`, VERBATIM — the real store trims too, so recording untrimmed is
   * what lets a test prove the component trimmed before submitting. */
  submitted: string[];
  /** Simulate one server refusal of the given kind, exactly as the store records it: a wrong PIN
   * leaves `authThrottledSeconds` null, a cooldown sets it (0 = the server did not say how long).
   * Both bump `authFailCount`, because that is how the gate tells "waiting" from "refused again". */
  refuse(throttledSeconds: number | null): void;
}

export function authGateStoreDouble(authRequired = true): AuthGateStoreDouble {
  const submitted: string[] = [];
  const state = $state({
    authRequired,
    authFailCount: 0,
    authThrottledSeconds: null as number | null,
  });

  const store = {
    get authRequired() {
      return state.authRequired;
    },
    get authFailCount() {
      return state.authFailCount;
    },
    get authThrottledSeconds() {
      return state.authThrottledSeconds;
    },
    submitPin(pin: string) {
      submitted.push(pin);
    },
  } as unknown as TriggerLab;

  return {
    store,
    submitted,
    refuse(throttledSeconds) {
      state.authThrottledSeconds = throttledSeconds;
      state.authFailCount += 1;
    },
  };
}
