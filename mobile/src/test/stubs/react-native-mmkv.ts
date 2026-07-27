/**
 * In-memory MMKV.
 *
 * `lib/storage.ts` runs for real against this — it is only the JSI binding that
 * is replaced, not the app's own persistence code. So `storeGet`/`storeSet` and
 * the two queues exercise their actual JSON round-trip, including the
 * `try/catch` that has to survive a corrupted value.
 *
 * Instances are keyed by `id` exactly as the real MMKV is, which is what lets a
 * test prove that `clearQueue()` on the mutation queue cannot wipe attendance.
 */

const stores = new Map<string, Map<string, string>>();

export class MMKV {
  private readonly m: Map<string, string>;

  constructor(opts: { id?: string } = {}) {
    const id = opts.id ?? 'default';
    let store = stores.get(id);
    if (!store) { store = new Map(); stores.set(id, store); }
    this.m = store;
  }

  getString(key: string): string | undefined {
    return this.m.get(key);
  }

  set(key: string, value: string | number | boolean): void {
    this.m.set(key, String(value));
  }

  delete(key: string): void {
    this.m.delete(key);
  }

  clearAll(): void {
    this.m.clear();
  }

  getAllKeys(): string[] {
    return [...this.m.keys()];
  }

  contains(key: string): boolean {
    return this.m.has(key);
  }
}

/** Wipe every instance. Call in `beforeEach` so tests cannot leak into each other. */
export function __resetStorage(): void {
  for (const store of stores.values()) store.clear();
}

/** Read a raw value without going through the app's helpers. */
export function __raw(id: string, key: string): string | undefined {
  return stores.get(id)?.get(key);
}
