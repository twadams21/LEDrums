/*
 * Session memory for the effect inspector's disclosure fold (S4).
 *
 * ONE flag for the whole session, not one per effect: a per-effect flag with no persistence
 * flaps open/closed as you tab between nodes, which is the failure the prototype called out.
 * Deliberately module-level and NOT persisted — the slice's brief says per-session is enough,
 * and a durable surface would mean a new field on `AuthoredState` (the `paneSizes` pattern in
 * `trigger-lab/persistence.ts`), which is outside this slice's fence. Reloading the app
 * therefore starts the fold open, which is the safe default: nothing is hidden by surprise.
 */

let open = $state(true);

export const paramFold = {
  get open(): boolean {
    return open;
  },
  set open(v: boolean) {
    open = v;
  },
};
