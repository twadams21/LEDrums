/* In-memory Storage double shared by every web test that mocks localStorage.
   Call sites install it with `as unknown as Storage` — deliberately no
   `implements Storage`, which would need an index signature that erases
   type checking on the class's own members. */
export class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

/** The error a browser raises when a write exceeds the origin's storage budget. jsdom never
    runs out of room on its own, so a test that needs the over-quota path constructs one.
    (Chrome/Safari name it `QuotaExceededError`; Firefox `NS_ERROR_DOM_QUOTA_REACHED`.) */
export function quotaExceededError(name: 'QuotaExceededError' | 'NS_ERROR_DOM_QUOTA_REACHED' = 'QuotaExceededError'): Error {
  const err = new Error('The quota has been exceeded.');
  err.name = name;
  return err;
}

/** A {@link MemStorage} whose `setItem` THROWS instead of writing — private mode, or an origin
    that is out of room. `failOn` narrows the failure to particular keys, so a test can make one
    of several writes fail and leave the others succeeding (the partial-loss case, where a
    "did any write succeed?" rule still shows a green indicator over lost bytes). */
export class ThrowingStorage extends MemStorage {
  constructor(
    private readonly error: () => Error = () => quotaExceededError(),
    private readonly failOn: (key: string) => boolean = () => true,
  ) {
    super();
  }
  override setItem(k: string, v: string): void {
    if (this.failOn(k)) throw this.error();
    super.setItem(k, v);
  }
}
